import assert from "node:assert/strict";
import { test } from "node:test";

import { judge } from "../dist/check/judge.js";

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
  backgroundColor: "rgb(18,20,28)",
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
  const findings = judge(
    slideWith([
      root,
      {
        ...root,
        id: 1,
        tag: "div",
        className: "card",
        parent: 0,
        backgroundColor: "rgb(20, 22, 30)",
        boxShadow: "none",
        borderWidthPx: 0,
      },
    ]),
  ).filter((f) => f.category === "surface");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.match(findings[0].message, /blends into/);
});

test("a visible border rescues an otherwise blending surface", () => {
  const findings = judge(
    slideWith([
      root,
      {
        ...root,
        id: 1,
        tag: "div",
        className: "card",
        parent: 0,
        backgroundColor: "rgb(20, 22, 30)",
        borderWidthPx: 1,
        borderColor: "rgb(200,200,200)",
      },
    ]),
  ).filter((f) => f.category === "surface");
  assert.deepEqual(findings, []);
});

test("svg text is reported once per slide", () => {
  const probe = slideWith([root]);
  probe.slides[0].svgTextSnippets = ["42%"];
  const findings = judge(probe).filter((f) => f.category === "svg-text");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].snippet, "42%");
  assert.match(findings[0].message, /audited as HTML/);
});
