import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPresentation } from "../dist/check/checker.js";
import { formatReport, reportHasFailures } from "../dist/check/report.js";

// The static-cascade-specific assertions that used to live here (exact
// glyph-coverage wording, skippedSelectors, svg-text/aria-hidden counting)
// were removed when checkPresentation moved onto the browser-backed
// probe/judge pipeline (see task-7-report.md): the old cascade produced
// different message text, and the equivalent coverage now lives in
// judge-contrast.test.mjs, judge-glyph.test.mjs, judge-surface.test.mjs,
// judge-structural.test.mjs (pure judge logic against recorded probes) and
// cli.test.mjs (end-to-end, including broken-deck).

test("clean deck passes with no findings", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/clean-deck" });
  assert.deepEqual(report.findings, []);
  assert.equal(reportHasFailures(report, true), false);
  assert.match(formatReport(report), /all clear/);
});

test("a deck-scoped colour variable gets a real contrast verdict", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/scoped-var-deck" });
  // `.slide { --deck-ink: #808080 }` is declared outside :root, so the old flat
  // var map never saw it and every consumer of it was written off as
  // unverifiable instead of being judged.
  assert.deepEqual(
    report.findings.filter((f) => f.severity === "unverifiable"),
    [],
  );
  const judged = report.findings.filter(
    (f) => f.severity === "error" && f.message.includes("#808080"),
  );
  assert.equal(judged.length, 2, "grey-on-grey is judged for real, in both themes");
});

test("a clean deck reports no coverage findings", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/clean-deck" });
  assert.equal(report.findings.filter((entry) => entry.category === "glyph").length, 0);
});

test("the decks that ship stay covered", async () => {
  for (const rootDir of ["test/fixtures/kitchen-sink", "examples/casino"]) {
    const report = await checkPresentation({ rootDir });
    assert.deepEqual(
      report.findings.filter((f) => f.category === "glyph"),
      [],
      `${rootDir} draws every character it renders`,
    );
  }
});

const findingAt = (overrides) => ({
  severity: "error",
  category: "contrast",
  theme: "dark",
  slideIndex: 30,
  slideSrc: "slides/28-attention.html",
  slideSrcSlide: "2/2",
  snippet: "x",
  message: "boom",
  suggestion: null,
  ...overrides,
});

test("report shows the in-file ordinal for multi-slide files", () => {
  const out = formatReport({
    slideCount: 42,
    themes: ["dark", "light"],
    findings: [findingAt({})],
  });
  assert.match(out, /slide 30 \(slides\/28-attention\.html · 2\/2 in file\) \[dark\]/);
});

test("report omits the ordinal for single-slide files", () => {
  const out = formatReport({
    slideCount: 1,
    themes: ["dark", "light"],
    findings: [findingAt({ slideSrcSlide: "1/1" })],
  });
  assert.match(out, /slide 30 \(slides\/28-attention\.html\) \[dark\]/);
});

test("checkPresentation restricts findings to the requested themes", async () => {
  const report = await checkPresentation({
    rootDir: "test/fixtures/broken-deck",
    themes: ["light"],
  });
  assert.deepEqual(report.themes, ["light"]);
  assert.ok(report.findings.length > 0, "broken deck still produces findings");
  assert.ok(
    report.findings.every((f) => f.theme === "light"),
    "only light findings when themes is [light]",
  );
  // The summary line names only the scoped theme, not both.
  const text = formatReport(report);
  assert.match(text, /light: \d+ errors/);
  assert.doesNotMatch(text, /dark: \d+ errors/);
});
