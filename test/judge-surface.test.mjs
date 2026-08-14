import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { judge } from "../dist/check/judge.js";

const loadProbe = (name) => JSON.parse(readFileSync(`test/fixtures/probes/${name}.json`, "utf8"));

const slideWith = (elements) => ({
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
      elements,
    },
  ],
});

const root = {
  id: 0,
  tag: "div",
  className: "slide",
  snippet: "",
  hasOwnText: false,
  color: "rgb(255,255,255)",
  backgroundColor: "rgb(100,100,100)",
  backgroundImage: "none",
  fontSizePx: 16,
  fontWeight: 400,
  opacity: 1,
  boxShadow: "none",
  borderWidthPx: 0,
  borderColor: "rgb(0,0,0)",
  parent: null,
  fonts: [],
};

test("a card that blends into its backdrop is reported", () => {
  // Card bg (115,115,115) is close to but genuinely different from the
  // root/parent (100,100,100): dist=15*sqrt3≈25.98 < 30, so they blend
  // and should be flagged. Crucially the two colours differ (#737373 vs
  // #646464): if the surface rule ever compared the card against itself
  // instead of its parent, the message would report the card's own hex
  // as the backdrop (#737373) rather than the parent's (#646464).
  const findings = judge(
    slideWith([
      root,
      {
        ...root,
        id: 1,
        tag: "div",
        className: "card",
        parent: 0,
        backgroundColor: "rgb(115, 115, 115)",
        boxShadow: "none",
        borderWidthPx: 0,
      },
    ]),
  ).filter((f) => f.category === "surface");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /blends into/);
  // The backdrop named in the message must be the parent's colour
  // (#646464), not the card's own colour (#737373).
  assert.match(findings[0].message, /#737373 blends into #646464/);
});

test("a visible border rescues an otherwise blending surface", () => {
  // Card bg (115,115,115) blends into root (100,100,100): dist≈25.98 < 30.
  // The border (130,130,130) is chosen so it rescues the surface when
  // measured against the true parent backdrop (dist to #646464 ≈ 51.96
  // >= 30) but would NOT rescue it if measured against the card's own
  // background instead (dist to #737373 ≈ 25.98 < 30). This makes the
  // test sensitive to comparing against the parent rather than self.
  const findings = judge(
    slideWith([
      root,
      {
        ...root,
        id: 1,
        tag: "div",
        className: "card",
        parent: 0,
        backgroundColor: "rgb(115, 115, 115)",
        borderWidthPx: 1,
        borderColor: "rgb(130,130,130)",
      },
    ]),
  ).filter((f) => f.category === "surface");
  assert.deepEqual(findings, []);
});

test("a transparent element is not judged as an opaque black surface", () => {
  // Every un-backgrounded element reports getComputedStyle's transparent
  // rgba(0, 0, 0, 0) as its backgroundColor; parseColor happily parses that
  // into {r:0,g:0,b:0,a:0}. If the surface rule treated that as "this
  // element paints an opaque black panel" it would compare every such
  // element against a near-black page background and flood the report with
  // "blends into #000000 behind it (Δ0)" — reproduced here by setting the
  // recorded kitchen-sink deck's page background to true black, exactly as
  // the reviewer measured it (0 -> 119 findings against unfixed judge.ts).
  const probe = loadProbe("kitchen-sink-dark");
  for (const slide of probe.slides) {
    slide.pageBackgroundColor = "rgb(0, 0, 0)";
  }
  const findings = judge(probe).filter((f) => f.category === "surface");
  assert.deepEqual(
    findings,
    [],
    `expected no surface findings, got ${findings.length}: ${JSON.stringify(findings.slice(0, 3), null, 2)}`,
  );
});

test("a semi-transparent surface is judged on its composited appearance, not its raw color", () => {
  // rgba(255,255,255,0.04) over a dark backdrop reads as near-black to a
  // viewer (composited ~= rgb(29,29,29), Δ~16 from the rgb(20,20,20)
  // backdrop — well under the Δ30 threshold, so this should be flagged).
  // Comparing the raw, uncomposited color instead (as the old code did)
  // compares near-white channels against the dark backdrop (Δ~407) and
  // never flags it — a fail-toward-clean bug for exactly the idiom (a
  // subtle tinted card) this rule exists to catch.
  const findings = judge(
    slideWith([
      { ...root, backgroundColor: "rgb(20, 20, 20)" },
      {
        ...root,
        id: 1,
        tag: "div",
        className: "card",
        parent: 0,
        backgroundColor: "rgba(255, 255, 255, 0.04)",
      },
    ]),
  ).filter((f) => f.category === "surface");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /blends into/);
  // The reported hex must be the composited color the reader actually sees,
  // not the raw rgba(255,255,255,0.04) — which was never painted.
  assert.match(findings[0].message, /#1d1d1d blends into #141414/);
});

test("svg text is reported once per slide", () => {
  const probe = slideWith([root]);
  probe.slides[0].svgTextSnippets = ["42%"];
  const findings = judge(probe).filter((f) => f.category === "svg-text");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].snippet, "42%");
  assert.match(findings[0].message, /audited as HTML/);
});
