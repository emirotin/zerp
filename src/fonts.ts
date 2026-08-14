import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type DeckFontConfig, readDeckConfig } from "./deck-config.js";

const require = createRequire(import.meta.url);

// zerp's own type pair, and the weights base-styles.css actually asks for.
// A deck may name others (see DeckFontConfig); these are the fallback and the
// default weight list both roles inherit.
const BODY = {
  family: "Montserrat",
  pkg: "@fontsource/montserrat",
  weights: ["400", "600", "700", "900", "400-italic"],
};
const MONO = { family: "Roboto Mono", pkg: "@fontsource/roboto-mono", weights: ["400", "700"] };

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

async function readFaceBlocks(cssPath: string, pkg: string, face: string): Promise<FaceBlock[]> {
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

function faceBlocks(cssPath: string, pkg: string, face: string): Promise<FaceBlock[]> {
  const cached = blockCache.get(cssPath);
  if (cached) {
    return cached;
  }
  const blocks = readFaceBlocks(cssPath, pkg, face);
  blockCache.set(cssPath, blocks);
  return blocks;
}

/**
 * Resolve a fontsource weight from the DECK first and zerp second.
 *
 * A deck naming its own family installs that package itself — zerp cannot
 * depend on families it does not know about — so the deck's node_modules is
 * the authority. Falling back to zerp's own resolution is what lets a deck
 * name one of the bundled families to trim its weights without also having to
 * install it.
 */
function resolveFaceCss(deckRequire: NodeRequire, pkg: string, face: string): string | null {
  for (const resolver of [deckRequire, require]) {
    try {
      return resolver.resolve(`${pkg}/${face}.css`);
    } catch {
      // Not installed here; try the next place.
    }
  }
  return null;
}

type FontRole = "body" | "display" | "mono";

interface FamilyPlan {
  role: FontRole;
  /** The family name the emitted stacks will use. */
  family: string;
  pkg: string;
  weights: string[];
  /** True when the deck asked for this family rather than taking the default. */
  configured: boolean;
}

function slugify(family: string): string {
  return family.toLowerCase().replaceAll(/\s+/g, "-");
}

// The fallback is a resolved plan, not a constant, because `display` inherits
// the family the DECK chose for body — a deck that sets body to Inter and says
// nothing about display gets Inter headings, not Montserrat ones.
function familyPlan(
  role: FontRole,
  config: DeckFontConfig | undefined,
  fallback: Omit<FamilyPlan, "role" | "configured">,
): FamilyPlan {
  if (!config) {
    // fallback's own `role` (e.g. body's, when display inherits it) must not
    // leak into this plan's role, so it is spread first and overridden after.
    return { ...fallback, role, configured: false };
  }
  return {
    role,
    family: config.family,
    pkg: config.fontsourcePackage ?? `@fontsource/${slugify(config.family)}`,
    // Missing weights are simply not emitted: the browser synthesizes what it
    // needs and zerp's own type scale only asks for what the defaults ship.
    weights: config.weights ?? fallback.weights,
    configured: true,
  };
}

async function planBlocks(rootDir: string, plan: FamilyPlan): Promise<FaceBlock[]> {
  const deckRequire = createRequire(path.join(path.resolve(rootDir), "package.json"));
  const blocks: FaceBlock[] = [];
  for (const face of plan.weights) {
    const cssPath = resolveFaceCss(deckRequire, plan.pkg, face);
    if (cssPath) {
      blocks.push(...(await faceBlocks(cssPath, plan.pkg, face)));
    }
  }
  if (blocks.length === 0) {
    throw new Error(
      `Cannot resolve "${plan.pkg}" for the ${plan.role} font (tried ${plan.weights.map((face) => `${face}.css`).join(", ")}). ` +
        `The deck names it in zerp.fonts.${plan.role}, so the deck installs it: pnpm add ${plan.pkg}`,
    );
  }
  const declared = blocks.find((block) => block.family === plan.family);
  if (!declared) {
    throw new Error(
      `"${plan.pkg}" declares font-family "${blocks[0]?.family}", but zerp.fonts.${plan.role}.family says "${plan.family}". Use the name the package declares.`,
    );
  }
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
 *
 * The same selection runs over a deck's own families, so a configured
 * Noto Sans JP is carried exactly one chunk at a time — which is the only way
 * a CJK family can be carried at all.
 */
async function selectFaceBlocks(
  rootDir: string,
  plans: FamilyPlan[],
  codepoints: ReadonlySet<number>,
): Promise<FaceBlock[]> {
  const selected: FaceBlock[] = [];
  // Keyed by woff2, so a deck that sets body and mono to the same family
  // inlines each file once instead of paying for it twice.
  const seen = new Set<string>();
  for (const plan of plans) {
    for (const block of await planBlocks(rootDir, plan)) {
      if (seen.has(block.file)) {
        continue;
      }
      if (block.subset === ALWAYS || rangesTouch(block.ranges, codepoints)) {
        seen.add(block.file);
        selected.push(block);
      }
    }
  }
  selected.push(symbolBlock);
  return selected;
}

async function planFamilies(rootDir: string): Promise<FamilyPlan[]> {
  const config = await readDeckConfig(rootDir);
  // Body first: display falls back to it, so it has to exist to be inherited.
  const body = familyPlan("body", config.fonts?.body, BODY);
  return [
    body,
    familyPlan("display", config.fonts?.display, body),
    familyPlan("mono", config.fonts?.mono, MONO),
  ];
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
 * The five family tokens, or "" when the deck takes zerp's own families.
 *
 * base-styles.css defines these with the defaults, so this is emitted after it
 * and only when it has something to say. A deck that configures nothing gets
 * the byte-for-byte document it got before the tokens existed.
 */
function familyTokenCss(plans: FamilyPlan[]): string {
  if (!plans.some((plan) => plan.configured)) {
    return "";
  }
  const familyOf = (role: FontRole, fallback: string): string =>
    plans.find((plan) => plan.role === role)?.family ?? fallback;
  const body = familyOf("body", BODY.family);
  const display = familyOf("display", BODY.family);
  const mono = familyOf("mono", MONO.family);
  const symbols = `"${SYMBOL_FACE.family}"`;
  return `:root {
  --zerp-font-body: "${body}", ${symbols}, sans-serif;
  --zerp-font-display: "${display}", ${symbols}, sans-serif;
  --zerp-font-marker: ${symbols}, "${body}", sans-serif;
  --zerp-font-mono: "${mono}", ${symbols}, monospace;
  --zerp-font-nav: "${mono}", monospace;
}`;
}

/** The two stylesheets a deck's fonts contribute. */
export interface FontCss {
  /** `@font-face` blocks with woff2 data URLs — self-contained, offline. */
  faces: string;
  /** `:root` family tokens, empty unless the deck configured its own. */
  tokens: string;
}

/**
 * Build a deck's font CSS: the subsets its text needs, in the families it
 * asked for.
 *
 * The result is a function of the deck, so it is not cached as a whole; the
 * file reads and base64 behind it are. `zerp serve` rebuilds the document per
 * request and therefore re-selects per request, which is what keeps live
 * reload honest when a slide gains a character in a new script. (A change to
 * package.json needs a server restart — serve watches slides/.)
 */
export async function fontCss(rootDir: string, codepoints: ReadonlySet<number>): Promise<FontCss> {
  const plans = await planFamilies(rootDir);
  const blocks = await selectFaceBlocks(rootDir, plans, codepoints);
  const faces: string[] = [];
  for (const block of blocks) {
    faces.push(await inline(block));
  }
  return { faces: faces.join("\n"), tokens: familyTokenCss(plans) };
}
