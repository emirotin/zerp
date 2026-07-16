import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseDocument } from "htmlparser2";
import { parseHTML } from "linkedom";

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

interface SourceEdit {
  index: number;
  text: string;
}

interface ParsedNode {
  type: string;
  children?: ParsedNode[];
}

interface ParsedElement extends ParsedNode {
  name: string;
  attribs: Record<string, string>;
  children: ParsedNode[];
  startIndex: number | null;
  endIndex: number | null;
}

function hasClassToken(value: string | undefined, token: string): boolean {
  return value?.split(/\s+/).includes(token) ?? false;
}

function collectSlideElements(
  nodes: ParsedNode[],
  sourcePath: string,
  slides: ParsedElement[],
  parentSlide: ParsedElement | null = null,
): void {
  for (const node of nodes) {
    if (node.type !== "tag" && node.type !== "script" && node.type !== "style") {
      continue;
    }
    const element = node as ParsedElement;
    const isSlide = element.name === "div" && hasClassToken(element.attribs.class, "slide");
    if (isSlide) {
      if (parentSlide) {
        throw new Error(`Nested .slide elements are not supported in ${sourcePath}`);
      }
      slides.push(element);
    }
    collectSlideElements(element.children, sourcePath, slides, isSlide ? element : parentSlide);
  }
}

function openingTagInsertIndex(html: string, startIndex: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = startIndex; index < html.length; index++) {
    const character = html[index];
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return html[index - 1] === "/" ? index - 1 : index;
    }
  }
  throw new Error(`Unterminated slide opening tag at offset ${startIndex}`);
}

function applySourceEdits(source: string, edits: SourceEdit[]): string {
  let output = source;
  for (const edit of [...edits].sort((left, right) => right.index - left.index)) {
    output = `${output.slice(0, edit.index)}${edit.text}${output.slice(edit.index)}`;
  }
  return output;
}

// Source tracing: every real slide div gets data-zerp-src (source file),
// data-zerp-src-slide ("i/n" ordinal within that file), and data-zerp-index
// (1-based deck position). Each slide is wrapped in a framework-owned frame;
// the runtime toggles the frame's active attribute while authored CSS remains
// free to choose the inner slide's layout display value.
function wrapSlides(
  fileHtml: string,
  relativeSlidePath: string,
  deckIndexOffset: number,
): { html: string; slideCount: number } {
  const srcPath = path.posix.join("slides", relativeSlidePath.replaceAll(path.sep, "/"));
  const document = parseDocument(fileHtml, { withStartIndices: true, withEndIndices: true });
  const slides: ParsedElement[] = [];
  collectSlideElements(document.children, relativeSlidePath, slides);
  const edits: SourceEdit[] = [];

  for (const [index, slide] of slides.entries()) {
    if (slide.startIndex === null || slide.endIndex === null) {
      throw new Error(`Could not locate the complete .slide element in ${relativeSlidePath}`);
    }
    const attrs: string[] = [];
    if (slide.attribs["data-zerp-src"] === undefined) {
      attrs.push(` data-zerp-src="${escapeHtml(srcPath)}"`);
    }
    if (slide.attribs["data-zerp-src-slide"] === undefined) {
      attrs.push(` data-zerp-src-slide="${index + 1}/${slides.length}"`);
    }
    if (slide.attribs["data-zerp-index"] === undefined) {
      attrs.push(` data-zerp-index="${deckIndexOffset + index + 1}"`);
    }
    edits.push(
      { index: slide.startIndex, text: "<div data-zerp-slide>\n" },
      { index: openingTagInsertIndex(fileHtml, slide.startIndex), text: attrs.join("") },
      { index: slide.endIndex + 1, text: "\n</div>" },
    );
  }

  return { html: applySourceEdits(fileHtml, edits), slideCount: slides.length };
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

  const fileHtmlParts: string[] = [];
  let deckIndexOffset = 0;
  for (const { absolutePath, relativePath } of slideFiles) {
    const content = await readFile(absolutePath, "utf8");
    const parts = absolutePath.endsWith(".md") ? renderMarkdownSlides(content) : [content];
    const fileHtml = parts.map((html) => rewriteRelativeUrls(html, relativePath)).join("\n");
    const wrapped = wrapSlides(fileHtml, relativePath, deckIndexOffset);
    fileHtmlParts.push(wrapped.html);
    deckIndexOffset += wrapped.slideCount;
  }

  return fileHtmlParts.join("\n");
}

interface HeadingQueryable {
  querySelector(selector: string): { textContent: string | null } | null;
}

// Deck title: the highest-level heading of the first slide. Style- or
// script-only files contribute no slide divs, so they are skipped naturally.
function deriveDeckTitle(slidesHtml: string): string | null {
  const { document } = parseHTML(`<body>${slidesHtml}</body>`) as unknown as {
    document: { querySelector(selector: string): HeadingQueryable | null };
  };
  const firstSlide = document.querySelector(".slide");
  if (!firstSlide) {
    return null;
  }
  for (const level of ["h1", "h2", "h3", "h4", "h5", "h6"]) {
    const text = firstSlide.querySelector(level)?.textContent?.replace(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }
  return null;
}

const THEME_SWITCH_HTML = `    <div class="theme-switch" id="theme-switch">
      <button class="theme-trigger" aria-label="Theme">◐</button>
      <div class="theme-options" hidden>
        <button data-theme-choice="light">Light</button>
        <button data-theme-choice="system">Auto</button>
        <button data-theme-choice="dark">Dark</button>
      </div>
    </div>`;

const NAV_HTML = `    <div class="nav">
      <button id="nav-prev" onclick="prev()">←</button>
      <button id="nav-next" onclick="next()">→</button>
    </div>`;

export async function buildPresentationHtml(options: BuildOptions): Promise<string> {
  const lang = options.lang ?? "en";
  const theme = options.theme ?? "system";
  const [slidesHtml, defaultStyles, defaultRuntime, fontCss] = await Promise.all([
    composeSlidesHtml(options.rootDir),
    readAsset("./assets/default-styles.css"),
    readAsset("./assets/default-runtime.js"),
    fontFaceCss(),
  ]);
  const title =
    options.title ?? deriveDeckTitle(slidesHtml) ?? path.basename(path.resolve(options.rootDir));

  return `<!doctype html>
<html lang="${escapeHtml(lang)}" data-zerp-theme="${theme}" data-zerp-default-theme="${theme}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <style data-zerp="fonts">
${fontCss}
    </style>
    <style data-zerp="base">
${defaultStyles}
    </style>
  </head>
  <body>
${slidesHtml}
    <div class="progress" id="progress"></div>
    <div class="counter" id="counter"></div>
${THEME_SWITCH_HTML}
${NAV_HTML}
    <script>
${defaultRuntime}
    </script>
  </body>
</html>`;
}

export async function writePresentation(options: BuildOptions): Promise<string> {
  const outFile = options.outFile ?? path.join(options.rootDir, "index.html");
  const html = await buildPresentationHtml(options);
  await writeFile(outFile, html, "utf8");
  return outFile;
}
