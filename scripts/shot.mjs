/**
 * Dev-time visual harness: screenshot deck slides via headless Chrome.
 *
 * Usage (after `pnpm build`):
 *   pnpm shot <deck-dir> [--slide 1,16] [--theme dark|light|both] \
 *     [--setup "js to run after the runtime"] [--focus ".selector"] \
 *     [--scale 2] [--out shots] [--size 1920x1080]
 *
 * --focus outlines matching elements in magenta; --scale renders at a
 * higher device pixel ratio for close inspection of small elements.
 *
 * Writes <out>/<deck>-s<N>-<theme>.png. Requires Google Chrome or Chromium
 * (override the binary with CHROME_BIN).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    slide: { type: "string", default: "1" },
    theme: { type: "string", default: "both" },
    setup: { type: "string" },
    focus: { type: "string" },
    scale: { type: "string", default: "1" },
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

const chrome = findChrome();
const outDir = path.resolve(values.out);
mkdirSync(outDir, { recursive: true });
const deckName = path.basename(deckDir);
const tempHtml = path.join(deckDir, ".zerp-shot.html");
const shots = [];

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
      const result = spawnSync(
        chrome,
        [
          "--headless=new",
          "--disable-gpu",
          "--hide-scrollbars",
          `--window-size=${sizeMatch[1]},${sizeMatch[2]}`,
          `--force-device-scale-factor=${values.scale}`,
          "--virtual-time-budget=4000",
          `--user-data-dir=${profile}`,
          `--screenshot=${outPath}`,
          `file://${tempHtml}#${slide}`,
        ],
        { stdio: "pipe" },
      );
      rmSync(profile, { force: true, recursive: true });
      if (result.status !== 0 || !existsSync(outPath)) {
        console.error(`Chrome failed for slide ${slide} (${theme}):`);
        console.error(String(result.stderr));
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
