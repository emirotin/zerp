import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "playwright-core";

// Renders the designer-facing style guide to PDF. The guide is not a static
// document: it pulls in the built framework stylesheet and the @fontsource
// packages and renders its examples with them, so the PDF is only true of the
// tree it was printed from. `prepublishOnly` reprints it after the build,
// which is what lets the package ship it.

const SOURCE = "docs/style-system.html";
const OUTPUT = "docs/style-system.pdf";

const PREREQUISITES = [
  ["dist/assets/default-styles.css", "pnpm build"],
  ["node_modules/@fontsource/montserrat", "pnpm install"],
];

for (const [dependency, command] of PREREQUISITES) {
  if (!existsSync(dependency)) {
    console.error(`Missing ${dependency} — run \`${command}\` first.`);
    process.exit(1);
  }
}

// dist is a prerequisite above, so the framework's own browser resolution
// (CHROME_BIN, the managed chromium, a system Chrome) is available to import.
const { resolveBrowserExecutable } = await import("../dist/verify.js");

const { version } = JSON.parse(await readFile("package.json", "utf8"));
// "en-CA" formats a local-time date as YYYY-MM-DD.
const stamp = `Generated ${new Date().toLocaleDateString("en-CA")} against zerp ${version}.`;

const browser = await chromium.launch({ executablePath: resolveBrowserExecutable() });

try {
  // The guide follows prefers-color-scheme; print it in the light theme, which
  // is the one that shares its background with the paper.
  const page = await browser.newPage({ colorScheme: "light" });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto(pathToFileURL(path.resolve(SOURCE)).href, { waitUntil: "load" });
  // The examples are typeset in the embedded fonts; printing before they
  // activate measures fallback metrics and paginates on them.
  await page.evaluate(() => document.fonts.ready);

  const filled = await page.evaluate((text) => {
    const node = document.getElementById("build-stamp");
    if (node) {
      node.textContent = text;
    }
    // The token panels are built in-page from the stylesheet's computed
    // values. A script that failed leaves them empty and prints a guide
    // silently missing its color reference.
    const panels = document.getElementById("token-panels")?.childElementCount ?? 0;
    return { stamped: node !== null, panels };
  }, stamp);

  if (pageErrors.length > 0) {
    throw new Error(`${SOURCE} raised browser errors:\n  ${pageErrors.join("\n  ")}`);
  }
  if (!filled.stamped) {
    throw new Error(`${SOURCE} has no #build-stamp element to record the version in.`);
  }
  if (filled.panels !== 2) {
    throw new Error(`${SOURCE} rendered ${filled.panels} token panels, expected 2 (dark, light).`);
  }

  // The guide sets its own page size and margins in @page; honor them rather
  // than printing at the backend's default paper.
  await page.pdf({ path: OUTPUT, printBackground: true, preferCSSPageSize: true });
} finally {
  await browser.close();
}

const { size } = await stat(OUTPUT);
console.log(`${OUTPUT} (${Math.round(size / 1024)} KB) — ${stamp}`);
