import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { type Browser, type BrowserContext, chromium } from "playwright-core";

import { buildPresentationHtml } from "../presentation.js";
import { resolveBrowserExecutable } from "../verify.js";
import type { DeckProbe, ProbeOptions, ProbeSlide } from "./probe-types.js";

let probeSequence = 0;

/** How long a shared browser gets to take its context back before we give up on it. */
const CONTEXT_CLEANUP_TIMEOUT_MS = 5_000;

// Installed at document start so resource and script errors are collected from
// the first byte of the deck, before any slide markup runs. Kept as a local
// copy of verify.ts's collector script rather than an import — only
// `resolveBrowserExecutable` is exported from verify.ts for reuse here.
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

// Only the active slide renders, so styles and geometry are collected slide by
// slide with window.next() between them — the same reason verify's probe steps.
const SLIDE_EXPRESSION = (safeMargin: number): string => `(async function () {
  var safeMargin = ${safeMargin};
  await document.fonts.ready;
  await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  var SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, TITLE: 1 };
  function snippet(text) {
    var t = String(text || "").replace(/\\s+/g, " ").trim();
    return t.length > 40 ? t.slice(0, 37) + "\\u2026" : t;
  }
  function collect(root) {
    var out = [];
    function walk(el, parent) {
      if (SKIP[el.tagName] || el.getAttribute("aria-hidden") === "true") { return; }
      var cs = getComputedStyle(el);
      var ownText = "";
      for (var i = 0; i < el.childNodes.length; i++) {
        var child = el.childNodes[i];
        if (child.nodeType === 3) { ownText += child.textContent || ""; }
      }
      var id = out.length;
      el.setAttribute("data-zerp-probe", String(id));
      out.push({
        id: id,
        tag: el.tagName.toLowerCase(),
        className: el.getAttribute("class"),
        snippet: snippet(ownText || el.textContent),
        hasOwnText: /\\S/.test(ownText),
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        fontSizePx: parseFloat(cs.fontSize) || 0,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        opacity: parseFloat(cs.opacity),
        boxShadow: cs.boxShadow,
        borderWidthPx: parseFloat(cs.borderTopWidth) || 0,
        borderColor: cs.borderTopColor,
        parent: parent,
        fonts: []
      });
      for (var j = 0; j < el.children.length; j++) { walk(el.children[j], id); }
    }
    walk(root, null);
    return out;
  }
  var frames = Array.from(document.querySelectorAll("[data-zerp-slide]"));
  var slides = [];
  for (var index = 0; index < frames.length; index++) {
    if (index > 0) { window.next(); }
    var visible = frames.filter(function (frame) {
      var style = getComputedStyle(frame);
      var rect = frame.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    var active = frames.filter(function (f) { return f.hasAttribute("data-zerp-slide-active"); });
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
          return { label: el.id || el.getAttribute("class") || el.tagName.toLowerCase(),
                   left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                   width: r.width, height: r.height };
        })
        .filter(function (item) { return item.width > 0 && item.height > 0; });
    }
    var svgTexts = activeSlide
      ? Array.from(activeSlide.querySelectorAll("svg text")).map(function (t) { return snippet(t.textContent); })
      : [];
    slides.push({
      index: index + 1,
      src: activeSlide ? activeSlide.getAttribute("data-zerp-src") : null,
      srcSlide: activeSlide ? activeSlide.getAttribute("data-zerp-src-slide") : null,
      elements: activeSlide ? collect(activeSlide) : [],
      activeCount: active.length,
      visibleCount: visible.length,
      activeIndex: activeFrame ? frames.indexOf(activeFrame) + 1 : null,
      bodyHeight: document.body.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      activeDisplay: activeSlide ? getComputedStyle(activeSlide).display : null,
      activeClass: activeSlide ? activeSlide.classList.contains("active") : false,
      activeRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      safeZoneItems: safeZoneItems,
      svgTextSnippets: svgTexts
    });
  }
  return {
    frameCount: frames.length,
    slideCount: document.querySelectorAll(".slide").length,
    innerSlideCount: frames.filter(function (f) { return f.querySelector(".slide") !== null; }).length,
    slides: slides,
    browserErrors: window.__zerpVerifyErrors || []
  };
})()`;

interface RawProbeResult {
  frameCount: number;
  slideCount: number;
  innerSlideCount: number;
  slides: ProbeSlide[];
  browserErrors: string[];
}

interface SessionOptions {
  /** Absent when {@link SessionOptions.browserEndpoint} supplies a browser instead. */
  executablePath?: string;
  htmlPath: string;
  width: number;
  height: number;
  safeMargin: number;
  timeoutMs: number;
  browserEndpoint?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Attach to a browser someone else is running. CDP is the interoperable
 * transport (the browser's own protocol, no matching playwright build
 * required); `ws://` is for a server started by a matching
 * `chromium.launchServer()`, typically the same application that spawns
 * this CLI. Mirrors verify.ts's connectBrowser, which is not exported.
 */
function connectBrowser(endpoint: string, timeoutMs: number): Promise<Browser> {
  return endpoint.startsWith("http")
    ? chromium.connectOverCDP(endpoint, { timeout: timeoutMs })
    : chromium.connect(endpoint, { timeout: timeoutMs });
}

/**
 * Drive Chromium through playwright-core, following the same session shape as
 * verify.ts's `runProbe`: set an exact layout viewport on the context,
 * install the error collector before the first byte, navigate, wait for
 * load, then evaluate the per-slide walk (which itself awaits
 * `document.fonts.ready` and a paint before measuring).
 */
async function runSlideProbe(options: SessionOptions): Promise<RawProbeResult> {
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
    return (await page.evaluate(SLIDE_EXPRESSION(safeMargin))) as RawProbeResult;
  });
  try {
    // The budget is named in the message: a timeout is the one failure whose
    // fix is a configuration change, and the operator cannot make it without
    // knowing which value ran out.
    return await withTimeout(
      session,
      timeoutMs,
      `Chrome probe timed out after ${timeoutMs}ms (raise the probe timeout)`,
    );
  } finally {
    // The context is closed explicitly rather than left to the browser: a
    // borrowed browser survives this process, so an abandoned context is a leak
    // that accumulates over every probe the host runs. Bounded, because
    // teardown must not outlive the run it is cleaning up after.
    if (opened) {
      await withTimeout(
        opened.then((context) => context.close()),
        CONTEXT_CLEANUP_TIMEOUT_MS,
        "closing the probe context timed out",
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

/**
 * Drive a real browser over one assembled deck build and return a plain,
 * serialisable snapshot of computed styles and geometry per slide — the raw
 * material a later pure `judge(probe)` turns into findings. This module owns
 * only measurement; it renders no verdicts.
 */
export async function probeDeck(options: ProbeOptions): Promise<DeckProbe> {
  const browserEndpoint = options.browserEndpoint;
  // A supplied browser is the browser; there is no local one to find, and
  // demanding one would refuse to probe on a host that deliberately has none.
  const executablePath = browserEndpoint === undefined ? resolveBrowserExecutable() : undefined;
  // Resolved to absolute: the file:// URL the browser navigates to requires
  // one, and callers (this module's tests included) may pass a relative
  // rootDir the way `zerp check <deck>` accepts one on the command line.
  const rootDir = path.resolve(options.rootDir);
  // The presentation is written next to the slides so deck-relative asset
  // URLs resolve; the file is plain (uninstrumented) and removed afterwards.
  const htmlPath = path.join(rootDir, `.zerp-probe-${process.pid}-${probeSequence++}.html`);
  try {
    const html = await buildPresentationHtml({ rootDir, theme: options.theme });
    writeFileSync(htmlPath, html, "utf8");
    const result = await runSlideProbe({
      ...(executablePath === undefined ? {} : { executablePath }),
      htmlPath,
      width: options.width,
      height: options.height,
      safeMargin: options.safeMargin,
      timeoutMs: options.timeoutMs,
      ...(browserEndpoint === undefined ? {} : { browserEndpoint }),
    });
    return {
      theme: options.theme,
      width: options.width,
      height: options.height,
      sizeDefaulted: options.sizeDefaulted ?? false,
      frameCount: result.frameCount,
      slideCount: result.slideCount,
      innerSlideCount: result.innerSlideCount,
      slides: result.slides,
      browserErrors: result.browserErrors,
    };
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
