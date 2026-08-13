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
  const marker = found.find((entry) => entry.element.endsWith("::after"));
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

test("a default deck is clean", async () => {
  assert.deepEqual(await uncoveredInSlides({ rootDir: "test/fixtures/clean-deck" }), []);
});

test("chrome is never judged", async () => {
  // ← is the nav button's label and no bundled face covers it. It is zerp's
  // own, and it is not slide content.
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/clean-deck" });
  assert.ok(!found.some((entry) => entry.codepoints.includes(cp("←"))));
});
