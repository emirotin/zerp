import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type Browser,
  type BrowserContext,
  chromium,
  type CDPSession,
  type Page,
} from "playwright-core";

import { buildPresentationHtml } from "../presentation.js";
import { resolveBrowserExecutable } from "../verify.js";
import type { DeckProbe, ProbeOptions, ProbeSlide } from "./probe-types.js";

let probeSequence = 0;

/** How long a shared browser gets to take its context back before we give up on it. */
const CONTEXT_CLEANUP_TIMEOUT_MS = 5_000;

/**
 * Convert an absolute filesystem path to a deck-relative path.
 * Returns the relative path if it's genuinely under rootDir, null otherwise.
 * Uses a trailing-slash boundary to avoid matching sibling directories.
 */
export function normalizePathToDeckRelative(absolutePath: string, rootDir: string): string | null {
  const prefix = `${rootDir}/`;
  if (absolutePath.startsWith(prefix)) {
    return absolutePath.slice(prefix.length);
  }
  return null;
}

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
// CDP calls (font collection) cannot run inside page.evaluate, so the walk is
// split: SETUP_EXPRESSION runs once and installs helpers plus the frame list
// on window; SLIDE_EXPRESSION collects one already-active slide per call, and
// Node drives window.next() and the CDP font query between calls.
const SETUP_EXPRESSION = (): string => `(async function () {
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
  window.__zerpSnippet = snippet;
  window.__zerpCollect = collect;
  var frames = Array.from(document.querySelectorAll("[data-zerp-slide]"));
  window.__zerpFrames = frames;
  return {
    frameCount: frames.length,
    slideCount: document.querySelectorAll(".slide").length,
    innerSlideCount: frames.filter(function (f) { return f.querySelector(".slide") !== null; }).length
  };
})()`;

// Collects the currently active slide only — the caller has already advanced
// with window.next() (or is on slide 1, right after SETUP_EXPRESSION).
const SLIDE_EXPRESSION = (index: number, safeMargin: number): string => `(function () {
  var index = ${index};
  var safeMargin = ${safeMargin};
  var frames = window.__zerpFrames;
  var snippet = window.__zerpSnippet;
  var collect = window.__zerpCollect;
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
  return {
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
  };
})()`;

const BROWSER_ERRORS_EXPRESSION = "window.__zerpVerifyErrors || []";

interface SetupResult {
  frameCount: number;
  slideCount: number;
  innerSlideCount: number;
}

interface RawProbeResult {
  frameCount: number;
  slideCount: number;
  innerSlideCount: number;
  slides: ProbeSlide[];
  browserErrors: string[];
}

/** CDP's DOM.getAttributes returns a flat [name, value, name, value, ...] array. */
function attributeValue(attributes: string[], name: string): string | null {
  for (let i = 0; i < attributes.length; i += 2) {
    if (attributes[i] === name) {
      return attributes[i + 1] ?? null;
    }
  }
  return null;
}

// getPlatformFontsForNode is the renderer's own answer to "which fonts drew
// this text". document.fonts.check cannot be used: it returns true for a
// family that does not exist, because it reports whether the fonts that WOULD
// be used are loaded, and fallback fonts always are.
async function collectFonts(cdp: CDPSession, slide: ProbeSlide): Promise<void> {
  // Re-sent per slide: window.next() mutates the tree and invalidates node ids
  // from any earlier DOM.getDocument call.
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: "[data-zerp-slide-active] [data-zerp-probe]",
  });
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send("DOM.getAttributes", { nodeId });
    const probeIndex = attributeValue(attributes, "data-zerp-probe");
    const element = probeIndex === null ? undefined : slide.elements[Number(probeIndex)];
    if (!element) {
      continue;
    }
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    element.fonts = fonts.map((font) => ({
      familyName: font.familyName,
      glyphCount: font.glyphCount,
      isCustomFont: font.isCustomFont,
    }));
  }
}

/**
 * Drive the per-slide walk from Node so CDP font collection can interleave
 * with it: advance to a slide, evaluate it, collect its fonts, repeat.
 */
async function collectSlides(
  page: Page,
  cdp: CDPSession,
  safeMargin: number,
): Promise<{ setup: SetupResult; slides: ProbeSlide[] }> {
  const setup = (await page.evaluate(SETUP_EXPRESSION())) as SetupResult;
  const slides: ProbeSlide[] = [];
  for (let index = 0; index < setup.frameCount; index++) {
    if (index > 0) {
      await page.evaluate("window.next()");
    }
    const slide = (await page.evaluate(SLIDE_EXPRESSION(index, safeMargin))) as ProbeSlide;
    await collectFonts(cdp, slide);
    slides.push(slide);
  }
  return { setup, slides };
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
    const cdp = await context.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const { setup, slides } = await collectSlides(page, cdp, safeMargin);
    const browserErrors = (await page.evaluate(BROWSER_ERRORS_EXPRESSION)) as string[];
    return { ...setup, slides, browserErrors };
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
    // Strip absolute file:// paths to make them deck-relative. This prevents
    // fixture churn and leaking local paths across machines. Use a common helper
    // for browser errors and computed backgroundImage URLs to ensure consistent
    // path boundary matching.
    const deckRelativeErrors = result.browserErrors.map((error) => {
      // Extract path from file:// URLs in error messages.
      if (error.startsWith("file://")) {
        const filePath = error.slice("file://".length);
        const deckRelativePath = normalizePathToDeckRelative(filePath, rootDir);
        return deckRelativePath ?? error;
      }
      return error;
    });

    // Normalize backgroundImage URLs in element computed styles.
    // url("file:///absolute/path/image.png") becomes url("image.png") relative to deck.
    const deckRelativeSlides = result.slides.map((slide) => ({
      ...slide,
      elements: slide.elements.map((el) => {
        const bg = el.backgroundImage;
        if (bg && bg.startsWith("url(")) {
          const urlMatch = bg.match(/^url\("file:\/\/([^"]+)"\)$/);
          if (urlMatch && urlMatch[1]) {
            const filePath = urlMatch[1];
            const deckRelativePath = normalizePathToDeckRelative(filePath, rootDir);
            if (deckRelativePath) {
              return { ...el, backgroundImage: `url("${deckRelativePath}")` };
            }
          }
        }
        return el;
      }),
    }));

    return {
      theme: options.theme,
      width: options.width,
      height: options.height,
      sizeDefaulted: options.sizeDefaulted ?? false,
      frameCount: result.frameCount,
      slideCount: result.slideCount,
      innerSlideCount: result.innerSlideCount,
      slides: deckRelativeSlides,
      browserErrors: deckRelativeErrors,
    };
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
