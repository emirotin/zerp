import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
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

// Everything the printed PDF is a function of, besides the version: the guide
// itself and the sources the built stylesheet is generated from. The footer
// stamp derives from these instead of the wall clock so that reprinting an
// unchanged tree reproduces the committed PDF byte-for-byte.
const STAMP_INPUTS = [
  SOURCE,
  "src/assets/base-styles.css",
  "scripts/generate-tokens.mjs",
  "src/fonts.ts",
];

async function stampDate() {
  const dirty = execFileSync("git", ["status", "--porcelain", "--", ...STAMP_INPUTS], {
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
  if (dirty.length > 0) {
    // Uncommitted input edits: date the PDF by the newest edit, which is
    // stable across reruns (unlike "today").
    const mtimes = await Promise.all(dirty.map(async (file) => (await stat(file)).mtime));
    return new Date(Math.max(...mtimes)).toLocaleDateString("en-CA");
  }
  // "%cs" is the committer date as local-time YYYY-MM-DD.
  return execFileSync("git", ["log", "-1", "--format=%cs", "--", ...STAMP_INPUTS], {
    encoding: "utf8",
  }).trim();
}

const { version } = JSON.parse(await readFile("package.json", "utf8"));
const date = await stampDate();
const stamp = `Generated ${date} against zerp ${version}.`;

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
  const pdf = normalizePdf(await page.pdf({ printBackground: true, preferCSSPageSize: true }));

  const previous = existsSync(OUTPUT) ? await readFile(OUTPUT) : null;
  if (previous && previous.equals(pdf)) {
    console.log(`${OUTPUT} unchanged — ${stamp}`);
  } else {
    await writeFile(OUTPUT, pdf);
    console.log(`${OUTPUT} (${Math.round(pdf.length / 1024)} KB) — ${stamp}`);
  }
} finally {
  await browser.close();
}

// Chromium stamps the print time into /CreationDate and /ModDate and a random
// /ID into the trailer, so identical pages still print to different bytes.
// Overwrite them in place (same length, so xref offsets stay valid) with
// values derived from the footer stamp, making the output reproducible.
function normalizePdf(buffer) {
  let text = buffer.toString("latin1");

  const fixedDate = `D:${date.replaceAll("-", "")}000000+00'00'`;
  text = text.replace(/\/(CreationDate|ModDate)\s*\(([^)]*)\)/g, (match, key, value) => {
    const replacement = fixedDate.padEnd(value.length, "0").slice(0, value.length);
    return `/${key} (${replacement})`;
  });

  text = text.replace(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\]/g, (match, a, b) => {
    const digest = createHash("sha256").update(stamp).digest("hex").toUpperCase();
    const id = (hex) => digest.padEnd(hex.length, "0").slice(0, hex.length);
    return `/ID [<${id(a)}> <${id(b)}>]`;
  });

  return Buffer.from(text, "latin1");
}
