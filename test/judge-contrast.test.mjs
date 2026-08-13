import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { judge } from "../dist/check/judge.js";

const loadProbe = (name) => JSON.parse(readFileSync(`test/fixtures/probes/${name}.json`, "utf8"));

test("a clean deck yields no contrast or type-size findings", () => {
  const findings = judge(loadProbe("kitchen-sink-dark"));
  const relevant = findings.filter((f) => f.category === "contrast" || f.category === "type-size");
  assert.deepEqual(relevant, [], `expected none, got: ${JSON.stringify(relevant, null, 2)}`);
});

test("contrast is judged against the composited backdrop", () => {
  // A synthetic probe is used here rather than a fixture: it pins the maths
  // independently of any deck's real colours.
  const probe = {
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
        activeRect: null,
        safeZoneItems: null,
        svgTextSnippets: [],
        elements: [
          {
            id: 0,
            tag: "div",
            className: "slide",
            snippet: "",
            hasOwnText: false,
            color: "rgb(255, 255, 255)",
            backgroundColor: "rgb(18, 20, 28)",
            backgroundImage: "none",
            fontSizePx: 16,
            fontWeight: 400,
            opacity: 1,
            boxShadow: "none",
            borderWidthPx: 0,
            borderColor: "rgb(0, 0, 0)",
            parent: null,
            fonts: [],
          },
          // near-black text on the near-black slide background
          {
            id: 1,
            tag: "p",
            className: null,
            snippet: "invisible",
            hasOwnText: true,
            color: "rgb(24, 26, 34)",
            backgroundColor: "rgba(0, 0, 0, 0)",
            backgroundImage: "none",
            fontSizePx: 20,
            fontWeight: 400,
            opacity: 1,
            boxShadow: "none",
            borderWidthPx: 0,
            borderColor: "rgb(0, 0, 0)",
            parent: 0,
            fonts: [],
          },
        ],
      },
    ],
  };
  const findings = judge(probe).filter((f) => f.category === "contrast");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "error");
  assert.equal(findings[0].slideIndex, 1);
  assert.equal(findings[0].snippet, "invisible");
  assert.match(findings[0].message, /contrast Lc/);
});

test("text below the hard floor is an error, below the soft floor a warning", () => {
  const base = (fontSizePx) => ({
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
          },
          {
            id: 1,
            tag: "p",
            className: null,
            snippet: "tiny",
            hasOwnText: true,
            color: "rgb(255,255,255)",
            backgroundColor: "rgba(0,0,0,0)",
            backgroundImage: "none",
            fontSizePx,
            fontWeight: 400,
            opacity: 1,
            boxShadow: "none",
            borderWidthPx: 0,
            borderColor: "rgb(0,0,0)",
            parent: 0,
            fonts: [],
          },
        ],
      },
    ],
  });
  const err = judge(base(8)).filter((f) => f.category === "type-size");
  assert.equal(err.length, 1);
  assert.equal(err[0].severity, "error");
  const warn = judge(base(15)).filter((f) => f.category === "type-size");
  assert.equal(warn.length, 1);
  assert.equal(warn[0].severity, "warning");
});

test("--only narrows the categories judged", () => {
  const findings = judge(loadProbe("kitchen-sink-dark"), { only: ["overflow"] });
  assert.ok(findings.every((f) => f.category === "overflow"));
});
