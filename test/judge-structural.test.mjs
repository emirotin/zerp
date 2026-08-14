import assert from "node:assert/strict";
import { test } from "node:test";

import { judge } from "../dist/check/judge.js";

const probe = (overrides, deckOverrides = {}) => ({
  theme: "dark",
  width: 1920,
  height: 1080,
  sizeDefaulted: false,
  frameCount: 1,
  slideCount: 1,
  innerSlideCount: 1,
  browserErrors: [],
  ...deckOverrides,
  slides: [
    {
      index: 1,
      src: "slides/00.html",
      srcSlide: null,
      activeCount: 1,
      visibleCount: 1,
      activeIndex: 1,
      bodyHeight: 1080,
      viewportWidth: 1920,
      viewportHeight: 1080,
      activeDisplay: "flex",
      activeClass: true,
      // Matches the viewport by default, as a healthy deck's probe would
      // report — tests that aren't about geometry shouldn't have to fight it.
      activeRect: { x: 0, y: 0, width: 1920, height: 1080 },
      safeZoneItems: null,
      svgTextSnippets: [],
      elements: [],
      ...overrides,
    },
  ],
});

test("more than one active frame is an error", () => {
  const findings = judge(probe({ activeCount: 2 })).filter((f) => f.category === "frame");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].message, /active frame/);
});

test("body taller than the viewport is an overflow error", () => {
  const findings = judge(probe({ bodyHeight: 1200 })).filter((f) => f.category === "overflow");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].message, /1200px/);
});

test("an element intruding into the safe margin is reported", () => {
  // Viewport is 1920x1080 and the margin is 40, so the safe box is
  // 40,40 → 1880,1040. This row starts at left:10, which intrudes.
  const intruding = probe({
    safeZoneItems: [
      { label: "row", left: 10, top: 200, right: 900, bottom: 400, width: 890, height: 200 },
    ],
  });
  const findings = judge(intruding, { safeMargin: 40 }).filter((f) => f.category === "safe-zone");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].message, /row/);
});

test("an element clear of the safe margin is not reported", () => {
  const clear = probe({
    safeZoneItems: [
      { label: "row", left: 100, top: 200, right: 900, bottom: 400, width: 800, height: 200 },
    ],
  });
  assert.deepEqual(
    judge(clear, { safeMargin: 40 }).filter((f) => f.category === "safe-zone"),
    [],
  );
});

test("safe-zone checking is off when no margin is given", () => {
  const intruding = probe({
    safeZoneItems: [
      { label: "row", left: 10, top: 200, right: 900, bottom: 400, width: 890, height: 200 },
    ],
  });
  assert.deepEqual(
    judge(intruding).filter((f) => f.category === "safe-zone"),
    [],
  );
});

test("browser errors surface as console findings", () => {
  const findings = judge(probe({}, { browserErrors: ["ReferenceError: x is not defined"] })).filter(
    (f) => f.category === "console",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].message, /ReferenceError/);
});

test("an active inner slide that is display:none is an error", () => {
  const findings = judge(probe({ activeDisplay: "none" })).filter((f) => f.category === "frame");
  assert.equal(findings.length, 1);
});

test("an active frame rect that does not match the viewport is an error", () => {
  const findings = judge(probe({ activeRect: { x: 0, y: 0, width: 1600, height: 900 } })).filter(
    (f) => f.category === "frame",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].message, /1600,900/);
  assert.match(findings[0].message, /1920x1080/);
});

test("an active frame rect that matches the viewport is not reported", () => {
  const findings = judge(probe({ activeRect: { x: 0, y: 0, width: 1920, height: 1080 } })).filter(
    (f) => f.category === "frame",
  );
  assert.deepEqual(findings, []);
});

// A null rect means the probe found no active frame to measure at all — the
// same situation activeCount/activeIndex already flag, but verify.ts reports
// it from the rect check too ("active frame has no bounding rectangle"), so
// the port preserves that redundancy rather than silently dropping it.
test("a missing active frame rect is an error", () => {
  const findings = judge(probe({ activeRect: null })).filter((f) => f.category === "frame");
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /no bounding rectangle/);
});

test("a deck with no slide frames is an error", () => {
  // slideCount/innerSlideCount are held equal to frameCount so only the
  // frameCount===0 check fires, not the mismatch checks below.
  const findings = judge(probe({}, { frameCount: 0, slideCount: 0, innerSlideCount: 0 })).filter(
    (f) => f.category === "frame",
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].slideIndex, 1);
  assert.match(findings[0].message, /no slide frames/);
});

test("a .slide count mismatched with the frame count is an error", () => {
  const findings = judge(probe({}, { slideCount: 2, frameCount: 1 })).filter(
    (f) => f.category === "frame",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /2 \.slide elements for 1 slide frames/);
});

test("an inner-slide-root count mismatched with the frame count is an error", () => {
  const findings = judge(probe({}, { innerSlideCount: 0, frameCount: 1 })).filter(
    (f) => f.category === "frame",
  );
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /0 framed slide roots for 1 slide frames/);
});
