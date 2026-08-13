import { type FontFaceInfo, rangesContain } from "../fonts.js";

/**
 * Which face a font stack actually reaches for.
 *
 * The union model this replaces asked "can any bundled face draw this
 * character"; the browser asks "can the first family in *this element's* stack
 * draw it, and if not the second, and so on". The two agree only while every
 * element resolves through the same family, which stopped being true when
 * headings gained a face of their own.
 */

// A generic family is the end of the line: the browser satisfies it from the
// viewing machine, which is the fallback the whole check exists to warn about.
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/** Family names a `font-family` value lists, up to the first generic family. */
export function parseFontStack(value: string): string[] {
  const families: string[] = [];
  for (const part of value.split(",")) {
    const family = part
      .trim()
      .replace(/^["']|["']$/g, "")
      .trim();
    if (!family) {
      continue;
    }
    if (GENERIC.has(family.toLowerCase())) {
      break;
    }
    families.push(family);
  }
  return families;
}

/** Resolves characters against bundled faces, keyed by family name. */
export class StackResolver {
  private readonly byFamily = new Map<string, FontFaceInfo[]>();
  private readonly cmaps: ReadonlyMap<string, ReadonlySet<number>>;
  private readonly cache = new Map<string, boolean>();

  constructor(faces: readonly FontFaceInfo[], cmaps: ReadonlyMap<string, ReadonlySet<number>>) {
    this.cmaps = cmaps;
    for (const face of faces) {
      const key = face.family.toLowerCase();
      const list = this.byFamily.get(key);
      if (list) {
        list.push(face);
      } else {
        this.byFamily.set(key, [face]);
      }
    }
  }

  /**
   * Whether a family can draw a codepoint: some face of it must claim the
   * codepoint in its `unicode-range` AND carry it in its cmap. Weight is not
   * consulted — fontsource subsets share a cmap across weights, so any weight
   * answering for the family answers for all of them.
   */
  private familyDraws(family: string, codepoint: number): boolean {
    for (const face of this.byFamily.get(family.toLowerCase()) ?? []) {
      if (rangesContain(face.ranges, codepoint) && this.cmaps.get(face.file)?.has(codepoint)) {
        return true;
      }
    }
    return false;
  }

  /** Whether any family in the stack draws the codepoint. */
  resolves(stack: readonly string[], codepoint: number): boolean {
    const key = `${stack.join(",")}-${codepoint}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    let found = false;
    for (const family of stack) {
      if (this.familyDraws(family, codepoint)) {
        found = true;
        break;
      }
    }
    this.cache.set(key, found);
    return found;
  }
}
