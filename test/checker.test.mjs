import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPresentation } from "../dist/check/checker.js";
import { formatReport, reportHasFailures } from "../dist/check/report.js";
import { resolveBrowserExecutable } from "../dist/verify.js";

const browserTestsEnabled = process.env.ZERP_RUN_BROWSER_TEST === "1";

function chromeAvailable() {
  try {
    return Boolean(resolveBrowserExecutable());
  } catch {
    return false;
  }
}

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

// Was a test.todo while probe.ts's collect() read only real text nodes; it now
// records each element's resolved ::before/::after content too.
test("content: attr() text is judged, not silently dropped", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/uncovered-glyph-deck" });
  const coverage = report.findings.filter((f) => f.category === "glyph");
  // "≈" reaches the page only via `.compare[data-vs] { content: attr(data-vs) }`
  // — an attribute value read into a `::after` pseudo-element, not a text
  // node anywhere in the slide markup, so the finding can only come from the
  // probe reading the pseudo-element's resolved `content`.
  const label = coverage.find((f) => f.snippet.includes("≈"));
  assert.ok(label, "content: attr() text should be judged, not silently dropped");
  assert.equal(label.slideIndex, 1);
  assert.equal(label.slideSrc, "slides/00-copy.html");
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
    viewport: { width: 1920, height: 1080, defaulted: true },
    findings: [findingAt({})],
  });
  assert.match(out, /slide 30 \(slides\/28-attention\.html · 2\/2 in file\) \[dark\]/);
});

test("report omits the ordinal for single-slide files", () => {
  const out = formatReport({
    slideCount: 1,
    themes: ["dark", "light"],
    viewport: { width: 1920, height: 1080, defaulted: true },
    findings: [findingAt({ slideSrcSlide: "1/1" })],
  });
  assert.match(out, /slide 30 \(slides\/28-attention\.html\) \[dark\]/);
});

test("svg text is flagged once per slide, and duplicate themes are not double-counted", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/svg-text-deck" });
  const svgFindings = report.findings.filter((f) => f.category === "svg-text");
  // The fixture has a labelled svg and a second, aria-hidden decorative one on
  // the same slide. What this pins is checker.ts's merge step: one finding,
  // not one per requested theme (the aria-hidden opt-out itself is pinned by
  // the casino test below, on a deck where it is the only svg text).
  assert.equal(svgFindings.length, 1);
  const [finding] = svgFindings;
  assert.equal(finding.snippet, "Pocket 17");
});

test("text inside an svg is reported only by the svg rule, not contrast or type-size", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/svg-text-deck" });
  // The fixture's <text> carries fill="var(--zerp-faint)" and font-size="8" in
  // svg's own coordinate space. Judging it as HTML read the inherited `color`
  // (a colour the graphic never paints with) and the raw 8 as CSS pixels, so
  // it produced a contrast pair and a type-size floor that describe nothing on
  // screen. That is exactly what the svg-text warning exists to say instead.
  assert.deepEqual(
    report.findings.filter((f) => f.category === "contrast" || f.category === "type-size"),
    [],
  );
});

// examples/casino's roulette wheel is the one svg with text in the whole deck
// and it is entirely aria-hidden (decorative pocket markers), so the deck must
// report no svg-text finding at all. Was a test.todo while probe.ts collected
// svg text with a plain `querySelectorAll("svg text")`; unlike svg-text-deck
// above, this deck cannot mask the bug behind "reported once per slide, and
// the real label happens to sort first".
test("aria-hidden svg text opts out of the svg-text finding (examples/casino)", async () => {
  const report = await checkPresentation({ rootDir: "examples/casino" });
  const svgFindings = report.findings.filter((f) => f.category === "svg-text");
  assert.deepEqual(svgFindings, []);
});

test(
  "a deck's declared size is the default check viewport",
  { skip: !browserTestsEnabled || !chromeAvailable() },
  async () => {
    const report = await checkPresentation({
      rootDir: "test/fixtures/size-deck",
      themes: ["light"],
    });
    assert.deepEqual(report.viewport, {
      width: 1280,
      height: 720,
      defaulted: true,
      source: "deck",
    });
  },
);

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
