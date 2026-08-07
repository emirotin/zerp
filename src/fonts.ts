import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const FONT_FACES = [
  { pkg: "@fontsource/montserrat", faces: ["400", "600", "700", "900", "400-italic"] },
  { pkg: "@fontsource/roboto-mono", faces: ["400", "700"] },
];

// The floor. Latin is in every deck whether its text says so or not: the
// framework's own chrome is latin, so is every fallback the browser reaches
// for, and a deck is never so far from it that leaving it out would be safe.
const ALWAYS = "latin";

const FACE_BLOCK = /\/\* ([a-z0-9-]+) \*\/\s*@font-face \{[^}]*\}/g;

// zerp draws two markers with a right arrow (the ul bullet and the .flow
// connector) and decks type one in prose, but neither bundled family covers
// U+2192: Montserrat's latin subset has ↑ ↓ • and no →, Roboto Mono's has no
// arrows at all. Left unresolved the glyph comes from whatever the viewing
// machine falls back to — a different shape per OS in the browser, and
// re-resolved by the reader's machine once a deck is exported to a format
// whose text runs carry a single font face. This 812-byte face carries the
// one glyph; unicode-range keeps it from ever serving another character, so
// naming it in a font stack is inert for everything else. It costs less than
// a rounding error, and zerp's own markers need it, so it is never deselected.
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

/** One `@font-face` a built deck carries, without its payload. */
export interface FontFaceInfo {
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
}

interface FaceBlock extends FontFaceInfo {
  /** The block as fontsource wrote it, `src` still pointing at ./files/. */
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

/** Whether a codepoint falls inside any of the ranges. */
export function rangesContain(ranges: readonly CodepointRange[], codepoint: number): boolean {
  return ranges.some((range) => codepoint >= range.first && codepoint <= range.last);
}

function rangesTouch(ranges: readonly CodepointRange[], codepoints: Iterable<number>): boolean {
  for (const codepoint of codepoints) {
    if (rangesContain(ranges, codepoint)) {
      return true;
    }
  }
  return false;
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

// Parsing a fontsource stylesheet is cheap and its result never changes, so
// every subset it declares is parsed once, selected from later, and only the
// selected ones are ever read off disk.
const blockCache = new Map<string, Promise<FaceBlock[]>>();

async function readFaceBlocks(pkg: string, face: string): Promise<FaceBlock[]> {
  const cssPath = require.resolve(`${pkg}/${face}.css`);
  const filesDir = path.join(path.dirname(cssPath), "files");
  const family = pkg.split("/")[1] ?? "";
  const css = await readFile(cssPath, "utf8");
  const blocks: FaceBlock[] = [];

  for (const match of css.matchAll(FACE_BLOCK)) {
    const block = match[0];
    const woff2Match = block.match(/url\(\.\/files\/([^)]+\.woff2)\)/);
    if (!woff2Match) {
      continue;
    }
    blocks.push({
      family: block.match(/font-family:\s*'([^']+)'/)?.[1] ?? family,
      subset: subsetOf(match[1] ?? "", family, face),
      file: path.join(filesDir, woff2Match[1] ?? ""),
      ranges: parseUnicodeRange(block.match(/unicode-range:\s*([^;]+);/)?.[1] ?? ""),
      css: block,
    });
  }

  return blocks;
}

function faceBlocks(pkg: string, face: string): Promise<FaceBlock[]> {
  const key = `${pkg}/${face}`;
  const cached = blockCache.get(key);
  if (cached) {
    return cached;
  }
  const blocks = readFaceBlocks(pkg, face);
  blockCache.set(key, blocks);
  return blocks;
}

const symbolBlock: FaceBlock = {
  family: SYMBOL_FACE.family,
  subset: "symbols",
  file: fileURLToPath(new URL(SYMBOL_FACE.file, import.meta.url)),
  ranges: parseUnicodeRange(SYMBOL_FACE.unicodeRange),
  css: `/* zerp-symbols-400-normal */
@font-face {
  font-family: '${SYMBOL_FACE.family}';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(./files/zerp-symbols.woff2) format('woff2');
  unicode-range: ${SYMBOL_FACE.unicodeRange};
}`,
};

/**
 * The faces a deck's own text selects.
 *
 * A subset is carried when the deck renders at least one character its
 * `unicode-range` claims, which is exactly the condition under which the
 * browser would ever download it. Everything else is dead weight in a file
 * that has to travel as one document — and it is a lot of weight: the Google
 * Fonts CJK families are hundreds of ranges, so "bundle them all" was never
 * going to be the answer for anything beyond latin and cyrillic.
 *
 * Pass the FULL document codepoints, chrome included, not slide content:
 * getting this wrong costs a reader a fallback glyph, while getting it
 * generously wrong costs bytes.
 */
async function selectFaceBlocks(codepoints: ReadonlySet<number>): Promise<FaceBlock[]> {
  const selected: FaceBlock[] = [];
  for (const { pkg, faces } of FONT_FACES) {
    for (const face of faces) {
      for (const block of await faceBlocks(pkg, face)) {
        if (block.subset === ALWAYS || rangesTouch(block.ranges, codepoints)) {
          selected.push(block);
        }
      }
    }
  }
  selected.push(symbolBlock);
  return selected;
}

/** The faces a deck's own text selects — see {@link selectFaceBlocks}. */
export function selectedFaces(codepoints: ReadonlySet<number>): Promise<FontFaceInfo[]> {
  return selectFaceBlocks(codepoints);
}

// Base64-encoding a woff2 is the expensive half of a build and the same file
// is inlined into several weights' worth of nothing, so encode each once.
const dataUrlCache = new Map<string, Promise<string>>();

function dataUrl(file: string): Promise<string> {
  const cached = dataUrlCache.get(file);
  if (cached) {
    return cached;
  }
  const encoded = readFile(file).then(
    (data) => `data:font/woff2;base64,${data.toString("base64")}`,
  );
  dataUrlCache.set(file, encoded);
  return encoded;
}

async function inline(block: FaceBlock): Promise<string> {
  return block.css.replace(
    /src: [^;]+;/,
    `src: url(${await dataUrl(block.file)}) format("woff2");`,
  );
}

/**
 * Self-contained @font-face CSS with woff2 data URLs (offline decks), for the
 * subsets this deck's text needs.
 *
 * The result is a function of the deck, so it is not cached as a whole; the
 * file reads and base64 behind it are. `zerp serve` rebuilds the document per
 * request and therefore re-selects per request, which is what keeps live
 * reload honest when a slide gains a character in a new script.
 */
export async function fontFaceCss(codepoints: ReadonlySet<number>): Promise<string> {
  const blocks = await selectFaceBlocks(codepoints);
  const css: string[] = [];
  for (const block of blocks) {
    css.push(await inline(block));
  }
  return css.join("\n");
}
