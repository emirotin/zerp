import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

const FONT_FACES = [
  { pkg: "@fontsource/montserrat", faces: ["400", "600", "700", "900", "400-italic"] },
  { pkg: "@fontsource/roboto-mono", faces: ["400", "700"] },
];

// latin/cyrillic plus their -ext ranges (European and Serbian diacritics);
// other subsets (vietnamese, …) are dropped to keep built decks lean.
const SUBSETS = new Set(["latin", "latin-ext", "cyrillic", "cyrillic-ext"]);

const FACE_BLOCK = /\/\* ([a-z0-9-]+) \*\/\s*@font-face \{[^}]*\}/g;

// zerp draws two markers with a right arrow (the ul bullet and the .flow
// connector) and decks type one in prose, but neither bundled family covers
// U+2192: Montserrat's latin subset has ↑ ↓ • and no →, Roboto Mono's has no
// arrows at all. Left unresolved the glyph comes from whatever the viewing
// machine falls back to — a different shape per OS in the browser, and
// re-resolved by the reader's machine once a deck is exported to a format
// whose text runs carry a single font face. This 812-byte face carries the
// one glyph; unicode-range keeps it from ever serving another character, so
// naming it in a font stack is inert for everything else.
// Provenance and the regeneration commands: ./assets/fonts/README.md.
const SYMBOL_FACE = {
  family: "Zerp Symbols",
  file: "./assets/fonts/zerp-symbols.woff2",
  unicodeRange: "U+2192",
};

function subsetOf(slug: string, family: string, face: string): string {
  const [weight, style] = face.includes("-italic") ? face.split("-") : [face, "normal"];
  const prefix = `${family}-`;
  const suffix = `-${weight}-${style}`;
  if (!slug.startsWith(prefix) || !slug.endsWith(suffix)) {
    return "";
  }
  return slug.slice(prefix.length, slug.length - suffix.length);
}

let cache: Promise<string> | null = null;

async function inlineFaceCss(pkg: string, face: string): Promise<string> {
  const cssPath = require.resolve(`${pkg}/${face}.css`);
  const filesDir = path.join(path.dirname(cssPath), "files");
  const family = pkg.split("/")[1] ?? "";
  const css = await readFile(cssPath, "utf8");
  const blocks: string[] = [];

  for (const match of css.matchAll(FACE_BLOCK)) {
    const slug = match[1] ?? "";
    if (!SUBSETS.has(subsetOf(slug, family, face))) {
      continue;
    }
    const block = match[0];
    const woff2Match = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
    if (!woff2Match) {
      continue;
    }
    const data = await readFile(path.join(filesDir, woff2Match[1] ?? ""));
    const dataUrl = `data:font/woff2;base64,${data.toString("base64")}`;
    blocks.push(block.replace(/src: [^;]+;/, `src: url(${dataUrl}) format("woff2");`));
  }

  return blocks.join("\n");
}

async function inlineSymbolFaceCss(): Promise<string> {
  const data = await readFile(new URL(SYMBOL_FACE.file, import.meta.url));
  const dataUrl = `data:font/woff2;base64,${data.toString("base64")}`;
  return `/* zerp-symbols-400-normal */
@font-face {
  font-family: '${SYMBOL_FACE.family}';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(${dataUrl}) format('woff2');
  unicode-range: ${SYMBOL_FACE.unicodeRange};
}`;
}

async function buildFontCss(): Promise<string> {
  const parts: string[] = [];
  for (const { pkg, faces } of FONT_FACES) {
    for (const face of faces) {
      parts.push(await inlineFaceCss(pkg, face));
    }
  }
  parts.push(await inlineSymbolFaceCss());
  return parts.join("\n");
}

/** Self-contained @font-face CSS with woff2 data URLs (offline decks). */
export function fontFaceCss(): Promise<string> {
  cache ??= buildFontCss();
  return cache;
}
