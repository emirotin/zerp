import assert from "node:assert/strict";
import { test } from "node:test";

import { coveredCodepoints, uncoveredCodepoints } from "../dist/check/coverage.js";

const cp = (character) => character.codePointAt(0);
const setOf = (text) => new Set([...text].map(cp));
// Any deck with no font config of its own: coverage follows zerp's families.
const deck = "test/fixtures/clean-deck";

test("coverage is every selected face's cmap, clipped to its declared range", async () => {
  const covered = await coveredCodepoints(deck, setOf("Ж"));
  assert.ok(covered.has(cp("A")), "latin, always carried");
  assert.ok(covered.has(cp("Ж")), "cyrillic, because the deck asked for it");
  assert.ok(covered.has(cp("↓")), "an arrow Montserrat's latin subset carries");
  assert.ok(covered.has(cp("→")), "the one the symbol face was added for");
  assert.ok(!covered.has(cp("≈")), "in no subset's range and in no subset's cmap");
  assert.ok(!covered.has(cp("※")), "inside the latin range, absent from the file");
});

test("a deck that carries no cyrillic is not credited with cyrillic glyphs", async () => {
  const covered = await coveredCodepoints(deck, setOf("Latin only"));
  assert.ok(covered.has(cp("A")));
  // The build would not inline that subset, so the audit must not pretend it
  // did: coverage follows selection.
  assert.ok(!covered.has(cp("Ж")));
});

test("uncovered judges slide content against what the full document selects", async () => {
  const missing = await uncoveredCodepoints(deck, {
    // Cyrillic arrives only through chrome/script text here, which is enough
    // to pull the subset in — and that is what makes Ж covered below.
    full: setOf("AЖ→≈日🚀🇺🇸"),
    slideContent: setOf("AЖ→≈日🚀🇺🇸"),
  });
  // Pictographs and flags are exempt; A, Ж and → are covered.
  assert.deepEqual(missing, [cp("≈"), cp("日")]);
});

test("chrome-only characters are never warned about", async () => {
  const missing = await uncoveredCodepoints(deck, {
    full: setOf("Deck ←"),
    slideContent: setOf("Deck"),
  });
  // ← is the nav button. No bundled face covers it, and it is zerp's own.
  assert.deepEqual(missing, []);
});
