import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { fontFaceCss } from "./fonts.js";
import { renderMarkdownSlides } from "./markdown.js";

const SLIDE_EXTENSIONS = new Set([".html", ".md"]);

export type ThemeName = "dark" | "light" | "system";

export interface BuildOptions {
  rootDir: string;
  title?: string;
  lang?: string;
  outFile?: string;
  theme?: ThemeName;
}

const assetCache = new Map<string, Promise<string>>();

interface SlideFile {
  absolutePath: string;
  relativePath: string;
}

const URL_ATTRS = ["src", "href", "poster"];

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isExternalUrl(value: string): boolean {
  return /^(?:[a-z]+:|#|\/)/i.test(value);
}

function rewriteRelativeUrls(html: string, relativeSlidePath: string): string {
  const slideRootRelativePath = path.posix.join(
    "slides",
    relativeSlidePath.replaceAll(path.sep, "/"),
  );
  const slideDir = path.posix.dirname(slideRootRelativePath);
  const normalizedDir = slideDir === "." ? "" : slideDir;

  return html.replace(
    /\b(src|href|poster)\s*=\s*(["'])([^"']+)\2/gi,
    (_match, attr: string, quote: string, value: string) => {
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

function isSlideDivAttrs(attrs: string): boolean {
  const classMatch = attrs.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
  return classMatch !== null && /(?:^|\s)slide(?:\s|$)/.test(classMatch[2] ?? "");
}

function annotateSlideDivs(
  html: string,
  extraAttrs: (attrs: string, ordinal: number) => string,
): string {
  let ordinal = 0;
  return html.replace(/<div\b([^>]*)>/gi, (match, attrs: string) => {
    if (!isSlideDivAttrs(attrs)) {
      return match;
    }
    ordinal += 1;
    const extra = extraAttrs(attrs, ordinal);
    return extra ? `<div${attrs}${extra}>` : match;
  });
}

function countSlideDivs(html: string): number {
  let count = 0;
  for (const match of html.matchAll(/<div\b([^>]*)>/gi)) {
    if (isSlideDivAttrs(match[1] ?? "")) {
      count += 1;
    }
  }
  return count;
}

// Source tracing: every slide div gets data-zerp-src (source file),
// data-zerp-src-slide ("i/n" ordinal within that file), and — at composition
// time — data-zerp-index (1-based deck position). Tooling (check, slides,
// runtime badge) reads these instead of re-deriving the mapping.
function injectSlideSrc(fileHtml: string, relativeSlidePath: string): string {
  const srcPath = path.posix.join("slides", relativeSlidePath.replaceAll(path.sep, "/"));
  const slidesInFile = countSlideDivs(fileHtml);
  return annotateSlideDivs(fileHtml, (attrs, ordinal) =>
    /\bdata-zerp-src\s*=/i.test(attrs)
      ? ""
      : ` data-zerp-src="${escapeHtml(srcPath)}" data-zerp-src-slide="${ordinal}/${slidesInFile}"`,
  );
}

function readAsset(assetPath: string): Promise<string> {
  const cached = assetCache.get(assetPath);
  if (cached) {
    return cached;
  }

  const contentPromise = readFile(new URL(assetPath, import.meta.url), "utf8");
  assetCache.set(assetPath, contentPromise);
  return contentPromise;
}

async function collectSlideFiles(slidesDir: string, prefix = ""): Promise<SlideFile[]> {
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
        if (entry.isFile() && SLIDE_EXTENSIONS.has(path.extname(entry.name))) {
          return [{ absolutePath, relativePath }];
        }
        return [];
      }),
  );

  return files.flat();
}

export async function listSlides(rootDir: string): Promise<SlideFile[]> {
  const slidesDir = path.join(rootDir, "slides");
  return collectSlideFiles(slidesDir);
}

export async function composeSlidesHtml(rootDir: string): Promise<string> {
  const slideFiles = await listSlides(rootDir);
  if (slideFiles.length === 0) {
    throw new Error(`No slide files found in ${path.join(rootDir, "slides")}`);
  }

  const fileHtmlParts = await Promise.all(
    slideFiles.map(async ({ absolutePath, relativePath }) => {
      const content = await readFile(absolutePath, "utf8");
      const parts = absolutePath.endsWith(".md") ? renderMarkdownSlides(content) : [content];
      const fileHtml = parts.map((html) => rewriteRelativeUrls(html, relativePath)).join("\n");
      return injectSlideSrc(fileHtml, relativePath);
    }),
  );

  return annotateSlideDivs(fileHtmlParts.join("\n"), (attrs, ordinal) =>
    /\bdata-zerp-index\s*=/i.test(attrs) ? "" : ` data-zerp-index="${ordinal}"`,
  );
}

export async function buildPresentationHtml(options: BuildOptions): Promise<string> {
  const title = options.title ?? path.basename(path.resolve(options.rootDir));
  const lang = options.lang ?? "en";
  const theme = options.theme ?? "system";
  const [slidesHtml, defaultStyles, defaultRuntime, fontCss] = await Promise.all([
    composeSlidesHtml(options.rootDir),
    readAsset("./assets/default-styles.css"),
    readAsset("./assets/default-runtime.js"),
    fontFaceCss(),
  ]);

  const themeSwitchHtml = [
    '    <div class="theme-switch" id="theme-switch">',
    '      <button class="theme-trigger" aria-label="Theme">◐</button>',
    '      <div class="theme-options" hidden>',
    '        <button data-theme-choice="light">Light</button>',
    '        <button data-theme-choice="system">Auto</button>',
    '        <button data-theme-choice="dark">Dark</button>',
    "      </div>",
    "    </div>",
  ].join("\n");

  const navHtml = [
    '    <div class="nav">',
    '      <button id="nav-prev" onclick="prev()">←</button>',
    '      <button id="nav-next" onclick="next()">→</button>',
    "    </div>",
  ].join("\n");

  return [
    "<!doctype html>",
    `<html lang="${escapeHtml(lang)}" data-zerp-theme="${theme}" data-zerp-default-theme="${theme}">`,
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(title)}</title>`,
    '    <style data-zerp="fonts">',
    fontCss,
    "    </style>",
    '    <style data-zerp="base">',
    defaultStyles,
    "    </style>",
    "  </head>",
    "  <body>",
    slidesHtml,
    '    <div class="progress" id="progress"></div>',
    '    <div class="counter" id="counter"></div>',
    themeSwitchHtml,
    navHtml,
    "    <script>",
    defaultRuntime,
    "    </script>",
    "  </body>",
    "</html>",
  ].join("\n");
}

export async function writePresentation(options: BuildOptions): Promise<string> {
  const outFile = options.outFile ?? path.join(options.rootDir, "index.html");
  const html = await buildPresentationHtml(options);
  await writeFile(outFile, html, "utf8");
  return outFile;
}
