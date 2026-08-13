import assert from "node:assert/strict";
import { test } from "node:test";

import { uncoveredInSlides } from "../dist/check/coverage.js";

const cp = (character) => character.codePointAt(0);

test("a character the element's own stack cannot draw is reported", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-coverage-deck" });
  const heading = found.find((entry) => entry.element.startsWith("<h1"));
  assert.ok(heading, "the h1 resolves through the display stack, which is Montserrat");
  assert.ok(heading.codepoints.includes(cp("Δ")));
  assert.match(heading.stack.join(","), /Montserrat/);
  // The same character in <code> resolves through Roboto Mono, which has greek.
  assert.ok(!found.some((entry) => entry.element.startsWith("<code")));
});

test("the union model's blind spot is the point of the change", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-coverage-deck" });
  // Greek IS bundled — Roboto Mono pulls it in. A union over every face would
  // therefore call the heading covered. Per-stack does not.
  assert.ok(found.length > 0, "still reported despite the subset being present");
});

test("a content: literal with no font-family of its own is judged against the element's stack", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-coverage-deck" });
  // .marker::after { content: "Δ" } sets no font-family, so it inherits
  // .marker's own stack — body's default, Montserrat, which has no greek.
  // This is the content:/pseudo-element half of the walk; delete it and this
  // assertion is the one that goes red.
  const marker = found.find(
    (entry) => entry.element.startsWith("<p class=") && entry.element.endsWith("::after"),
  );
  assert.ok(marker, "the ::after rule's content is judged, not skipped");
  assert.ok(marker.codepoints.includes(cp("Δ")));
});

test("an author's font-family override is followed", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-override-deck" });
  // h2's text is greek: covered only if `.slide h2 { font-family: var(--zerp-font-mono) }`
  // is actually honored (Roboto Mono has greek, the inherited Montserrat body
  // stack does not). Drop that rule locally and this goes red.
  assert.deepEqual(found, [], "the override is followed, so h2's greek text resolves");
});

test("a stack naming a family zerp does not bundle is left unjudged, not flagged wholesale", async () => {
  // The same greek the h2 needs an override to draw sits in an <h3> set to
  // `Georgia, serif` and an <h4> set to an undefined var() (which the cascade
  // renders as the literal "unresolved"). Neither family has a cmap here, so
  // the check cannot know what they draw. Report them and EVERY character in
  // the element lights up — the noisiest possible false positive.
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-override-deck" });
  assert.ok(!found.some((entry) => entry.element.startsWith("<h3")), "Georgia is unknowable");
  assert.ok(!found.some((entry) => entry.element.startsWith("<h4")), "unresolved is unknowable");
});

test("every matching element on a slide is judged, not just the first", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-coverage-deck" });
  // Two `.compare[data-vs]` rows on 03-compare.html, each with a different
  // uncovered character. The old `find` walk stopped at the first match per
  // slide, so ≠ would silently vanish; this pins that both are reported.
  const approx = found.find((entry) => entry.codepoints.includes(cp("≈")));
  const notEqual = found.find((entry) => entry.codepoints.includes(cp("≠")));
  assert.ok(approx, "the first .compare row's ≈ is reported");
  assert.ok(notEqual, "the second .compare row's ≠ is reported too, not just the first row's");
});

test("a bare-generic stack (font-family: serif) is still judged", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-coverage-deck" });
  // font-family: serif parses to an empty family list (no named family, just
  // a generic), and is still judged rather than skipped like an unknown named
  // family would be: the deck asked for system fallback outright.
  const generic = found.find(
    (entry) => entry.stack.length === 0 && entry.codepoints.includes(cp("Δ")),
  );
  assert.ok(generic, "an empty (generic-only) stack is still reported, not silently skipped");
});

test("a font family named through a deck-scoped custom property is still judged", async () => {
  // `.slide { --deck-font: "Montserrat", … }` is declared outside :root. While
  // that was invisible to the cascade the h2's stack resolved to the literal
  // "unresolved", which judgeText skips as unknowable — the deck's greek was
  // dropped from the glyph audit with no trace. This is that silent skip.
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/scoped-var-deck" });
  const heading = found.find((entry) => entry.element.startsWith("<h2"));
  assert.ok(heading, "the h2 resolves through the deck-scoped Montserrat stack");
  assert.ok(heading.codepoints.includes(cp("Δ")));
  assert.match(heading.stack.join(","), /Montserrat/);
});

test("a default deck is clean", async () => {
  assert.deepEqual(await uncoveredInSlides({ rootDir: "test/fixtures/clean-deck" }), []);
});

test("chrome is never judged", async () => {
  // ← is the nav button's label and no bundled face covers it. It is zerp's
  // own, and it is not slide content.
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/clean-deck" });
  assert.ok(!found.some((entry) => entry.codepoints.includes(cp("←"))));
});
