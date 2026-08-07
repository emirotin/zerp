import assert from "node:assert/strict";
import { test } from "node:test";

import { coveredCodepoints, uncoveredCodepoints } from "../dist/check/coverage.js";

const cp = (character) => character.codePointAt(0);

test("coverage is every bundled face's cmap, clipped to its declared range", async () => {
  const covered = await coveredCodepoints();
  assert.ok(covered.has(cp("A")), "latin");
  assert.ok(covered.has(cp("Ж")), "cyrillic");
  assert.ok(covered.has(cp("↓")), "an arrow Montserrat's latin subset carries");
  assert.ok(covered.has(cp("→")), "the one the symbol face was added for");
  // Montserrat's cyrillic subset maps a few latin glyphs its unicode-range
  // excludes; the browser would never use them from that face, so neither
  // does this. U+0416 above proves the same file is being read.
  assert.ok(!covered.has(cp("≈")), "in no subset's range and in no subset's cmap");
  assert.ok(!covered.has(cp("※")), "inside the latin range, absent from the file");
});

test("uncovered reports what the deck cannot draw, minus pictographs", async () => {
  const wanted = ["A", "→", "≈", "日", "🚀", "🇺🇸"].map(cp);
  const missing = await uncoveredCodepoints(wanted);
  assert.deepEqual(missing, [cp("≈"), cp("日")]);
});
