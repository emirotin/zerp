import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { judge } from "../dist/check/judge.js";

const loadProbe = (name) => JSON.parse(readFileSync(`test/fixtures/probes/${name}.json`, "utf8"));

const withFonts = (snippet, fonts) => ({
  theme: "dark",
  width: 1920,
  height: 1080,
  sizeDefaulted: false,
  frameCount: 1,
  slideCount: 1,
  innerSlideCount: 1,
  browserErrors: [],
  slides: [
    {
      index: 1,
      src: null,
      srcSlide: null,
      activeCount: 1,
      visibleCount: 1,
      activeIndex: 1,
      bodyHeight: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      activeDisplay: "flex",
      activeClass: true,
      activeRect: null,
      safeZoneItems: null,
      svgTextSnippets: [],
      elements: [
        {
          id: 0,
          tag: "h1",
          className: null,
          snippet,
          hasOwnText: true,
          color: "rgb(255,255,255)",
          backgroundColor: "rgb(18,20,28)",
          backgroundImage: "none",
          fontSizePx: 51,
          fontWeight: 900,
          opacity: 1,
          boxShadow: "none",
          borderWidthPx: 0,
          borderColor: "rgb(0,0,0)",
          parent: null,
          fonts,
        },
      ],
    },
  ],
});

test("a system font drawing glyphs is reported as fallback", () => {
  const findings = judge(
    withFonts("Δέλτα", [{ familyName: "Helvetica", glyphCount: 5, isCustomFont: false }]),
  ).filter((f) => f.category === "glyph");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /Helvetica/);
  assert.match(findings[0].message, /5/);
});

test("bundled fonts alone produce no finding", () => {
  const findings = judge(
    withFonts("Delta", [{ familyName: "Montserrat Thin", glyphCount: 5, isCustomFont: true }]),
  ).filter((f) => f.category === "glyph");
  assert.deepEqual(findings, []);
});

test("emoji are exempt — they always come from a system colour font", () => {
  const findings = judge(
    withFonts("hi 🚀🇺🇸", [
      { familyName: "Montserrat Thin", glyphCount: 3, isCustomFont: true },
      { familyName: "Apple Color Emoji", glyphCount: 3, isCustomFont: false },
    ]),
  ).filter((f) => f.category === "glyph");
  assert.deepEqual(findings, [], "3 system glyphs, 3 exempt characters — nothing left to report");
});

test("a system font drawing more than the exempt characters is still reported", () => {
  const findings = judge(
    withFonts("Δ 🚀", [
      { familyName: "Apple Color Emoji", glyphCount: 1, isCustomFont: false },
      { familyName: "Helvetica", glyphCount: 1, isCustomFont: false },
    ]),
  ).filter((f) => f.category === "glyph");
  assert.equal(findings.length, 1, "the emoji is exempt but Δ is not");
});

// getPlatformFontsForNode aggregates over the whole subtree, so every
// ancestor of a real fallback would report the same fallback again unless the
// judge attributes glyphs to the element whose own text actually drew them.
// A recorded fixture — not a synthetic probe — is the only thing that can
// catch this: the bug only manifests once elements are nested inside real
// ancestors the way a probe walk produces, which a flat single-element
// synthetic probe (like withFonts above) cannot reproduce.
test("a clean deck yields no glyph findings", () => {
  for (const name of ["kitchen-sink-dark", "kitchen-sink-light"]) {
    const findings = judge(loadProbe(name)).filter((f) => f.category === "glyph");
    assert.deepEqual(
      findings,
      [],
      `${name}: expected none, got: ${JSON.stringify(findings, null, 2)}`,
    );
  }
});

test("fallback fonts are reported once each, on the element whose own text fell back", () => {
  const findings = judge(loadProbe("stack-coverage-deck-dark")).filter(
    (f) => f.category === "glyph",
  );
  const seen = findings.map((f) => ({ slideIndex: f.slideIndex, snippet: f.snippet }));
  assert.deepEqual(seen, [
    { slideIndex: 1, snippet: "Δέλτα" }, // the Greek h1
    { slideIndex: 1, snippet: "marker" }, // the .marker ::after pseudo-content
    { slideIndex: 2, snippet: "Ωμέγα" }, // the Greek h1 on the next slide
    // Both .compare rows, whose characters exist only as `content: attr()`
    // generated text — every one of them, not just the slide's first.
    { slideIndex: 3, snippet: "≈" },
    { slideIndex: 3, snippet: "≠" },
    { slideIndex: 4, snippet: "Δέλτα" }, // the serif p, forced off Montserrat
  ]);
  // No ancestor (the .slide root, or any wrapper) duplicates a descendant's
  // fallback, and no finding carries an empty snippet — both symptoms of the
  // subtree-aggregation bug this pair of tests exists to catch.
  assert.ok(
    findings.every((f) => f.snippet !== ""),
    "no finding points at an unlocatable empty snippet",
  );
});
