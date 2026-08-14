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

test("a page background image/gradient makes contrast unverifiable, not silently ignored", () => {
  // The probe only ever recorded pageBackgroundColor, never the body's
  // background-image. A gradient/image page resets background-color to a
  // transparent value that still parses, so a judge that only looks at the
  // color channel cannot tell "no page background" from "a page background
  // this walk cannot see" — and would misjudge contrast against whatever the
  // color happens to parse to.
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
        pageBackgroundColor: "rgba(0, 0, 0, 0)",
        pageBackgroundImage: "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))",
        elements: [
          {
            id: 0,
            tag: "div",
            className: "slide",
            snippet: "",
            hasOwnText: false,
            color: "rgb(255, 255, 255)",
            backgroundColor: "rgba(0, 0, 0, 0)",
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
          {
            id: 1,
            tag: "p",
            className: null,
            snippet: "on a gradient",
            hasOwnText: true,
            color: "rgb(255, 255, 255)",
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
  assert.equal(findings[0].severity, "unverifiable");
});

test("a fully transparent page background does not default to opaque black", () => {
  // Measured by the reviewer: judging the recorded kitchen-sink-light
  // fixture with pageBackgroundColor forced to a fully transparent value
  // went from 0 to 80 findings, all `error`, reading "... on #000000" — a
  // non-zero exit on a deck with no real defect, because the old fallback
  // only kicked in when the field was missing or unparseable, and
  // "rgba(0, 0, 0, 0)" is neither.
  const probe = loadProbe("kitchen-sink-light");
  for (const slide of probe.slides) {
    slide.pageBackgroundColor = "rgba(0, 0, 0, 0)";
  }
  const findings = judge(probe).filter((f) => f.category === "contrast");
  const blackBackdropErrors = findings.filter(
    (f) => f.severity === "error" && f.message.includes("#000000"),
  );
  assert.deepEqual(
    blackBackdropErrors,
    [],
    `expected no findings judged against an assumed #000000 backdrop, got ${blackBackdropErrors.length}`,
  );
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

test("contrast composites two semi-transparent ancestors, not just the nearest or furthest", () => {
  // slide root: opaque black
  // A: 30% white over the root -> rgb(77,77,77)
  // B: 50% white over A's result -> rgb(166,166,166) = #a6a6a6
  // Using only the nearest layer (B over black) would give rgb(128,128,128).
  // Using only the furthest layer (A alone) would give rgb(77,77,77).
  // Neither matches the true composite, so the reported backdrop hex pins
  // that both layers were actually composited together, not just the nearest
  // or the furthest one alone. Both overlays are the same color (white) here,
  // and alpha compositing is commutative for equal colors, so this does not
  // pin compositing order — a swapped-order bug would still produce the same
  // result and pass this test.
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
            backgroundColor: "rgb(0,0,0)",
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
            tag: "div",
            className: "layer-a",
            snippet: "",
            hasOwnText: false,
            color: "rgb(255,255,255)",
            backgroundColor: "rgba(255,255,255,0.3)",
            backgroundImage: "none",
            fontSizePx: 16,
            fontWeight: 400,
            opacity: 1,
            boxShadow: "none",
            borderWidthPx: 0,
            borderColor: "rgb(0,0,0)",
            parent: 0,
            fonts: [],
          },
          {
            id: 2,
            tag: "div",
            className: "layer-b",
            snippet: "",
            hasOwnText: false,
            color: "rgb(255,255,255)",
            backgroundColor: "rgba(255,255,255,0.5)",
            backgroundImage: "none",
            fontSizePx: 16,
            fontWeight: 400,
            opacity: 1,
            boxShadow: "none",
            borderWidthPx: 0,
            borderColor: "rgb(0,0,0)",
            parent: 1,
            fonts: [],
          },
          {
            id: 3,
            tag: "p",
            className: null,
            snippet: "layered",
            hasOwnText: true,
            color: "rgb(150,150,150)",
            backgroundColor: "rgba(0,0,0,0)",
            backgroundImage: "none",
            fontSizePx: 20,
            fontWeight: 400,
            opacity: 1,
            boxShadow: "none",
            borderWidthPx: 0,
            borderColor: "rgb(0,0,0)",
            parent: 2,
            fonts: [],
          },
        ],
      },
    ],
  };
  const findings = judge(probe).filter((f) => f.category === "contrast");
  assert.equal(findings.length, 1);
  assert.equal(findings[0].snippet, "layered");
  assert.match(findings[0].message, /on #a6a6a6/);
  assert.doesNotMatch(findings[0].message, /on #808080/);
  assert.doesNotMatch(findings[0].message, /on #4d4d4d/);
});

test("--only narrows the categories judged", () => {
  const findings = judge(loadProbe("kitchen-sink-dark"), { only: ["overflow"] });
  assert.ok(findings.every((f) => f.category === "overflow"));
});
