/**
 * Dev-time visual harness: screenshot deck slides via headless Chrome.
 *
 * Usage (after `pnpm build`):
 *   pnpm shot <deck-dir> [--slide 1,16] [--theme dark|light|both] \
 *     [--setup "js to run after the runtime"] [--focus ".selector"] \
 *     [--scale 2] [--out shots] [--size 1920x1080]
 *
 * --focus outlines matching elements in magenta; --scale renders at a
 * higher device pixel ratio for close inspection of small elements;
 * --no-web-fonts blackholes Google Fonts (fast + offline-safe layout shots).
 * Shots are capped at 15s per page — a hung network fetch degrades to
 * fallback rendering instead of hanging the harness. Chrome itself is
 * killed as soon as the PNG is stable: headless Chrome can hang on
 * shutdown for minutes, so the harness never waits for a clean exit.
 *
 * Writes <out>/<deck>-s<N>-<theme>.png. Requires Google Chrome or Chromium
 * (override the binary with CHROME_BIN).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { buildPresentationHtml } from "../dist/index.js";

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser",
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) {
      return candidate;
    }
  }
  console.error("No Chrome/Chromium found. Set CHROME_BIN to a browser binary.");
  process.exit(1);
}

function killProcessGroup(child) {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

const CALIBRATION_HTML = `<!doctype html>
<html>
  <head></head>
  <body>
    <script>
      document.documentElement.setAttribute(
        "data-zerp-shot-viewport",
        window.innerWidth + "x" + window.innerHeight,
      );
    </script>
  </body>
</html>`;

/**
 * Headless Chrome's --window-size sets the outer window bounds, not the
 * layout viewport: window.innerWidth/innerHeight (and therefore any vh/vw
 * or 100%-of-viewport layout) can come out smaller than requested, by a
 * chrome-version- and platform-dependent amount. Measure the actual offset
 * against a blank page and compensate --window-size, rather than trusting
 * the requested --size, so shots render the deck the way it truly looks at
 * that size.
 */
async function measureViewportOffset(chrome, width, height) {
  const profile = mkdtempSync(path.join(tmpdir(), "zerp-shot-calibrate-"));
  const calibrationPath = path.join(tmpdir(), `zerp-shot-calibrate-${process.pid}.html`);
  writeFileSync(calibrationPath, CALIBRATION_HTML, "utf8");
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
      "--virtual-time-budget=4000",
      `--window-size=${width},${height}`,
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      "--dump-dom",
      `file://${calibrationPath}`,
    ],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Chrome viewport calibration timed out"));
      }, 20_000);
      let settled = false;
      const finish = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      child.once("error", (error) => finish(error));
      // Chrome can hang while shutting down after --dump-dom; the marker
      // attribute is enough to finish, so do not wait for a clean exit.
      child.stdout.on("data", () => {
        if (/data-zerp-shot-viewport="/.test(stdout)) {
          finish();
        }
      });
      child.once("close", (code, signal) => {
        if (code === 0) {
          finish();
        } else {
          finish(new Error(`Chrome viewport calibration failed (${code ?? signal})`));
        }
      });
    });
  } finally {
    killProcessGroup(child);
    rmSync(profile, { force: true, recursive: true });
    rmSync(calibrationPath, { force: true });
  }
  const match = stdout.match(/data-zerp-shot-viewport="(\d+)x(\d+)"/);
  if (!match) {
    throw new Error("Chrome did not report a viewport calibration result");
  }
  return {
    dx: width - Number.parseInt(match[1], 10),
    dy: height - Number.parseInt(match[2], 10),
  };
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    slide: { type: "string", default: "1" },
    theme: { type: "string", default: "both" },
    setup: { type: "string" },
    focus: { type: "string" },
    scale: { type: "string", default: "1" },
    "no-web-fonts": { type: "boolean", default: false },
    out: { type: "string", default: "shots" },
    size: { type: "string", default: "1920x1080" },
  },
});

const deckDir = path.resolve(positionals[0] ?? ".");
if (!existsSync(path.join(deckDir, "slides"))) {
  console.error(`Not a deck directory (no slides/): ${deckDir}`);
  process.exit(1);
}

const themes = values.theme === "both" ? ["dark", "light"] : [values.theme];
for (const theme of themes) {
  if (!["dark", "light"].includes(theme)) {
    console.error(`Invalid theme: ${theme} (use dark, light, or both)`);
    process.exit(1);
  }
}
const slides = values.slide.split(",").map((s) => Number.parseInt(s.trim(), 10));
if (slides.some((n) => !Number.isInteger(n) || n < 1)) {
  console.error(`Invalid --slide list: ${values.slide}`);
  process.exit(1);
}
const sizeMatch = values.size.match(/^(\d+)x(\d+)$/);
if (!sizeMatch) {
  console.error(`Invalid --size: ${values.size} (expected WxH)`);
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = findChrome();
const requestedWidth = Number.parseInt(sizeMatch[1], 10);
const requestedHeight = Number.parseInt(sizeMatch[2], 10);
const { dx, dy } = await measureViewportOffset(chrome, requestedWidth, requestedHeight);
const outDir = path.resolve(values.out);
mkdirSync(outDir, { recursive: true });
const deckName = path.basename(deckDir);
const tempHtml = path.join(deckDir, `.zerp-shot-${process.pid}.html`);
const shots = [];

// Sweep temp files orphaned by killed runs; an hour of age keeps us clear of
// any run that is still legitimately in flight.
for (const name of readdirSync(deckDir)) {
  if (/^\.zerp-shot-\d+\.html$/.test(name)) {
    const stale = path.join(deckDir, name);
    if (Date.now() - statSync(stale).mtimeMs > 60 * 60 * 1000) {
      rmSync(stale, { force: true });
    }
  }
}

try {
  for (const theme of themes) {
    let html = await buildPresentationHtml({ rootDir: deckDir, theme });
    // Freeze the theme: shots must not depend on a stale localStorage profile.
    const freeze = `<script>try{localStorage.setItem("zerp-theme",${JSON.stringify(theme)})}catch{}</script>`;
    const focus = values.focus
      ? `<script>for (const el of document.querySelectorAll(${JSON.stringify(values.focus)})) { el.style.outline = "4px solid magenta"; el.style.outlineOffset = "3px"; }</script>`
      : "";
    const setup = values.setup ? `<script>${values.setup}</script>` : "";
    html = html
      .replace("<body>", `<body>${freeze}`)
      .replace("</body>", `${setup}${focus}\n</body>`);
    writeFileSync(tempHtml, html);

    for (const slide of slides) {
      const outPath = path.join(outDir, `${deckName}-s${slide}-${theme}.png`);
      const profile = mkdtempSync(path.join(tmpdir(), "zerp-shot-"));
      rmSync(outPath, { force: true });
      // Chrome writes the PNG quickly but can hang on shutdown for minutes
      // (observed with headless 149 on macOS). Don't wait for exit: poll for
      // a stable PNG, then kill the whole process group.
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
          // Hard cap: a wedged subresource (e.g. throttled webfont fetch)
          // must not hang the shot; Chrome captures whatever has rendered.
          "--timeout=15000",
          ...(values["no-web-fonts"]
            ? [
                "--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1",
              ]
            : []),
          `--window-size=${requestedWidth + dx},${requestedHeight + dy}`,
          `--force-device-scale-factor=${values.scale}`,
          "--virtual-time-budget=4000",
          `--user-data-dir=${profile}`,
          `--screenshot=${outPath}`,
          `file://${tempHtml}#${slide}`,
        ],
        { stdio: ["ignore", "ignore", "pipe"], detached: true },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      const deadline = Date.now() + 25000;
      let ok = false;
      while (Date.now() < deadline) {
        await sleep(300);
        if (existsSync(outPath)) {
          const size = statSync(outPath).size;
          await sleep(400);
          if (existsSync(outPath) && statSync(outPath).size === size && size > 0) {
            ok = true;
            break;
          }
        }
      }
      killProcessGroup(child);
      rmSync(profile, { force: true, recursive: true });
      if (!ok) {
        console.error(`Chrome failed for slide ${slide} (${theme}):`);
        console.error(stderr);
        process.exit(1);
      }
      shots.push(outPath);
      console.log(outPath);
    }
  }
} finally {
  rmSync(tempHtml, { force: true });
}

console.log(`${shots.length} shot(s) written to ${outDir}`);
