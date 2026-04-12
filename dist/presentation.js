import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const assetCache = new Map();
const URL_ATTRS = ["src", "href", "poster"];
function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function isExternalUrl(value) {
  return /^(?:[a-z]+:|#|\/)/i.test(value);
}
function rewriteRelativeUrls(html, relativeSlidePath) {
  const slideRootRelativePath = path.posix.join(
    "slides",
    relativeSlidePath.replaceAll(path.sep, "/"),
  );
  const slideDir = path.posix.dirname(slideRootRelativePath);
  const normalizedDir = slideDir === "." ? "" : slideDir;
  return html.replace(
    /\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi,
    (_match, attr, quote, value) => {
      if (!URL_ATTRS.includes(attr.toLowerCase()) || isExternalUrl(value)) {
        return `${attr}=${quote}${value}${quote}`;
      }
      const rewritten = path.posix.normalize(
        normalizedDir ? path.posix.join(normalizedDir, value) : value,
      );
      return `${attr}=${quote}${rewritten}${quote}`;
    },
  );
}
function readAsset(assetPath) {
  const cached = assetCache.get(assetPath);
  if (cached) {
    return cached;
  }
  const contentPromise = readFile(new URL(assetPath, import.meta.url), "utf8");
  assetCache.set(assetPath, contentPromise);
  return contentPromise;
}
async function collectSlideFiles(slidesDir, prefix = "") {
  const entries = await readdir(slidesDir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const relativePath = path.join(prefix, entry.name);
        const absolutePath = path.join(slidesDir, entry.name);
        if (entry.isDirectory()) {
          return collectSlideFiles(absolutePath, relativePath);
        }
        if (entry.isFile() && entry.name.endsWith(".html")) {
          return [{ absolutePath, relativePath }];
        }
        return [];
      }),
  );
  return files.flat();
}
export async function listSlides(rootDir) {
  const slidesDir = path.join(rootDir, "slides");
  return collectSlideFiles(slidesDir);
}
export async function buildPresentationHtml(options) {
  const title = options.title ?? path.basename(path.resolve(options.rootDir));
  const lang = options.lang ?? "en";
  const slideFiles = await listSlides(options.rootDir);
  const [defaultStyles, defaultRuntime] = await Promise.all([
    readAsset("./assets/default-styles.css"),
    readAsset("./assets/default-runtime.js"),
  ]);
  if (slideFiles.length === 0) {
    throw new Error(`No slide HTML files found in ${path.join(options.rootDir, "slides")}`);
  }
  const slideHtmlParts = await Promise.all(
    slideFiles.map(async ({ absolutePath, relativePath }) => {
      const html = await readFile(absolutePath, "utf8");
      return rewriteRelativeUrls(html, relativePath);
    }),
  );
  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(lang)}">`,
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(title)}</title>`,
    '    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet" />',
    "    <style>",
    defaultStyles,
    "    </style>",
    "  </head>",
    "  <body>",
    slideHtmlParts.join("\n"),
    '    <div class="progress" id="progress"></div>',
    '    <div class="counter" id="counter"></div>',
    '    <div class="nav"><button onclick="prev()">←</button><button onclick="next()">→</button></div>',
    "    <script>",
    defaultRuntime,
    "    </script>",
    "  </body>",
    "</html>",
  ].join("\n");
}
export async function writePresentation(options) {
  const outFile = options.outFile ?? path.join(options.rootDir, "index.html");
  const html = await buildPresentationHtml(options);
  await writeFile(outFile, html, "utf8");
  return outFile;
}
