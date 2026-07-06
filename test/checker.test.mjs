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
  const out = formatReport({ slideCount: 42, findings: [findingAt({})], skippedSelectors: [] });
  assert.match(out, /slide 30 \(slides\/28-attention\.html · 2\/2 in file\) \[dark\]/);
});

test("report omits the ordinal for single-slide files", () => {
  const out = formatReport({
    slideCount: 1,
    findings: [findingAt({ slideSrcSlide: "1/1" })],
    skippedSelectors: [],
  });
  assert.match(out, /slide 30 \(slides\/28-attention\.html\) \[dark\]/);
});
