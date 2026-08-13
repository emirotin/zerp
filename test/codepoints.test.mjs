import assert from "node:assert/strict";
import { test } from "node:test";

import { scanDeckCodepoints } from "../dist/codepoints.js";
import { deckCodepoints } from "../dist/presentation.js";

const cp = (character) => character.codePointAt(0);
const has = (set, character) => set.has(cp(character));

test("slide text, digits and nothing that is only whitespace", () => {
  const { full } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><p>Ёлка —​da</p></div>`,
  });
  assert.ok(has(full, "Ё"), "cyrillic capital");
  assert.ok(has(full, "—"), "em dash");
  assert.ok(has(full, "0") && has(full, "9"), "counter digits are always in");
  // Space, no-break space and zero-width space have no glyph to miss.
  assert.ok(!has(full, " ") && !has(full, " ") && !has(full, "​"));
});

test("css content literals and attr() values are text the deck renders", () => {
  const { full } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><div class="compare" data-vs="↔"><p>a</p><p>b</p></div></div>`,
    css: [
      `.slide ul li::before { content: "\\2192 "; } .compare[data-vs]::after { content: attr(data-vs); }`,
    ],
  });
  // Drawn by CSS, present in no slide file.
  assert.ok(has(full, "→"), "content: literal");
  // Named by the rule, so the attribute's value is copy.
  assert.ok(has(full, "↔"), "content: attr(data-vs) value");
});

test("a deck's own <style> contributes its literals, not its source", () => {
  const { full } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><style>/* ✈ never drawn */ .x::before { content: "✓"; }</style><p>a</p></div>`,
  });
  assert.ok(has(full, "✓"), "deck-authored content: literal");
  assert.ok(!has(full, "✈"), "css comments are source, not copy");
});

test("chrome and script text count towards the subsets a build carries", () => {
  const { full } = scanDeckCodepoints({
    slidesHtml: `<div class="slide"><p>a</p><script>var suits = "♥";</script></div>`,
    chromeHtml: `<div class="nav"><button>←</button></div>`,
  });
  // Framework chrome renders in the built document too, so its glyphs must be
  // selectable even though zerp owns the chrome rather than the author.
  assert.ok(has(full, "←"), "chrome text");
  // A string literal in a slide script may well be rendered, so it counts for
  // subset selection even though no static scan can see it actually render.
  assert.ok(has(full, "♥"), "script string literal");
});

test("a real deck's scan sees markdown, css markers and chrome", async () => {
  const { full } = await deckCodepoints("test/fixtures/kitchen-sink");
  // Rendered markdown text.
  assert.ok(has(full, "K"), "slide copy");
  // The ul marker is a framework content: literal.
  assert.ok(has(full, "→"), "→ from .slide ul li::before");
  // The nav's arrows are chrome, rendered in the built document.
  assert.ok(has(full, "←"), "← from the nav");
  // The theme toggle draws its sun/moon as SVG precisely so no font has to
  // carry those codepoints — it must contribute nothing to the scan.
  assert.ok(!has(full, "☀") && !has(full, "☾"), "theme toggle needs no glyphs");
});
