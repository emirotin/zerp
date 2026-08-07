import assert from "node:assert/strict";
import { test } from "node:test";

import { scanDeckCodepoints } from "../dist/codepoints.js";
import { deckCodepoints } from "../dist/presentation.js";

const cp = (character) => character.codePointAt(0);
const has = (set, character) => set.has(cp(character));

test("slide text, digits and nothing that is only whitespace", () => {
  const { full, slideContent } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><p>Ёлка —​da</p></div>`,
  });
  for (const set of [full, slideContent]) {
    assert.ok(has(set, "Ё"), "cyrillic capital");
    assert.ok(has(set, "—"), "em dash");
    assert.ok(has(set, "0") && has(set, "9"), "counter digits are always in");
    // Space, no-break space and zero-width space have no glyph to miss.
    assert.ok(!has(set, " ") && !has(set, " ") && !has(set, "​"));
  }
});

test("css content literals and attr() values are text the deck renders", () => {
  const { slideContent } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><div class="compare" data-vs="↔"><p>a</p><p>b</p></div></div>`,
    css: [
      `.slide ul li::before { content: "\\2192 "; } .compare[data-vs]::after { content: attr(data-vs); }`,
    ],
  });
  // Drawn by CSS, present in no slide file.
  assert.ok(has(slideContent, "→"), "content: literal");
  // Named by the rule, so the attribute's value is copy.
  assert.ok(has(slideContent, "↔"), "content: attr(data-vs) value");
});

test("a deck's own <style> contributes its literals, not its source", () => {
  const { slideContent } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><style>/* ✈ never drawn */ .x::before { content: "✓"; }</style><p>a</p></div>`,
  });
  assert.ok(has(slideContent, "✓"), "deck-authored content: literal");
  assert.ok(!has(slideContent, "✈"), "css comments are source, not copy");
});

test("chrome and script text land in full only", () => {
  const { full, slideContent } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><p>a</p><script>var suits = "♥";</script></div>`,
    chromeHtml: `<div class="nav"><button>←</button></div>`,
  });
  // The nav's ← is framework chrome: zerp owns it, and it is display:none in
  // print and in every export path.
  assert.ok(has(full, "←") && !has(slideContent, "←"));
  // A string literal in a slide script may well be rendered, so it counts for
  // subset selection; it is not copy an author should be warned about.
  assert.ok(has(full, "♥") && !has(slideContent, "♥"));
});

test("a real deck's scan sees markdown, css markers and chrome", async () => {
  const { full, slideContent } = await deckCodepoints("test/fixtures/kitchen-sink");
  // Rendered markdown text.
  assert.ok(has(slideContent, "K"), "slide copy");
  // The ul marker is a framework content: literal.
  assert.ok(has(slideContent, "→"), "→ from .slide ul li::before");
  // The nav's arrows are chrome: full only.
  assert.ok(has(full, "←"), "← from the nav");
  assert.ok(!has(slideContent, "←"), "chrome is excluded from slide content");
  // The theme switch trigger, also chrome.
  assert.ok(has(full, "◐") && !has(slideContent, "◐"));
});
