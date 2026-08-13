import assert from "node:assert/strict";
import { test } from "node:test";

import { checkPresentation } from "../dist/check/checker.js";
import { formatReport, reportHasFailures } from "../dist/check/report.js";

test("broken deck produces the expected finding classes in both themes", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/broken-deck" });
  assert.equal(report.slideCount, 1);
  const messages = report.findings.map((f) => `${f.theme}:${f.severity}:${f.message}`);
  assert.ok(messages.some((m) => m.includes("dark:error") && m.includes("below the 14px")));
  assert.ok(messages.some((m) => m.startsWith("light:error")));
  assert.ok(
    report.findings.some(
      (f) => f.severity === "unverifiable" && f.message.includes("background image"),
    ),
  );
  assert.ok(report.findings.some((f) => f.severity === "error" && f.message.includes("#6a6f78")));
  const surface = report.findings.filter(
    (f) => f.severity === "warning" && f.message.includes("blends into"),
  );
  assert.equal(surface.length, 2, "ghost panel flagged in both themes");
  assert.ok(surface[0].suggestion.includes("stronger tint"));
  const suggested = report.findings.find((f) => f.suggestion !== null);
  assert.ok(suggested && suggested.suggestion.includes("var(--zerp-"));
  assert.deepEqual(report.skippedSelectors, [".door:hover"]);
  assert.equal(reportHasFailures(report, false), true);
  const text = formatReport(report);
  assert.match(text, /slide 1 \(slides\/00-bad\.html\) \[dark\]/);
  assert.match(text, /✗/);
});

test("clean deck passes with no findings", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/clean-deck" });
  assert.deepEqual(report.findings, []);
  assert.equal(reportHasFailures(report, true), false);
  assert.match(formatReport(report), /all clear/);
});

test("svg text is flagged once, and aria-hidden opts out", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/svg-text-deck" });
  const svgFindings = report.findings.filter((f) => f.message.includes("<svg>"));
  // The fixture's labelled svg is flagged; the aria-hidden decorative one is
  // not, and a structural finding is not repeated per theme.
  assert.equal(svgFindings.length, 1);
  const [finding] = svgFindings;
  assert.equal(finding.severity, "warning");
  assert.equal(finding.snippet, "Pocket 17");
  assert.match(finding.suggestion, /HTML positioned over the svg/);
  // The label is 8px and painted with --zerp-faint, and nothing else in the
  // report says so: that silence is what the warning exists to break.
  assert.deepEqual(
    report.findings.filter((f) => f.severity === "error"),
    [],
  );
  // Follows the established severity model: a warning, escalated by --strict.
  assert.equal(reportHasFailures(report, false), false);
  assert.equal(reportHasFailures(report, true), true);
});

test("characters no bundled face can draw are reported once per element, attributed to their slide", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/uncovered-glyph-deck" });
  const coverage = report.findings.filter((f) => f.message.includes("no glyph"));
  // One finding per offending element, not one per character and not one per
  // theme: the heading, the list item, and the data-vs label each fail
  // through the same stack, so each gets its own finding rather than a
  // single deck-wide bucket.
  assert.equal(coverage.length, 3);
  const heading = coverage.find((f) => f.message.includes("<h2>"));
  assert.ok(heading);
  assert.equal(heading.severity, "warning");
  assert.equal(heading.slideIndex, 1, "attributed to the slide, not the deck");
  assert.equal(heading.slideSrc, "slides/00-copy.html");
  assert.equal(heading.snippet, "日 本 語");
  assert.match(heading.message, /3 characters \(U\+65E5, U\+672C, U\+8A9E\) in <h2>/);
  assert.match(heading.message, /Montserrat/, "names the stack that failed");
  assert.match(heading.message, /system fallback/);
  const item = coverage.find((f) => f.message.includes("<li>"));
  assert.ok(item);
  assert.equal(item.slideIndex, 1);
  assert.equal(item.snippet, "※");
  assert.match(item.message, /1 character \(U\+203B\) in <li>/);
  // "≈" reaches the page only via `.compare[data-vs]::after { content:
  // attr(data-vs) }` — an attribute value, not a literal anywhere in the
  // slide markup or the stylesheet. Judging it requires reading the
  // attribute off the matched element, which is what restores this case.
  const label = coverage.find((f) => f.message.includes("::after"));
  assert.ok(label, "content: attr() text is judged, not silently dropped");
  assert.equal(label.slideIndex, 1);
  assert.equal(label.snippet, "≈");
  assert.match(label.message, /1 character \(U\+2248\) in <div class="compare">::after/);
  // 🚀 is not listed at all — pictographs come from the platform's emoji font
  // everywhere, so warning about them would be true and useless.
  assert.ok(
    ![heading, item, label].some((f) => f.message.includes("U+1F680")),
    "pictographs are exempt everywhere, not just in the elements checked above",
  );
  // Follows the established severity model: a warning, escalated by --strict.
  assert.equal(reportHasFailures(report, false), false);
  assert.equal(reportHasFailures(report, true), true);
  assert.match(formatReport(report), /slide 1 \(slides\/00-copy\.html\) \[dark\]/);
});

test("an uncovered character names its slide, its element and its stack", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/stack-coverage-deck" });
  const coverage = report.findings.filter((entry) => entry.message.includes("no glyph"));
  const first = coverage.find(
    (entry) => entry.snippet.includes("Δ") && entry.message.includes("<h1>"),
  );
  assert.ok(first);
  assert.equal(first.severity, "warning");
  assert.equal(first.slideIndex, 1, "attributed to the slide, not the deck");
  assert.match(first.message, /Montserrat/, "the stack that failed");
  assert.match(first.snippet, /Δ/);
  // A second offending slide, further down the deck: pins that attribution
  // follows the actual slide the text sits on rather than always landing on
  // slide 1 — a bug that hardcoded the first slide would still pass the
  // assertion above.
  const second = coverage.find(
    (entry) => entry.snippet.includes("Ω") && entry.message.includes("<h1>"),
  );
  assert.ok(second, "a later slide's uncovered text is reported too, not just the first offender");
  assert.equal(second.slideIndex, 2, "attributed to its own slide, not the first one");
  assert.equal(second.slideSrc, "slides/02-omega.html");
});

test("a clean deck reports no coverage findings", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/clean-deck" });
  assert.equal(report.findings.filter((entry) => entry.message.includes("no glyph")).length, 0);
});

test("the decks that ship stay covered", async () => {
  for (const rootDir of ["test/fixtures/kitchen-sink", "examples/casino"]) {
    const report = await checkPresentation({ rootDir });
    assert.deepEqual(
      report.findings.filter((f) => f.message.includes("no glyph")),
      [],
      `${rootDir} draws every character it renders`,
    );
  }
});

const findingAt = (overrides) => ({
  severity: "error",
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
    skippedSelectors: [],
  });
  assert.match(out, /slide 30 \(slides\/28-attention\.html · 2\/2 in file\) \[dark\]/);
});

test("report omits the ordinal for single-slide files", () => {
  const out = formatReport({
    slideCount: 1,
    themes: ["dark", "light"],
    findings: [findingAt({ slideSrcSlide: "1/1" })],
    skippedSelectors: [],
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
