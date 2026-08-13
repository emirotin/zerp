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

test("an author's font-family override is followed", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-override-deck" });
  assert.deepEqual(found, [], "latin-1 resolves in both families");
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
