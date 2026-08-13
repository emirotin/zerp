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

// End-to-end checkPresentation-level glyph coverage: judge-glyph.test.mjs
// already pins the judging logic against synthetic/recorded probes, but
// nothing exercised uncovered-glyph-deck and stack-coverage-deck through the
// real browser pipeline after the cascade-specific assertions that used to
// cover them were removed (they asserted old wording — see the file header).
test("characters no bundled face can draw are reported, attributed to their slide", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/uncovered-glyph-deck" });
  const coverage = report.findings.filter((f) => f.category === "glyph");
  const heading = coverage.find((f) => f.snippet.includes("日本語"));
  assert.ok(heading, "the <h2>'s uncovered characters are reported");
  assert.equal(heading.severity, "warning");
  assert.equal(heading.slideIndex, 1, "attributed to the slide, not the deck");
  assert.equal(heading.slideSrc, "slides/00-copy.html");
  assert.match(heading.message, /system font/);
  const item = coverage.find((f) => f.snippet.includes("※"));
  assert.ok(item, "the <li>'s uncovered character is reported");
  assert.equal(item.slideIndex, 1);
  // 🚀 is not listed at all — pictographs come from the platform's emoji font
  // everywhere, so warning about them would be true and useless.
  assert.ok(!coverage.some((f) => f.snippet.includes("🚀")), "pictographs are exempt everywhere");
});

test("an uncovered character on a later slide is attributed to its own slide, not the first", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/stack-coverage-deck" });
  const coverage = report.findings.filter((f) => f.category === "glyph");
  const first = coverage.find((f) => f.snippet.includes("Δ"));
  assert.ok(first);
  assert.equal(first.slideIndex, 1, "attributed to the slide, not the deck");
  const second = coverage.find((f) => f.snippet.includes("Ω"));
  assert.ok(second, "a later slide's uncovered text is reported too, not just the first offender");
  assert.equal(second.slideIndex, 2, "attributed to its own slide, not the first one");
  assert.equal(second.slideSrc, "slides/02-omega.html");
});

// Known gap, not this task's to fix (out of scope per task-7's fix-up round —
// the root cause is probe.ts's collect(), which reads each element's own
// direct text-node children and never sees CSS-generated content). Written
// as a test.todo carrying the INTENDED behavior, so it fails visibly today
// (see its output under the "todo" section) without failing `pnpm test`, and
// so a future fix flips it to passing instead of it having to be
// reconstructed from scratch. Deleting or silently downgrading this
// assertion to match the gap would be exactly the invisible-regression
// outcome this test exists to prevent.
test.todo("content: attr() text is judged, not silently dropped (currently: silently dropped)", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/uncovered-glyph-deck" });
  const coverage = report.findings.filter((f) => f.category === "glyph");
  // "≈" reaches the page only via `.compare[data-vs] { content: attr(data-vs) }`
  // — an attribute value read into a `::after` pseudo-element, not a text
  // node anywhere in the slide markup. The pre-browser cascade checker read
  // this by resolving `content:` declarations directly against parsed CSS;
  // the browser-backed probe only walks real DOM text nodes, so generated
  // content is currently invisible to it.
  const label = coverage.find((f) => f.snippet.includes("≈"));
  assert.ok(label, "content: attr() text should be judged, not silently dropped");
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

test("svg text is flagged once per slide, and duplicate themes are not double-counted", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/svg-text-deck" });
  const svgFindings = report.findings.filter((f) => f.category === "svg-text");
  // The fixture has a labelled svg and a second, aria-hidden decorative one on
  // the same slide (see the test.todo below for whether aria-hidden is
  // actually honored — this fixture's own text happens to sort first in DOM
  // order either way, so it cannot tell the two apart on its own). What this
  // pins is checker.ts's merge step: one finding, not one per requested theme.
  assert.equal(svgFindings.length, 1);
  const [finding] = svgFindings;
  assert.equal(finding.snippet, "Pocket 17");
});

// Known gap, not this task's to fix (see task-7-report.md and the
// coordinator's explicit "not in scope" ruling for this fix-up round:
// probe.ts's SLIDE_EXPRESSION collects svg text via a plain
// `querySelectorAll("svg text")`, with no aria-hidden check at all — unlike
// the pre-browser cascade checker's walkElements, which skipped aria-hidden
// subtrees). examples/casino's roulette wheel is the one svg with text in
// the whole deck and it is entirely aria-hidden (a decorative "0" pocket
// marker), so the intended finding count is zero; today it is one. Written
// as a test.todo carrying the INTENDED behavior — unlike svg-text-deck
// above, this fixture cannot mask the bug behind "reported once per slide,
// and the real label happens to sort first" — so it fails visibly today
// (see its output under the "todo" section) without failing
// `pnpm test`/`pnpm test:browser`, and a future probe.ts fix flips it to
// passing. This is also the only thing standing between the next task's job
// (triaging this exact finding) and quietly triaging it away by weakening
// coverage instead of fixing probe.ts.
test.todo("aria-hidden svg text opts out of the svg-text finding (examples/casino)", async () => {
  const report = await checkPresentation({ rootDir: "examples/casino" });
  const svgFindings = report.findings.filter((f) => f.category === "svg-text");
  assert.deepEqual(svgFindings, []);
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
