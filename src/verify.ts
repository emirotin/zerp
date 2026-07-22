import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, chromium } from "playwright-core";

import { buildPresentationHtml } from "./presentation.js";

export type VerifyTheme = "dark" | "light";

export interface VerifyOptions {
  rootDir: string;
  theme: VerifyTheme;
  width: number;
  height: number;
  /** True when the caller fell back to the default size rather than choosing one. */
  sizeDefaulted?: boolean;
}

export interface SlideVerification {
  index: number;
  src: string | null;
  srcSlide: string | null;
  activeCount: number;
  visibleCount: number;
  activeIndex: number | null;
  bodyHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  activeDisplay: string | null;
  activeClass: boolean;
  activeRect: { x: number; y: number; width: number; height: number } | null;
}

export interface VerifyReport {
  theme: VerifyTheme;
  slideCount: number;
  fontsActive: boolean;
  /** The exact viewport the deck was verified against — overflow and frame
   * geometry are judged relative to this size, so a report is only meaningful
   * together with it. `defaulted` distinguishes "checked at the default" from
   * a deliberately chosen size. */
  viewport: { width: number; height: number; defaulted: boolean };
  slides: SlideVerification[];
  browserErrors: string[];
  failures: string[];
}

interface ProbeResult {
  frameCount: number;
  slideCount: number;
  innerSlideCount: number;
  fontsActive: boolean;
  slides: SlideVerification[];
  browserErrors: string[];
}

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser",
].filter((candidate): candidate is string => Boolean(candidate));
let verificationSequence = 0;

const VERIFICATION_TIMEOUT_MS = 20_000;

function findChrome(): string {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) {
      return candidate;
    }
  }
  throw new Error("No Chrome/Chromium found. Set CHROME_BIN to a browser binary.");
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Installed at document start so resource and script errors are collected
// from the first byte of the deck, before any slide markup runs.
const COLLECTOR_SOURCE = `
window.__zerpVerifyErrors = [];
window.addEventListener("error", function (event) {
  var target = event.target;
  var message = event.message || (target && (target.src || target.href)) || "browser error";
  window.__zerpVerifyErrors.push(String(message));
}, true);
window.addEventListener("unhandledrejection", function (event) {
  window.__zerpVerifyErrors.push(String(event.reason || "unhandled rejection"));
});
`;

// Evaluated after the load event, so the measurements are taken when the page
// is genuinely ready rather than whenever a DOM dump happens to be serialized.
// Fonts are inlined as lazily-activated @font-face rules; measuring before they
// activate would use fallback metrics and miss font-dependent overflow, so the
// probe waits for the font set and a paint to settle first.
const PROBE_EXPRESSION = `(async function () {
  await document.fonts.ready;
  await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  var fontsActive = document.fonts.check("1em Montserrat");
  var frames = Array.from(document.querySelectorAll("[data-zerp-slide]"));
  var checks = [];
  for (var index = 0; index < frames.length; index++) {
    if (index > 0) {
      window.next();
    }
    var visible = frames.filter(function (frame) {
      var style = getComputedStyle(frame);
      var rect = frame.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    var active = frames.filter(function (frame) {
      return frame.hasAttribute("data-zerp-slide-active");
    });
    var activeFrame = active[0] || null;
    var activeSlide = activeFrame ? activeFrame.querySelector(".slide") : null;
    var rect = activeFrame ? activeFrame.getBoundingClientRect() : null;
    checks.push({
      index: index + 1,
      src: activeSlide ? activeSlide.getAttribute("data-zerp-src") : null,
      srcSlide: activeSlide ? activeSlide.getAttribute("data-zerp-src-slide") : null,
      activeCount: active.length,
      visibleCount: visible.length,
      activeIndex: activeFrame ? frames.indexOf(activeFrame) + 1 : null,
      bodyHeight: document.body.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      activeDisplay: activeSlide ? getComputedStyle(activeSlide).display : null,
      activeClass: activeSlide ? activeSlide.classList.contains("active") : false,
      activeRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null
    });
  }
  return {
    frameCount: frames.length,
    slideCount: document.querySelectorAll(".slide").length,
    innerSlideCount: frames.filter(function (frame) { return frame.querySelector(".slide") !== null; }).length,
    fontsActive: fontsActive,
    slides: checks,
    browserErrors: window.__zerpVerifyErrors || []
  };
})()`;

/**
 * Drive Chromium through playwright-core (a battle-tested browser driver with
 * no bundled browsers of its own).
 *
 * The probe must run *after* fonts activate: the previous one-shot `--dump-dom`
 * transport serialized the DOM around the load event, which races an async
 * font wait (the result attribute misses small pages) and is broken outright in
 * Chrome-for-Testing builds. A live session sidesteps the whole class — set an
 * exact layout viewport on the context, install the error collector before the
 * first byte, navigate, wait for load, then evaluate the probe (which awaits
 * `document.fonts.ready` and a paint) and read the returned value.
 */
async function runProbe(
  executablePath: string,
  htmlPath: string,
  width: number,
  height: number,
): Promise<ProbeResult> {
  // playwright-core defaults `chromiumSandbox: false`, so this stays root-safe
  // without extra flags; the launch is bounded so a wedged browser cannot hang.
  const launch = chromium.launch({
    executablePath,
    headless: true,
    timeout: VERIFICATION_TIMEOUT_MS,
  });
  let browser: Browser | undefined;
  const session = launch.then(async (launched) => {
    browser = launched;
    // An exact layout viewport, unlike `--window-size`, whose delivered
    // innerWidth/innerHeight vary by platform and required calibration.
    const context = await launched.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.addInitScript(COLLECTOR_SOURCE);
    await page.goto(`file://${htmlPath}#1`, { waitUntil: "load" });
    return (await page.evaluate(PROBE_EXPRESSION)) as ProbeResult;
  });
  try {
    return await withTimeout(session, VERIFICATION_TIMEOUT_MS, "Chrome verification timed out");
  } finally {
    // Close the browser even if the race above rejected: if launch already
    // resolved, `browser` holds the handle; if it is still settling, await it
    // so a late-arriving browser is not leaked.
    const opened = browser ?? (await launch.catch(() => undefined));
    if (opened) {
      await opened.close();
    }
  }
}

function rectFailure(
  rect: SlideVerification["activeRect"],
  viewportWidth: number,
  viewportHeight: number,
): string | null {
  if (!rect) {
    return "active frame has no bounding rectangle";
  }
  const tolerance = 1;
  if (
    Math.abs(rect.x) > tolerance ||
    Math.abs(rect.y) > tolerance ||
    Math.abs(rect.width - viewportWidth) > tolerance ||
    Math.abs(rect.height - viewportHeight) > tolerance
  ) {
    return `active frame rect is ${rect.x},${rect.y},${rect.width},${rect.height}; expected viewport ${viewportWidth}x${viewportHeight}`;
  }
  return null;
}

function validateProbe(result: ProbeResult): string[] {
  const failures = result.browserErrors.map((error) => `browser error: ${error}`);
  if (result.frameCount === 0) {
    failures.push("deck has no slide frames");
  }
  if (result.slideCount !== result.frameCount) {
    failures.push(
      `deck has ${result.slideCount} .slide elements for ${result.frameCount} slide frames`,
    );
  }
  if (result.innerSlideCount !== result.frameCount) {
    failures.push(
      `deck has ${result.innerSlideCount} framed slide roots for ${result.frameCount} slide frames`,
    );
  }
  result.slides.forEach((slide) => {
    // Prefix each failure with the source file when known, mirroring zerp
    // check's file attribution so a failure maps straight to the file to edit.
    const label = slide.src ? `slide ${slide.index} (${slide.src})` : `slide ${slide.index}`;
    if (slide.activeCount !== 1) {
      failures.push(`${label}: expected one active frame, got ${slide.activeCount}`);
    }
    if (slide.visibleCount !== 1) {
      failures.push(`${label}: expected one visible frame, got ${slide.visibleCount}`);
    }
    if (slide.activeIndex !== slide.index) {
      failures.push(`${label}: active frame is ${slide.activeIndex ?? "missing"}`);
    }
    if (slide.bodyHeight > slide.viewportHeight + 1) {
      failures.push(`${label}: body height is ${slide.bodyHeight}px`);
    }
    if (slide.activeDisplay === "none") {
      failures.push(`${label}: active inner slide is display:none`);
    }
    if (!slide.activeClass) {
      failures.push(`${label}: active inner slide is missing the active class`);
    }
    const rectFailureMessage = rectFailure(
      slide.activeRect,
      slide.viewportWidth,
      slide.viewportHeight,
    );
    if (rectFailureMessage) {
      failures.push(`${label}: ${rectFailureMessage}`);
    }
  });
  return failures;
}

export async function verifyPresentation(options: VerifyOptions): Promise<VerifyReport> {
  const executablePath = findChrome();
  // The presentation is written next to the slides so deck-relative asset
  // URLs resolve; the file is plain (uninstrumented) and removed afterwards.
  const htmlPath = path.join(
    options.rootDir,
    `.zerp-verify-${process.pid}-${verificationSequence++}.html`,
  );
  try {
    const html = await buildPresentationHtml({ rootDir: options.rootDir, theme: options.theme });
    writeFileSync(htmlPath, html, "utf8");
    const result = await runProbe(executablePath, htmlPath, options.width, options.height);
    return {
      theme: options.theme,
      slideCount: result.frameCount,
      fontsActive: result.fontsActive,
      viewport: {
        width: options.width,
        height: options.height,
        defaulted: options.sizeDefaulted ?? false,
      },
      slides: result.slides,
      browserErrors: result.browserErrors,
      failures: validateProbe(result),
    };
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
