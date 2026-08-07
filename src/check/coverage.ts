import { readFile } from "node:fs/promises";

import { bundledFaces, type CodepointRange } from "../fonts.js";
import { woff2Codepoints } from "../woff2.js";

/**
 * Which characters a built deck has a glyph for, and which it does not.
 *
 * The model is the union of every bundled face: a character is covered if any
 * one of them can draw it. Which face a given font stack would actually reach
 * for is a harder question and deliberately not asked here — the useful
 * warning is "this deck ships no glyph for this character at all", and that is
 * the one that survives being exported.
 */

// Pictographs are exempt. No text font carries them: every platform draws
// them from its own colour emoji font by design, which is also what an export
// pipeline does, so "uncovered" would be true, universal, and useless. Flag
// sequences are regional indicators rather than pictographs, hence both.
const EXEMPT = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;

const cmapCache = new Map<string, Promise<Set<number>>>();

function cmapOf(file: string): Promise<Set<number>> {
  const cached = cmapCache.get(file);
  if (cached) {
    return cached;
  }
  const codepoints = readFile(file).then(woff2Codepoints);
  cmapCache.set(file, codepoints);
  return codepoints;
}

function inRanges(codepoint: number, ranges: readonly CodepointRange[]): boolean {
  return ranges.some((range) => codepoint >= range.first && codepoint <= range.last);
}

/**
 * The codepoints a built deck can draw: each face's cmap intersected with the
 * `unicode-range` its `@font-face` declares, since the browser never consults
 * a face outside that range however much the file happens to carry.
 */
export async function coveredCodepoints(): Promise<Set<number>> {
  const covered = new Set<number>();
  for (const face of await bundledFaces()) {
    const cmap = await cmapOf(face.file);
    for (const codepoint of cmap) {
      if (inRanges(codepoint, face.ranges)) {
        covered.add(codepoint);
      }
    }
  }
  return covered;
}

/** Codepoints of `wanted` that no bundled face can draw, lowest first. */
export async function uncoveredCodepoints(wanted: Iterable<number>): Promise<number[]> {
  const covered = await coveredCodepoints();
  const missing: number[] = [];
  for (const codepoint of wanted) {
    if (!covered.has(codepoint) && !EXEMPT.test(String.fromCodePoint(codepoint))) {
      missing.push(codepoint);
    }
  }
  return missing.sort((left, right) => left - right);
}
