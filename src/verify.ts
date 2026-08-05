import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, type BrowserContext, chromium } from "playwright-core";

import { buildPresentationHtml } from "./presentation.js";

export type VerifyTheme = "dark" | "light";

export interface VerifyOptions {
  rootDir: string;
  theme: VerifyTheme;
  width: number;
  height: number;
  /** True when the caller fell back to the default size rather than choosing one. */
  sizeDefaulted?: boolean;
  /** Print-safe inset in CSS px. When > 0, every top-level element of each
   * authored slide must stay at least this far from every page edge (elements
   * marked `data-zerp-bleed` are exempt). 0 or absent disables the check.
   * The threshold is caller policy — pick one below the framework's slide
   * padding so ordinary content never trips it. */
  safeMargin?: number;
  /** Budget in ms for the whole browser session — launch, navigation, font
   * activation and the probe. Absent falls back to `ZERP_VERIFY_TIMEOUT_MS`,
   * then to {@link DEFAULT_VERIFICATION_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** An already-running browser to verify in, instead of launching one:
   * `http(s)://` connects over CDP, `ws(s)://` over the playwright protocol.
   * Absent falls back to `ZERP_BROWSER_ENDPOINT`, then to launching. The
   * browser belongs to whoever started it and is never closed here. */
  browserEndpoint?: string;
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
  /** Measured top-level slide elements for the safe-zone check; null when the
   * check is off or the slide has no inner root. */
  safeZoneItems: SafeZoneItem[] | null;
}

/** One top-level element of the authored slide, measured against the viewport
 * for the print-safe-zone check. Viewport-relative CSS px. */
export interface SafeZoneItem {
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * The safe-zone verdict for one measured element: a message naming every page
 * edge the element gets closer to than `safeMargin`, or null when it stays
 * clear. A distance exactly at the margin passes — the margin is a floor.
 */
export function safeZoneFailureMessage(
  item: SafeZoneItem,
  viewportWidth: number,
  viewportHeight: number,
  safeMargin: number,
): string | null {
  const edges: [string, number][] = [
    ["left", item.left],
    ["top", item.top],
    ["right", viewportWidth - item.right],
    ["bottom", viewportHeight - item.bottom],
  ];
  const intrusions = edges
    .filter(([, distance]) => distance < safeMargin)
    .map(([edge, distance]) => `${edge} (${Math.round(Math.max(0, distance))}px)`);
  if (intrusions.length === 0) {
    return null;
  }
  return `${item.label} enters the ${safeMargin}px print safe margin: ${intrusions.join(", ")}`;
}

/** One verify failure. Deck-level failures (browser errors, frame-count
 * mismatches) carry only `message`; per-slide failures name the 1-based deck
 * position and, when zerp could attribute it, the source file to edit. The
 * structured entry is the source of truth — `formatVerifyFailure` is its
 * human rendering. */
export interface VerifyFailure {
  slide?: number;
  src?: string;
  message: string;
}

/** The human line for a failure: `slide N (slides/foo.html): message`,
 * mirroring `zerp check`'s file attribution. */
export function formatVerifyFailure(failure: VerifyFailure): string {
  if (failure.slide === undefined) {
    return failure.message;
  }
  const label = failure.src ? `slide ${failure.slide} (${failure.src})` : `slide ${failure.slide}`;
  return `${label}: ${failure.message}`;
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
  /** The print-safe inset the deck was checked against; absent when the
   * safe-zone check was off. */
  safeMargin?: number;
  slides: SlideVerification[];
  browserErrors: string[];
  failures: VerifyFailure[];
}

interface ProbeResult {
  frameCount: number;
  slideCount: number;
  innerSlideCount: number;
  fontsActive: boolean;
  slides: SlideVerification[];
  browserErrors: string[];
}

// System-Chrome fallbacks, tried after CHROME_BIN and playwright's own managed
// chromium. Each is validated by a `--version` spawn before use.
const SYSTEM_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser",
];
let verificationSequence = 0;

/**
 * Budget for one verification session when the caller names none.
 *
 * It covers everything: launching a cold browser, navigating, waiting for the
 * inlined fonts to activate, and running the probe. Fine for a laptop with a
 * warm page cache, and deliberately overridable — the same work on a small,
 * loaded CI or container host, or on a deck carrying megabytes of imagery, can
 * take several times as long, and a session that runs out of budget yields no
 * report at all rather than a slow one.
 */
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 20_000;

/** Env fallback for {@link VerifyOptions.timeoutMs}, for hosts that spawn the CLI. */
const TIMEOUT_ENV_VAR = "ZERP_VERIFY_TIMEOUT_MS";

/**
 * The session budget in ms: an explicit option, else the environment, else the
 * default.
 *
 * A malformed env value throws rather than falling back. Silently ignoring it
 * would leave the operator who set it believing verification has a budget it
 * does not have — the failure that raising the timeout was meant to prevent,
 * now invisible.
 */
export function resolveVerificationTimeoutMs(explicit?: number): number {
  if (explicit !== undefined) {
    return assertTimeoutMs(explicit, "timeout option");
  }
  const fromEnv = process.env[TIMEOUT_ENV_VAR];
  if (fromEnv === undefined || fromEnv === "") {
    return DEFAULT_VERIFICATION_TIMEOUT_MS;
  }
  return assertTimeoutMs(Number(fromEnv), TIMEOUT_ENV_VAR);
}

function assertTimeoutMs(value: number, source: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${source}: ${value} (expected a positive integer in ms)`);
  }
  return value;
}

/** Env fallback for {@link VerifyOptions.browserEndpoint}, for hosts that spawn the CLI. */
const BROWSER_ENDPOINT_ENV_VAR = "ZERP_BROWSER_ENDPOINT";

/** How long a shared browser gets to take its context back before we give up on it. */
const CONTEXT_CLEANUP_TIMEOUT_MS = 5_000;

/**
 * The already-running browser to verify in: an explicit option, else the
 * environment, else none (launch one).
 *
 * Rejects an endpoint whose scheme names no transport rather than guessing, for
 * the same reason a malformed timeout throws — a host that configured browser
 * reuse and silently got a per-run launch has the cost it was trying to avoid
 * and no signal that it does.
 */
export function resolveBrowserEndpoint(explicit?: string): string | undefined {
  const value = explicit ?? process.env[BROWSER_ENDPOINT_ENV_VAR];
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!/^(?:https?|wss?):\/\//.test(value)) {
    throw new Error(
      `Invalid browser endpoint: ${value} (expected an http(s):// CDP or ws(s):// playwright URL)`,
    );
  }
  return value;
}

/**
 * Attach to a browser someone else is running.
 *
 * CDP is the interoperable transport: it is the browser's own protocol, so the
 * two sides need no common playwright build. The playwright protocol is
 * version-locked between client and server, so `ws://` is for a server started
 * by a matching `chromium.launchServer()` — typically the same application that
 * spawns this CLI.
 */
function connectBrowser(endpoint: string, timeoutMs: number): Promise<Browser> {
  return endpoint.startsWith("http")
    ? chromium.connectOverCDP(endpoint, { timeout: timeoutMs })
    : chromium.connect(endpoint, { timeout: timeoutMs });
}

/**
 * Resolve a Chromium executable for headless work, in priority order:
 *
 *   1. `CHROME_BIN` — an explicit override used verbatim (wrapper scripts that
 *      exec a browser with extra flags are supported); the caller asked for
 *      exactly this binary.
 *   2. playwright-core's own managed chromium, if `zerp install-browser` (or a
 *      prior playwright install) has downloaded it. `executablePath()` computes
 *      a path whether or not it exists — and throws in some builds when nothing
 *      is installed — so guard it with `existsSync`.
 *   3. A system-installed Chrome/Chromium, validated by `--version`.
 *   4. None found — point at `zerp install-browser` or `CHROME_BIN`.
 *
 * Exported so every headless entry point resolves a browser identically — the
 * docs PDF build (`scripts/build-docs.mjs`) uses it too.
 */
export function resolveBrowserExecutable(): string {
  const override = process.env.CHROME_BIN;
  if (override) {
    return override;
  }
  try {
    const managed = chromium.executablePath();
    if (managed && existsSync(managed)) {
      return managed;
    }
  } catch {
    // playwright-core has no managed browser installed; fall through.
  }
  for (const candidate of SYSTEM_CHROME_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) {
      return candidate;
    }
  }
  throw new Error(
    "No Chrome/Chromium found. Run `zerp install-browser` or set CHROME_BIN to a browser binary.",
  );
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
// `safeMargin` is a validated non-negative integer interpolated into the script;
// 0 skips the per-element measurement entirely.
const probeExpression = (safeMargin: number): string => `(async function () {
  var safeMargin = ${safeMargin};
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
    var safeZoneItems = null;
    if (safeMargin > 0 && activeSlide) {
      safeZoneItems = Array.from(activeSlide.children)
        .filter(function (el) { return ["SCRIPT", "STYLE"].indexOf(el.tagName) === -1; })
        .filter(function (el) { return !el.hasAttribute("data-zerp-bleed"); })
        .map(function (el) {
          var r = el.getBoundingClientRect();
          return {
            // getAttribute("class") stays a string on SVG elements, unlike className.
            label: el.id || el.getAttribute("class") || el.tagName.toLowerCase(),
            left: r.left, top: r.top, right: r.right, bottom: r.bottom,
            width: r.width, height: r.height
          };
        })
        .filter(function (item) { return item.width > 0 && item.height > 0; });
    }
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
      activeRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      safeZoneItems: safeZoneItems
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
interface ProbeOptions {
  /** Absent when {@link ProbeOptions.browserEndpoint} supplies a browser instead. */
  executablePath?: string;
  htmlPath: string;
  width: number;
  height: number;
  safeMargin: number;
  timeoutMs: number;
  browserEndpoint?: string;
}

async function runProbe(options: ProbeOptions): Promise<ProbeResult> {
  const { htmlPath, width, height, safeMargin, timeoutMs, browserEndpoint } = options;
  // A supplied browser is borrowed; a launched one is ours to terminate. The
  // distinction decides the whole teardown below.
  const borrowed = browserEndpoint !== undefined;
  const opening = borrowed
    ? connectBrowser(browserEndpoint, timeoutMs)
    : // playwright-core defaults `chromiumSandbox: false`, so this stays root-safe
      // without extra flags; the launch is bounded so a wedged browser cannot hang.
      chromium.launch({
        ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
        headless: true,
        timeout: timeoutMs,
      });
  let browser: Browser | undefined;
  // Held as a promise, not a value: if the session times out while the context
  // is still being created, the value assignment never happens and a borrowed
  // browser would keep the context forever.
  let opened: Promise<BrowserContext> | undefined;
  const session = opening.then(async (connected) => {
    browser = connected;
    // An exact layout viewport, unlike `--window-size`, whose delivered
    // innerWidth/innerHeight vary by platform and required calibration.
    opened = connected.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const context = await opened;
    const page = await context.newPage();
    await page.addInitScript(COLLECTOR_SOURCE);
    await page.goto(`file://${htmlPath}#1`, { waitUntil: "load" });
    return (await page.evaluate(probeExpression(safeMargin))) as ProbeResult;
  });
  try {
    // The budget is named in the message: a timeout is the one failure whose
    // fix is a configuration change, and the operator cannot make it without
    // knowing which value ran out.
    return await withTimeout(
      session,
      timeoutMs,
      `Chrome verification timed out after ${timeoutMs}ms (raise --timeout or ${TIMEOUT_ENV_VAR})`,
    );
  } finally {
    // The context is closed explicitly rather than left to the browser: a
    // borrowed browser survives this process, so an abandoned context is a leak
    // that accumulates over every verification the host runs. Bounded, because
    // teardown must not outlive the run it is cleaning up after.
    if (opened) {
      await withTimeout(
        opened.then((context) => context.close()),
        CONTEXT_CLEANUP_TIMEOUT_MS,
        "closing the verification context timed out",
      ).catch(() => {});
    }
    // Also close the browser even if the race above rejected: if it already
    // resolved, `browser` holds the handle; if it is still settling, await it
    // so a late-arriving browser is not leaked. On a borrowed browser this
    // severs our connection and leaves the browser itself running.
    const connected = browser ?? (await opening.catch(() => undefined));
    if (connected) {
      await connected.close().catch(() => {});
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

function validateProbe(result: ProbeResult, safeMargin: number): VerifyFailure[] {
  const failures: VerifyFailure[] = result.browserErrors.map((error) => ({
    message: `browser error: ${error}`,
  }));
  if (result.frameCount === 0) {
    failures.push({ message: "deck has no slide frames" });
  }
  if (result.slideCount !== result.frameCount) {
    failures.push({
      message: `deck has ${result.slideCount} .slide elements for ${result.frameCount} slide frames`,
    });
  }
  if (result.innerSlideCount !== result.frameCount) {
    failures.push({
      message: `deck has ${result.innerSlideCount} framed slide roots for ${result.frameCount} slide frames`,
    });
  }
  result.slides.forEach((slide) => {
    // Failures carry the source file when known, mirroring zerp check's file
    // attribution so a failure maps straight to the file to edit.
    const at = (message: string): VerifyFailure => ({
      slide: slide.index,
      ...(slide.src ? { src: slide.src } : {}),
      message,
    });
    if (slide.activeCount !== 1) {
      failures.push(at(`expected one active frame, got ${slide.activeCount}`));
    }
    if (slide.visibleCount !== 1) {
      failures.push(at(`expected one visible frame, got ${slide.visibleCount}`));
    }
    if (slide.activeIndex !== slide.index) {
      failures.push(at(`active frame is ${slide.activeIndex ?? "missing"}`));
    }
    if (slide.bodyHeight > slide.viewportHeight + 1) {
      failures.push(at(`body height is ${slide.bodyHeight}px`));
    }
    if (slide.activeDisplay === "none") {
      failures.push(at("active inner slide is display:none"));
    }
    if (!slide.activeClass) {
      failures.push(at("active inner slide is missing the active class"));
    }
    const rectFailureMessage = rectFailure(
      slide.activeRect,
      slide.viewportWidth,
      slide.viewportHeight,
    );
    if (rectFailureMessage) {
      failures.push(at(rectFailureMessage));
    }
    for (const item of slide.safeZoneItems ?? []) {
      const message = safeZoneFailureMessage(
        item,
        slide.viewportWidth,
        slide.viewportHeight,
        safeMargin,
      );
      if (message) {
        failures.push(at(message));
      }
    }
  });
  return failures;
}

export async function verifyPresentation(options: VerifyOptions): Promise<VerifyReport> {
  const timeoutMs = resolveVerificationTimeoutMs(options.timeoutMs);
  const browserEndpoint = resolveBrowserEndpoint(options.browserEndpoint);
  // A supplied browser is the browser; there is no local one to find, and
  // demanding one would refuse to verify on a host that deliberately has none.
  const executablePath = browserEndpoint === undefined ? resolveBrowserExecutable() : undefined;
  // The presentation is written next to the slides so deck-relative asset
  // URLs resolve; the file is plain (uninstrumented) and removed afterwards.
  const htmlPath = path.join(
    options.rootDir,
    `.zerp-verify-${process.pid}-${verificationSequence++}.html`,
  );
  try {
    const html = await buildPresentationHtml({ rootDir: options.rootDir, theme: options.theme });
    writeFileSync(htmlPath, html, "utf8");
    const safeMargin = options.safeMargin ?? 0;
    const result = await runProbe({
      ...(executablePath === undefined ? {} : { executablePath }),
      htmlPath,
      width: options.width,
      height: options.height,
      safeMargin,
      timeoutMs,
      ...(browserEndpoint === undefined ? {} : { browserEndpoint }),
    });
    return {
      theme: options.theme,
      slideCount: result.frameCount,
      fontsActive: result.fontsActive,
      viewport: {
        width: options.width,
        height: options.height,
        defaulted: options.sizeDefaulted ?? false,
      },
      ...(safeMargin > 0 ? { safeMargin } : {}),
      slides: result.slides,
      browserErrors: result.browserErrors,
      failures: validateProbe(result, safeMargin),
    };
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
