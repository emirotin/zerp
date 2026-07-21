import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
  slides: SlideVerification[];
  browserErrors: string[];
  failures: string[];
}

interface ProbeResult {
  frameCount: number;
  slideCount: number;
  innerSlideCount: number;
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
const viewportOffsetCache = new Map<string, { dx: number; dy: number }>();

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

function instrumentHtml(html: string): string {
  const collector = `<script>
window.__zerpVerifyErrors = [];
window.addEventListener("error", function (event) {
  var target = event.target;
  var message = event.message || (target && (target.src || target.href)) || "browser error";
  window.__zerpVerifyErrors.push(String(message));
}, true);
window.addEventListener("unhandledrejection", function (event) {
  window.__zerpVerifyErrors.push(String(event.reason || "unhandled rejection"));
});
</script>`;
  const probe = `<script>
(function () {
  var writeResult = function (result) {
    var bytes = new TextEncoder().encode(JSON.stringify(result));
    var binary = "";
    for (var byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    document.documentElement.setAttribute("data-zerp-verify-result", btoa(binary));
  };
  try {
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
  var result = {
    frameCount: frames.length,
    slideCount: document.querySelectorAll(".slide").length,
    innerSlideCount: frames.filter(function (frame) { return frame.querySelector(".slide") !== null; }).length,
    slides: checks,
    browserErrors: window.__zerpVerifyErrors
  };
  writeResult(result);
  } catch (error) {
    writeResult({ frameCount: 0, slideCount: 0, innerSlideCount: 0, slides: [], browserErrors: [String(error)] });
  }
})();
</script>`;
  return html.replace("</head>", `${collector}</head>`).replace("</body>", `${probe}</body>`);
}

async function dumpDom(
  chrome: string,
  htmlPath: string,
  width: number,
  height: number,
): Promise<string> {
  const profile = mkdtempSync(path.join(tmpdir(), "zerp-verify-"));
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
      "--virtual-time-budget=5000",
      `--window-size=${width},${height}`,
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      "--dump-dom",
      `file://${htmlPath}#1`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  try {
    return await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        killProcess(child);
        reject(new Error("Chrome verification timed out"));
      }, 20_000);
      let settled = false;
      const finish = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      };
      child.once("error", (error) => finish(error));
      child.stdout?.on("data", () => {
        // Chrome can hang while shutting down after --dump-dom. Any probe
        // marker (the full verification result or the viewport calibration
        // marker) is enough to finish, so do not wait for a clean browser exit.
        if (/data-zerp-verify-\w+="/.test(stdout)) {
          finish();
        }
      });
      child.once("close", (code, signal) => {
        if (code === 0) {
          finish();
        } else {
          const status = code === null && signal ? `signal ${signal}` : String(code ?? 1);
          finish(new Error(`Chrome verification failed (${status}): ${stderr.trim()}`));
        }
      });
    });
  } finally {
    killProcess(child);
    rmSync(profile, { force: true, recursive: true });
  }
}

const CALIBRATION_HTML = `<!doctype html>
<html>
  <head></head>
  <body>
    <script>
      document.documentElement.setAttribute(
        "data-zerp-verify-viewport",
        window.innerWidth + "x" + window.innerHeight,
      );
    </script>
  </body>
</html>`;

/**
 * Headless Chrome's --window-size sets the outer window bounds, not the
 * layout viewport: the delivered window.innerWidth/innerHeight can be
 * smaller than requested by a chrome-version- and platform-dependent
 * amount. Measure the actual offset against a blank page and compensate,
 * rather than trusting the requested size, so verification runs against
 * the viewport the caller actually asked for.
 */
async function measureViewportOffset(
  chrome: string,
  width: number,
  height: number,
): Promise<{ dx: number; dy: number }> {
  const cacheKey = `${chrome}::${width}x${height}`;
  const cached = viewportOffsetCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const calibrationPath = path.join(
    tmpdir(),
    `zerp-verify-calibrate-${process.pid}-${verificationSequence++}.html`,
  );
  writeFileSync(calibrationPath, CALIBRATION_HTML, "utf8");
  try {
    const dom = await dumpDom(chrome, calibrationPath, width, height);
    const match = dom.match(/data-zerp-verify-viewport="(\d+)x(\d+)"/);
    if (!match) {
      throw new Error("Chrome did not report a viewport calibration result");
    }
    const offset = {
      dx: width - Number.parseInt(match[1] ?? "", 10),
      dy: height - Number.parseInt(match[2] ?? "", 10),
    };
    viewportOffsetCache.set(cacheKey, offset);
    return offset;
  } finally {
    rmSync(calibrationPath, { force: true });
  }
}

function parseProbeResult(dom: string): ProbeResult {
  const encoded = dom.match(/data-zerp-verify-result="([^"]+)"/)?.[1];
  if (!encoded) {
    throw new Error("Chrome did not return a zerp verification result");
  }
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as ProbeResult;
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
  const { dx, dy } = await measureViewportOffset(chrome, options.width, options.height);
  const htmlPath = path.join(
    options.rootDir,
    `.zerp-verify-${process.pid}-${verificationSequence++}.html`,
  );
  try {
    const html = instrumentHtml(
      await buildPresentationHtml({ rootDir: options.rootDir, theme: options.theme }),
    );
    writeFileSync(htmlPath, html, "utf8");
    const result = parseProbeResult(
      await dumpDom(chrome, htmlPath, options.width + dx, options.height + dy),
    );
    return {
      theme: options.theme,
      slideCount: result.frameCount,
      slides: result.slides,
      browserErrors: result.browserErrors,
      failures: validateProbe(result),
    };
  } finally {
    rmSync(htmlPath, { force: true });
  }
}
