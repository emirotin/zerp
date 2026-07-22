import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

import { buildPresentationHtml } from "./presentation.js";

export type VerifyTheme = "dark" | "light";

export interface VerifyOptions {
  rootDir: string;
  theme: VerifyTheme;
  width: number;
  height: number;
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

function killProcess(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // The browser already exited.
    }
  }
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

// Evaluated after the load event with awaitPromise, so the measurements are
// taken when the page is genuinely ready rather than whenever a DOM dump
// happens to be serialized. Fonts are inlined as lazily-activated @font-face
// rules; measuring before they activate would use fallback metrics and miss
// font-dependent overflow, so the probe waits for the font set and a paint
// to settle first.
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

interface CdpResponse {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

interface PendingCommand {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

interface EventWaiter {
  method: string;
  sessionId: string | undefined;
  resolve: () => void;
}

/**
 * Drive Chrome over the DevTools protocol on --remote-debugging-pipe
 * (\0-delimited JSON on fds 3/4 — no network, no dependencies).
 *
 * The previous transport, one-shot `--dump-dom`, serializes the DOM around
 * the load event: a probe that awaits fonts either races the dump (the
 * result attribute misses small pages) or, with --timeout, never dumps at
 * all when --user-data-dir is passed. It is also broken outright in
 * Chrome-for-Testing builds. A live protocol session sidesteps the whole
 * class: navigate, wait for load, evaluate the probe with awaitPromise, and
 * read the returned value.
 */
async function runProbe(
  chrome: string,
  htmlPath: string,
  width: number,
  height: number,
): Promise<ProbeResult> {
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-extensions",
      "--disable-component-update",
      "--remote-debugging-pipe",
      "about:blank",
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] },
  );
  const toChrome = child.stdio[3] as Writable;
  const fromChrome = child.stdio[4] as Readable;

  const pending = new Map<number, PendingCommand>();
  const eventWaiters: EventWaiter[] = [];
  let nextId = 1;
  let failure: Error | null = null;

  const failAll = (error: Error): void => {
    failure ??= error;
    for (const command of pending.values()) {
      command.reject(error);
    }
    pending.clear();
  };

  let buffer = "";
  fromChrome.setEncoding("utf8");
  fromChrome.on("data", (chunk: string) => {
    buffer += chunk;
    let boundary = buffer.indexOf("\0");
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      boundary = buffer.indexOf("\0");
      let message: CdpResponse;
      try {
        message = JSON.parse(raw) as CdpResponse;
      } catch {
        continue;
      }
      if (message.id !== undefined) {
        const command = pending.get(message.id);
        if (command) {
          pending.delete(message.id);
          if (message.error) {
            command.reject(new Error(message.error.message ?? "CDP command failed"));
          } else {
            command.resolve(message.result ?? {});
          }
        }
      } else if (message.method) {
        for (let index = eventWaiters.length - 1; index >= 0; index--) {
          const waiter = eventWaiters[index];
          if (waiter?.method === message.method && waiter.sessionId === message.sessionId) {
            eventWaiters.splice(index, 1);
            waiter.resolve();
          }
        }
      }
    }
  });
  child.once("error", (error) => failAll(error));
  child.once("close", () => failAll(new Error("Chrome exited before verification finished")));

  const send = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<Record<string, unknown>> => {
    if (failure) {
      return Promise.reject(failure);
    }
    const id = nextId++;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    toChrome.write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    return promise;
  };

  const waitForEvent = (method: string, sessionId?: string): Promise<void> => {
    if (failure) {
      return Promise.reject(failure);
    }
    return new Promise<void>((resolve) => {
      eventWaiters.push({ method, sessionId, resolve });
    });
  };

  const probe = async (): Promise<ProbeResult> => {
    // The about:blank tab from the command line can lag the pipe becoming
    // writable; poll briefly instead of assuming it is already listed.
    let targetId: string | null = null;
    for (let attempt = 0; attempt < 40 && !targetId; attempt++) {
      const targets = (await send("Target.getTargets"))["targetInfos"] as
        | Array<{ targetId: string; type: string }>
        | undefined;
      targetId = targets?.find((target) => target.type === "page")?.targetId ?? null;
      if (!targetId) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    if (!targetId) {
      throw new Error("Chrome did not expose a page target");
    }
    const sessionId = (await send("Target.attachToTarget", { targetId, flatten: true }))[
      "sessionId"
    ] as string;
    await send("Page.enable", {}, sessionId);
    // An exact layout viewport, unlike --window-size, whose delivered
    // innerWidth/innerHeight vary by platform and required calibration.
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false },
      sessionId,
    );
    await send("Page.addScriptToEvaluateOnNewDocument", { source: COLLECTOR_SOURCE }, sessionId);
    const loaded = waitForEvent("Page.loadEventFired", sessionId);
    await send("Page.navigate", { url: `file://${htmlPath}#1` }, sessionId);
    await loaded;
    const evaluation = await send(
      "Runtime.evaluate",
      { expression: PROBE_EXPRESSION, awaitPromise: true, returnByValue: true },
      sessionId,
    );
    const exception = evaluation["exceptionDetails"] as
      | { text?: string; exception?: { description?: string } }
      | undefined;
    if (exception) {
      throw new Error(
        `verification probe failed: ${exception.exception?.description ?? exception.text ?? "unknown error"}`,
      );
    }
    return (evaluation["result"] as { value: ProbeResult }).value;
  };

  try {
    return await new Promise<ProbeResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        failAll(new Error("Chrome verification timed out"));
        reject(new Error("Chrome verification timed out"));
      }, VERIFICATION_TIMEOUT_MS);
      probe().then(
        (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
      );
    });
  } finally {
    killProcess(child);
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
  const chrome = findChrome();
  // The presentation is written next to the slides so deck-relative asset
  // URLs resolve; the file is plain (uninstrumented) and removed afterwards.
  const htmlPath = path.join(
    options.rootDir,
    `.zerp-verify-${process.pid}-${verificationSequence++}.html`,
  );
  try {
    const html = await buildPresentationHtml({ rootDir: options.rootDir, theme: options.theme });
    writeFileSync(htmlPath, html, "utf8");
    const result = await runProbe(chrome, htmlPath, options.width, options.height);
    return {
      theme: options.theme,
      slideCount: result.frameCount,
      fontsActive: result.fontsActive,
      slides: result.slides,
      browserErrors: result.browserErrors,
      failures: validateProbe(result),
    };
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
