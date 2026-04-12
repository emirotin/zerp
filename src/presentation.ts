import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { defaultRuntime, defaultStyles } from "./default-template.js";

export interface BuildOptions {
  rootDir: string;
  title?: string;
  lang?: string;
  outFile?: string;
}

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
  const slideDir = path.posix.dirname(relativeSlidePath.replaceAll(path.sep, "/"));
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
        if (entry.isFile() && entry.name.endsWith(".html")) {
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

export async function buildPresentationHtml(options: BuildOptions): Promise<string> {
  const title = options.title ?? path.basename(path.resolve(options.rootDir));
  const lang = options.lang ?? "en";
  const slideFiles = await listSlides(options.rootDir);

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

export async function writePresentation(options: BuildOptions): Promise<string> {
  const outFile = options.outFile ?? path.join(options.rootDir, "index.html");
  const html = await buildPresentationHtml(options);
  await writeFile(outFile, html, "utf8");
  return outFile;
}
