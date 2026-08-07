import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

/** An inclusive codepoint range, as written in a `unicode-range`. */
export interface CodepointRange {
  readonly first: number;
  readonly last: number;
}

/** One `@font-face` block a built deck inlines. */
export interface BundledFace {
  /** Family name the block declares. */
  family: string;
  /** fontsource subset slug (`latin`, `cyrillic-ext`, …). */
  subset: string;
  /** Absolute path of the woff2 the block inlines. */
  file: string;
  /**
   * The range the block declares. The browser consults the face for these
   * codepoints and no others, so a face's real coverage is its cmap
   * intersected with this.
   */
  ranges: readonly CodepointRange[];
  /** The block itself, `src` already rewritten to a data URL. */
  css: string;
}

/**
 * Parse a `unicode-range` value: comma-separated `U+XXXX`, `U+XXXX-YYYY` and
 * wildcard `U+XX??` forms. An unparseable token is dropped rather than guessed
 * at — a range that claims too little only costs a subset that was going to be
 * included anyway.
 */
export function parseUnicodeRange(value: string): CodepointRange[] {
  const ranges: CodepointRange[] = [];
  for (const token of value.split(",")) {
    const match = token.trim().match(/^u\+([0-9a-f?]{1,6})(?:-([0-9a-f]{1,6}))?$/i);
    if (!match) {
      continue;
    }
    const [, start = "", end] = match;
    if (start.includes("?")) {
      ranges.push({
        first: Number.parseInt(start.replaceAll("?", "0"), 16),
        last: Number.parseInt(start.replaceAll("?", "F"), 16),
      });
      continue;
    }
    const first = Number.parseInt(start, 16);
    ranges.push({ first, last: end === undefined ? first : Number.parseInt(end, 16) });
  }
  return ranges;
}

function subsetOf(slug: string, family: string, face: string): string {
  const [weight, style] = face.includes("-italic") ? face.split("-") : [face, "normal"];
  const prefix = `${family}-`;
  const suffix = `-${weight}-${style}`;
  if (!slug.startsWith(prefix) || !slug.endsWith(suffix)) {
    return "";
  }
  return slug.slice(prefix.length, slug.length - suffix.length);
}

// Reading and base64-encoding the woff2 files is the expensive half of this
// module and the result never changes within a process, so the parsed faces of
// each fontsource stylesheet are cached whole.
const faceCache = new Map<string, Promise<BundledFace[]>>();

async function readFontsourceFaces(pkg: string, face: string): Promise<BundledFace[]> {
  const cssPath = require.resolve(`${pkg}/${face}.css`);
  const filesDir = path.join(path.dirname(cssPath), "files");
  const family = pkg.split("/")[1] ?? "";
  const css = await readFile(cssPath, "utf8");
  const faces: BundledFace[] = [];

  for (const match of css.matchAll(FACE_BLOCK)) {
    const block = match[0];
    const woff2Match = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
    if (!woff2Match) {
      continue;
    }
    const file = path.join(filesDir, woff2Match[1] ?? "");
    const data = await readFile(file);
    const dataUrl = `data:font/woff2;base64,${data.toString("base64")}`;
    faces.push({
      family: block.match(/font-family:\s*'([^']+)'/)?.[1] ?? family,
      subset: subsetOf(match[1] ?? "", family, face),
      file,
      ranges: parseUnicodeRange(block.match(/unicode-range:\s*([^;]+);/)?.[1] ?? ""),
      css: block.replace(/src: [^;]+;/, `src: url(${dataUrl}) format("woff2");`),
    });
  }

  return faces;
}

function fontsourceFaces(pkg: string, face: string): Promise<BundledFace[]> {
  const key = `${pkg}/${face}`;
  const cached = faceCache.get(key);
  if (cached) {
    return cached;
  }
  const faces = readFontsourceFaces(pkg, face);
  faceCache.set(key, faces);
  return faces;
}

let symbolFaceCache: Promise<BundledFace> | null = null;

async function readSymbolFace(): Promise<BundledFace> {
  const file = new URL(SYMBOL_FACE.file, import.meta.url);
  const data = await readFile(file);
  const dataUrl = `data:font/woff2;base64,${data.toString("base64")}`;
  return {
    family: SYMBOL_FACE.family,
    subset: "symbols",
    file: fileURLToPath(file),
    ranges: parseUnicodeRange(SYMBOL_FACE.unicodeRange),
    css: `/* zerp-symbols-400-normal */
@font-face {
  font-family: '${SYMBOL_FACE.family}';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(${dataUrl}) format('woff2');
  unicode-range: ${SYMBOL_FACE.unicodeRange};
}`,
  };
}

function symbolFace(): Promise<BundledFace> {
  symbolFaceCache ??= readSymbolFace();
  return symbolFaceCache;
}

/** Every `@font-face` a built deck carries, in stylesheet order. */
export async function bundledFaces(): Promise<BundledFace[]> {
  const faces: BundledFace[] = [];
  for (const { pkg, faces: weights } of FONT_FACES) {
    for (const weight of weights) {
      for (const face of await fontsourceFaces(pkg, weight)) {
        if (SUBSETS.has(face.subset)) {
          faces.push(face);
        }
      }
    }
  }
  faces.push(await symbolFace());
  return faces;
}

/** Self-contained @font-face CSS with woff2 data URLs (offline decks). */
export async function fontFaceCss(): Promise<string> {
  return (await bundledFaces()).map((face) => face.css).join("\n");
}
