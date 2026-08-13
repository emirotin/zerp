# Browser-Backed Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `zerp check`'s hand-written CSS cascade with a real browser, detect font fallback via Chrome DevTools Protocol, and fold `zerp verify` into `zerp check` as a single pass.

**Architecture:** A hard split between **probe** and **judge**. The probe drives Chromium (reusing `src/verify.ts`'s existing session plumbing), steps through slides with `window.next()`, and returns a plain serialisable `DeckProbe` — `getComputedStyle` values and geometry from one `page.evaluate` per slide, plus per-element font-usage facts from CDP `CSS.getPlatformFontsForNode`. The judge is a pure function over that structure, so contrast, type-size, surface and glyph rules stay unit-testable against recorded fixtures with no browser.

**Tech Stack:** TypeScript (ESM, `dist/` build via `scripts/build.mjs`), `node:test` with `node:assert/strict`, `playwright-core` driving system Chrome, Chrome DevTools Protocol, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-08-13-browser-backed-check-design.md`

## Global Constraints

- Target **0.11.0-rc.2**, bumped only in the final task. Branch `feat/browser-backed-check`. Do not tag, publish, or merge.
- **Tests run against `dist/`, not `src/`.** Every test imports from `../dist/…`. Run `pnpm build` before `node --test`, or use `pnpm test`, which builds first.
- Never hand-edit `dist/`, `examples/**/index.html`, or `docs/style-system.pdf`. Regenerate them.
- `pnpm check`, `pnpm lint`, `pnpm format:check`, `pnpm test` must all pass at every task boundary.
- Comments explain _why_, not _what_. Match the density of surrounding code.
- **`document.fonts.check()` must never be used for coverage.** Verified: it returns `true` for a non-existent family and for CJK in Montserrat. It answers "are the fonts that would be used already loaded"; fallback fonts are always loaded.
- Judge code must never import `playwright-core` or touch the network/filesystem — that is what keeps its tests browser-free.
- Commit after every task. Pre-commit runs Husky → `lint-staged` + a build check.

## Facts established by probing, which the plan depends on

- `CSS.getPlatformFontsForNode` **aggregates over a subtree**: on `.slide` it returned `Helvetica x5 (system) | Montserrat Thin x47`. On `body` it returned nothing, so query slide roots and elements, never `body`.
- It is **cheap**: 50 calls in 17ms (~0.34ms each). Per-element querying for a 33-slide deck costs a few hundred ms. No fast-path optimisation is needed.
- `familyName` is the _platform_ face name (`Montserrat Thin`, not `Montserrat`), so **never match on family names** — key on `isCustomFont` only. Every font zerp ships is an inlined `@font-face`, so `isCustomFont: false` means fallback.
- The existing probe advances slides with `window.next()` because only the active slide renders. Font and geometry facts must be collected per slide, while that slide is active.

---

### Task 1: `DeckProbe` types and the probe module skeleton

**Files:**

- Create: `src/check/probe.ts`
- Create: `src/check/probe-types.ts`
- Test: `test/probe.test.mjs`

**Interfaces:**

- Consumes: `resolveBrowserExecutable` from `src/verify.ts` (already exported).
- Produces:
  ```ts
  export interface ProbeElement {
    /** Stable within one slide; assigned by the in-page walk. */
    id: number;
    tag: string; // lowercase
    className: string | null;
    snippet: string; // collapsed text, ≤40 chars with ellipsis
    hasOwnText: boolean; // has a non-whitespace direct text child
    color: string; // computed, always rgb()/rgba()
    backgroundColor: string;
    backgroundImage: string;
    fontSizePx: number;
    fontWeight: number;
    opacity: number;
    boxShadow: string;
    borderWidthPx: number;
    borderColor: string;
    /** Index into the slide's element list, or null for the slide root. */
    parent: number | null;
    /** Populated in Task 5; empty until then. */
    fonts: ProbeFont[];
  }
  export interface ProbeFont {
    familyName: string;
    glyphCount: number;
    isCustomFont: boolean;
  }
  export interface ProbeSlide {
    index: number; // 1-based, matches today's Finding.slideIndex
    src: string | null;
    srcSlide: string | null;
    elements: ProbeElement[];
    activeCount: number;
    visibleCount: number;
    activeIndex: number | null;
    bodyHeight: number;
    viewportWidth: number;
    viewportHeight: number;
    activeDisplay: string | null;
    activeClass: boolean;
    activeRect: { x: number; y: number; width: number; height: number } | null;
    safeZoneItems: SafeZoneItem[] | null;
    svgTextSnippets: string[];
  }
  export interface DeckProbe {
    theme: "dark" | "light";
    width: number;
    height: number;
    sizeDefaulted: boolean;
    frameCount: number;
    slideCount: number;
    innerSlideCount: number;
    slides: ProbeSlide[];
    browserErrors: string[];
  }
  export async function probeDeck(options: ProbeOptions): Promise<DeckProbe>;
  ```
  `SafeZoneItem` is the existing interface in `src/verify.ts` — re-export it from `probe-types.ts` rather than redefining it.

**Note on scope:** this task collects styles and geometry only. Fonts arrive in Task 5; `fonts` is `[]` here.

- [ ] **Step 1: Write the failing test**

Create `test/probe.test.mjs`. This is a browser test — follow the gating idiom used by `test/verify.test.mjs` (read it first and copy how it skips without Chrome).

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { probeDeck } from "../dist/check/probe.js";

test("the probe reports computed styles and geometry per slide", async () => {
  const probe = await probeDeck({
    rootDir: "test/fixtures/stack-coverage-deck",
    theme: "dark",
    width: 1920,
    height: 1080,
    safeMargin: 0,
    timeoutMs: 30000,
  });
  assert.equal(probe.theme, "dark");
  assert.equal(probe.width, 1920);
  assert.ok(probe.slides.length >= 2, "fixture has at least two slides");

  const first = probe.slides[0];
  assert.equal(first.index, 1);
  assert.equal(first.viewportWidth, 1920);
  assert.equal(first.viewportHeight, 1080);

  const h1 = first.elements.find((el) => el.tag === "h1");
  assert.ok(h1, "the h1 is in the element list");
  assert.match(h1.color, /^rgba?\(/, "computed colors arrive resolved, never var()");
  assert.ok(h1.fontSizePx > 16, "a real laid-out font size, not an em string");
  assert.ok(h1.hasOwnText);
  assert.equal(h1.fonts.length, 0, "fonts arrive in a later task");
});

test("the probe advances through every slide", async () => {
  const probe = await probeDeck({
    rootDir: "test/fixtures/stack-coverage-deck",
    theme: "dark",
    width: 1920,
    height: 1080,
    safeMargin: 0,
    timeoutMs: 30000,
  });
  // Each slide must report its own active frame, which only holds if the probe
  // stepped with window.next() rather than measuring slide 1 repeatedly.
  const indices = probe.slides.map((s) => s.index);
  assert.deepEqual(
    indices,
    indices.map((_, i) => i + 1),
  );
  assert.ok(probe.slides.every((s) => s.activeCount === 1));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/probe.test.mjs`
Expected: FAIL — cannot resolve `../dist/check/probe.js`.

- [ ] **Step 3: Write the implementation**

Create `src/check/probe-types.ts` with the interfaces from the Interfaces block above, plus:

```ts
export interface ProbeOptions {
  rootDir: string;
  theme: "dark" | "light";
  width: number;
  height: number;
  safeMargin: number;
  timeoutMs: number;
  sizeDefaulted?: boolean;
  browserEndpoint?: string;
}
```

Create `src/check/probe.ts`. Reuse `src/verify.ts`'s session shape — read `runProbe` (`src/verify.ts:393`) and follow it: borrow-or-launch, exact viewport via `newContext({ viewport, deviceScaleFactor: 1 })`, `addInitScript` for the error collector, `goto('file://…#1', { waitUntil: 'load' })`, then evaluate.

The in-page walk, as a string expression like the existing `probeExpression`:

```ts
// Only the active slide renders, so styles and geometry are collected slide by
// slide with window.next() between them — the same reason verify's probe steps.
const SLIDE_EXPRESSION = (safeMargin: number): string => `(async function () {
  var safeMargin = ${safeMargin};
  await document.fonts.ready;
  await new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); });
  var SKIP = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, TITLE: 1 };
  function snippet(text) {
    var t = String(text || "").replace(/\\s+/g, " ").trim();
    return t.length > 40 ? t.slice(0, 37) + "\\u2026" : t;
  }
  function collect(root) {
    var out = [];
    function walk(el, parent) {
      if (SKIP[el.tagName] || el.getAttribute("aria-hidden") === "true") { return; }
      var cs = getComputedStyle(el);
      var ownText = "";
      for (var i = 0; i < el.childNodes.length; i++) {
        var child = el.childNodes[i];
        if (child.nodeType === 3) { ownText += child.textContent || ""; }
      }
      var id = out.length;
      el.setAttribute("data-zerp-probe", String(id));
      out.push({
        id: id,
        tag: el.tagName.toLowerCase(),
        className: el.getAttribute("class"),
        snippet: snippet(ownText || el.textContent),
        hasOwnText: /\\S/.test(ownText),
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        backgroundImage: cs.backgroundImage,
        fontSizePx: parseFloat(cs.fontSize) || 0,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        opacity: parseFloat(cs.opacity),
        boxShadow: cs.boxShadow,
        borderWidthPx: parseFloat(cs.borderTopWidth) || 0,
        borderColor: cs.borderTopColor,
        parent: parent,
        fonts: []
      });
      for (var j = 0; j < el.children.length; j++) { walk(el.children[j], id); }
    }
    walk(root, null);
    return out;
  }
  var frames = Array.from(document.querySelectorAll("[data-zerp-slide]"));
  var slides = [];
  for (var index = 0; index < frames.length; index++) {
    if (index > 0) { window.next(); }
    var visible = frames.filter(function (frame) {
      var style = getComputedStyle(frame);
      var rect = frame.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    });
    var active = frames.filter(function (f) { return f.hasAttribute("data-zerp-slide-active"); });
    var activeFrame = active[0] || null;
    var activeSlide = activeFrame ? activeFrame.querySelector(".slide") : null;
    var rect = activeFrame ? activeFrame.getBoundingClientRect() : null;
    var safeZoneItems = null;
    if (safeMargin > 0 && activeSlide) {
      safeZoneItems = Array.from(activeSlide.children)
        .filter(function (el) { return ["SCRIPT", "STYLE"].indexOf(el.tagName) === -1; })
        .filter(function (el) { return !el.hasAttribute("data-zerp-bleed"); })
        .map(function (el) {
          var r = el.getBoundingClientRect();
          return { label: el.id || el.getAttribute("class") || el.tagName.toLowerCase(),
                   left: r.left, top: r.top, right: r.right, bottom: r.bottom,
                   width: r.width, height: r.height };
        })
        .filter(function (item) { return item.width > 0 && item.height > 0; });
    }
    var svgTexts = activeSlide
      ? Array.from(activeSlide.querySelectorAll("svg text")).map(function (t) { return snippet(t.textContent); })
      : [];
    slides.push({
      index: index + 1,
      src: activeSlide ? activeSlide.getAttribute("data-zerp-src") : null,
      srcSlide: activeSlide ? activeSlide.getAttribute("data-zerp-src-slide") : null,
      elements: activeSlide ? collect(activeSlide) : [],
      activeCount: active.length,
      visibleCount: visible.length,
      activeIndex: activeFrame ? frames.indexOf(activeFrame) + 1 : null,
      bodyHeight: document.body.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      activeDisplay: activeSlide ? getComputedStyle(activeSlide).display : null,
      activeClass: activeSlide ? activeSlide.classList.contains("active") : false,
      activeRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      safeZoneItems: safeZoneItems,
      svgTextSnippets: svgTexts
    });
  }
  return {
    frameCount: frames.length,
    slideCount: document.querySelectorAll(".slide").length,
    innerSlideCount: frames.filter(function (f) { return f.querySelector(".slide") !== null; }).length,
    slides: slides,
    browserErrors: window.__zerpVerifyErrors || []
  };
})()`;
```

`probeDeck` writes the assembled HTML next to the slides (same as `verifyPresentation` does at `src/verify.ts:552`, using a pid-unique filename it removes afterwards), applies the theme by building with `buildPresentationHtml({ rootDir, theme })`, runs the expression, and returns the result with `theme`, `width`, `height`, `sizeDefaulted` merged in.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/probe.test.mjs`
Expected: PASS (skipped if Chrome is absent, per the file's gating).

- [ ] **Step 5: Commit**

```bash
git add src/check/probe.ts src/check/probe-types.ts test/probe.test.mjs
git commit -m "Add a browser probe returning computed styles and geometry"
```

---

### Task 2: Probe fixture generator and recorded fixtures

**Files:**

- Create: `scripts/record-probe.mjs`
- Create: `test/fixtures/probes/` (recorded JSON)
- Test: `test/probe-fixtures.test.mjs`

**Interfaces:**

- Consumes: `probeDeck` (Task 1).
- Produces: recorded `DeckProbe` JSON at `test/fixtures/probes/<deck>-<theme>.json`, and `loadProbe(name)` used by every judge test from Task 3 on.

**Why:** the judge must be testable without Chrome. Recorded probes are how. They must be _generated_, never hand-written, so they cannot drift from what a browser actually reports.

- [ ] **Step 1: Write the generator**

Create `scripts/record-probe.mjs`:

```js
// Records real browser probes as judge-test fixtures. Hand-writing these would
// let them drift from what Chrome actually reports, which is the one thing the
// probe/judge split must not allow.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { probeDeck } from "../dist/check/probe.js";

const DECKS = [
  ["stack-coverage-deck", "test/fixtures/stack-coverage-deck"],
  ["kitchen-sink", "test/fixtures/kitchen-sink"],
  ["broken-deck", "test/fixtures/broken-deck"],
];
const OUT = "test/fixtures/probes";

await mkdir(OUT, { recursive: true });
for (const [name, rootDir] of DECKS) {
  for (const theme of ["dark", "light"]) {
    const probe = await probeDeck({
      rootDir,
      theme,
      width: 1920,
      height: 1080,
      safeMargin: 0,
      timeoutMs: 30000,
    });
    const file = path.join(OUT, `${name}-${theme}.json`);
    await writeFile(file, `${JSON.stringify(probe, null, 2)}\n`);
    process.stdout.write(`${file}\n`);
  }
}
```

Add to `package.json` scripts: `"record-probe": "pnpm build && node scripts/record-probe.mjs"`.

- [ ] **Step 2: Generate the fixtures**

Run: `pnpm record-probe`
Expected: six JSON files written. Inspect one — confirm `elements` is populated, colors are `rgb(...)`, and `fontSizePx` values are real numbers.

- [ ] **Step 3: Write the loader test**

Create `test/probe-fixtures.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

export function loadProbe(name) {
  return JSON.parse(readFileSync(`test/fixtures/probes/${name}.json`, "utf8"));
}

test("recorded probes carry resolved values, not CSS source text", () => {
  const probe = loadProbe("kitchen-sink-dark");
  assert.ok(probe.slides.length > 0);
  const all = probe.slides.flatMap((s) => s.elements);
  assert.ok(all.length > 0);
  assert.ok(
    all.every((el) => /^rgba?\(/.test(el.color)),
    "every color is computed",
  );
  assert.ok(all.every((el) => typeof el.fontSizePx === "number" && el.fontSizePx > 0));
  assert.ok(!JSON.stringify(probe).includes("var(--"), "no unresolved custom properties survive");
});
```

- [ ] **Step 4: Run it**

Run: `pnpm build && node --test test/probe-fixtures.test.mjs`
Expected: PASS, and it must run with **no browser** — that is the point.

- [ ] **Step 5: Commit**

```bash
git add scripts/record-probe.mjs test/fixtures/probes test/probe-fixtures.test.mjs package.json
git commit -m "Record real browser probes as browser-free judge fixtures"
```

---

### Task 3: Judge — type size and contrast

**Files:**

- Create: `src/check/judge.ts`
- Modify: `src/check/types.ts` (add `category`)
- Test: `test/judge-contrast.test.mjs`

**Interfaces:**

- Consumes: `DeckProbe` (Task 1), fixtures (Task 2), `contrastLc`/`requiredPx`/`neededLc`/`MIN_ERROR_PX`/`MIN_WARN_PX` from `src/check/apca.ts`, `parseColor`/`blend`/`toHex`/`rgbDistance` from `src/check/color.ts`.
- Produces:

  ```ts
  export type FindingCategory =
    | "contrast"
    | "type-size"
    | "surface"
    | "glyph"
    | "svg-text"
    | "frame"
    | "overflow"
    | "safe-zone"
    | "console";
  export interface JudgeOptions {
    only?: FindingCategory[];
    safeMargin?: number;
  }
  export function judge(probe: DeckProbe, options?: JudgeOptions): Finding[];
  ```

  `Finding` gains `category: FindingCategory`. Everything else in `Finding` is unchanged.

- [ ] **Step 1: Write the failing test**

Create `test/judge-contrast.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/judge-contrast.test.mjs`
Expected: FAIL — cannot resolve `../dist/check/judge.js`.

- [ ] **Step 3: Write the implementation**

In `src/check/types.ts` add the category to `Finding`:

```ts
export type FindingCategory =
  | "contrast"
  | "type-size"
  | "surface"
  | "glyph"
  | "svg-text"
  | "frame"
  | "overflow"
  | "safe-zone"
  | "console";

export interface Finding {
  severity: Severity;
  category: FindingCategory;
  theme: CheckTheme;
  slideIndex: number;
  slideSrc: string | null;
  slideSrcSlide: string | null;
  snippet: string;
  message: string;
  suggestion: string | null;
}
```

Remove `skippedSelectors` from `CheckReport` and add nothing in its place.

Create `src/check/judge.ts`. Port the contrast and type-size logic from `src/check/checker.ts:265-301` verbatim in spirit — the maths and thresholds do not change, only where the numbers come from. Background compositing walks the probe's `parent` chain instead of the DOM:

```ts
// The probe records each element's own background; a transparent one means the
// backdrop is whatever the ancestors composite to, exactly as the DOM walk did.
function backdropFor(slide: ProbeSlide, el: ProbeElement): BackgroundResult {
  const layers: Rgba[] = [];
  let node: ProbeElement | undefined = el;
  while (node) {
    if (node.backgroundImage && node.backgroundImage !== "none") {
      return { kind: "unverifiable", reason: "background image/gradient" };
    }
    const color = parseColor(node.backgroundColor);
    if (color) {
      if (color.a >= 1) {
        return { kind: "color", color: compositeLayers(layers, color) };
      }
      if (color.a > 0) {
        layers.push(color);
      }
    }
    node = node.parent === null ? undefined : slide.elements[node.parent];
  }
  // Nothing opaque above the slide root: the page background is the backdrop.
  return { kind: "color", color: compositeLayers(layers, { r: 0, g: 0, b: 0, a: 1 }) };
}
```

Judge only elements with `hasOwnText`. Gate every category behind `options.only`.

The `suggestion` text for contrast used `token-contrast.json` via `suggestionFor` in `checker.ts` — keep that helper and its data file, moving it into `judge.ts` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/judge-contrast.test.mjs test/probe-fixtures.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/judge.ts src/check/types.ts test/judge-contrast.test.mjs
git commit -m "Judge contrast and type size from a recorded probe"
```

---

### Task 4: Judge — surface blend and SVG text

**Files:**

- Modify: `src/check/judge.ts`
- Test: `test/judge-surface.test.mjs`

**Interfaces:**

- Consumes: Task 3's `judge`.
- Produces: `surface` and `svg-text` findings.

- [ ] **Step 1: Write the failing test**

Create `test/judge-surface.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/judge-surface.test.mjs`
Expected: FAIL — no `surface` or `svg-text` findings produced.

- [ ] **Step 3: Write the implementation**

Port `checker.ts:304-345`'s surface rule into `judge.ts`, keeping `SURFACE_MIN_RGB_DIST = 30` and `SURFACE_MIN_LC = 15` exactly. The element's own background comes from `el.backgroundColor`; the backdrop from `backdropFor(slide, parent)`. Port the SVG warning from `checker.ts:180-204`, driven by `slide.svgTextSnippets`, reported against the probe's theme.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/judge-surface.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/judge.ts test/judge-surface.test.mjs
git commit -m "Judge surface blend and svg text from the probe"
```

---

### Task 5: Font facts via CDP, and the `glyph` category

**Files:**

- Modify: `src/check/probe.ts`
- Modify: `src/check/judge.ts`
- Test: `test/probe-fonts.test.mjs` (browser), `test/judge-glyph.test.mjs` (no browser)

**Interfaces:**

- Consumes: `ProbeElement.fonts` (declared in Task 1, empty until now).
- Produces: populated `fonts: ProbeFont[]` per element, and `glyph` findings.

**The rule:** every font zerp ships is an inlined `@font-face`, so `isCustomFont: false` means the renderer fell back. Never match on `familyName` — it is the platform face name (`Montserrat Thin`, not `Montserrat`).

- [ ] **Step 1: Write the failing browser test**

Create `test/probe-fonts.test.mjs`, gated on Chrome like `test/probe.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { probeDeck } from "../dist/check/probe.js";

test("the probe records which fonts actually rendered each element", async () => {
  const probe = await probeDeck({
    rootDir: "test/fixtures/stack-coverage-deck",
    theme: "dark",
    width: 1920,
    height: 1080,
    safeMargin: 0,
    timeoutMs: 30000,
  });
  const first = probe.slides[0];
  const h1 = first.elements.find((el) => el.tag === "h1");
  const code = first.elements.find((el) => el.tag === "code");

  // Greek in the h1 resolves through Montserrat, which ships no Greek subset,
  // so the renderer falls back to a system face.
  assert.ok(h1.fonts.length > 0, "fonts were collected");
  assert.ok(
    h1.fonts.some((f) => !f.isCustomFont),
    "h1 fell back to a system font",
  );
  // The same character in <code> resolves through Roboto Mono, which has Greek.
  assert.ok(code.fonts.length > 0);
  assert.ok(
    code.fonts.every((f) => f.isCustomFont),
    "code stayed on a bundled font",
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm build && node --test test/probe-fonts.test.mjs`
Expected: FAIL — `h1.fonts` is empty.

- [ ] **Step 3: Collect fonts via CDP in the probe**

In `src/check/probe.ts`, after the per-slide evaluate, open a CDP session and populate `fonts`. The in-page walk already stamps `data-zerp-probe="<id>"` on every element it records, which is what makes them addressable from CDP.

```ts
// getPlatformFontsForNode is the renderer's own answer to "which fonts drew
// this text". document.fonts.check cannot be used: it returns true for a
// family that does not exist, because it reports whether the fonts that WOULD
// be used are loaded, and fallback fonts always are.
async function collectFonts(cdp: CDPSession, slide: ProbeSlide): Promise<void> {
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeIds } = await cdp.send("DOM.querySelectorAll", {
    nodeId: root.nodeId,
    selector: "[data-zerp-slide-active] [data-zerp-probe]",
  });
  for (const nodeId of nodeIds) {
    const { attributes } = await cdp.send("DOM.getAttributes", { nodeId });
    const probeIndex = attributeValue(attributes, "data-zerp-probe");
    const element = probeIndex === null ? undefined : slide.elements[Number(probeIndex)];
    if (!element) {
      continue;
    }
    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
    element.fonts = fonts.map((font) => ({
      familyName: font.familyName,
      glyphCount: font.glyphCount,
      isCustomFont: font.isCustomFont,
    }));
  }
}
```

`DOM.getDocument` must be re-sent per slide, because `window.next()` mutates the tree and invalidates node ids. Enable both domains once per session with `DOM.enable` and `CSS.enable`.

**Restructuring note:** the current single `page.evaluate` walks every slide in one go. Font collection has to interleave — advance, evaluate that slide, collect its fonts — so split the expression into a per-slide form and drive the loop from Node, calling `window.next()` via `page.evaluate("window.next()")` between slides. Keep the `document.fonts.ready` + double-rAF wait before the first slide only.

- [ ] **Step 4: Run the browser test**

Run: `pnpm build && node --test test/probe-fonts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Re-record fixtures**

Run: `pnpm record-probe`
The recorded probes now carry `fonts`. Commit the regenerated JSON.

- [ ] **Step 6: Write the failing judge test**

Create `test/judge-glyph.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { judge } from "../dist/check/judge.js";

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
```

- [ ] **Step 7: Implement the glyph rule**

In `judge.ts`:

```ts
// Every font zerp ships is an inlined @font-face, so a system font drawing
// glyphs means the renderer fell back — that text looks different on every
// machine and is re-resolved again on export. Emoji are the one exemption:
// every platform draws them from its own colour font by design, so they are
// subtracted from the system glyph count rather than reported.
const EXEMPT = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu;

function fallbackGlyphs(element: ProbeElement): { count: number; families: string[] } {
  const system = element.fonts.filter((font) => !font.isCustomFont);
  const drawn = system.reduce((total, font) => total + font.glyphCount, 0);
  const exempt = (element.snippet.match(EXEMPT) ?? []).length;
  return { count: Math.max(0, drawn - exempt), families: system.map((f) => f.familyName) };
}
```

Report at `warning` with a message naming the families and the glyph count, and a suggestion pointing at characters the bundled fonts cover.

**Known limitation to note in the code comment:** `snippet` is truncated at 40 characters, so the exempt count is approximate for long emoji-heavy runs. Record the element's full exempt count in the probe instead if this proves wrong in Task 11 — do not silently widen the exemption.

- [ ] **Step 8: Run both suites**

Run: `pnpm build && node --test test/judge-glyph.test.mjs test/probe-fonts.test.mjs`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/check/probe.ts src/check/judge.ts test/probe-fonts.test.mjs test/judge-glyph.test.mjs test/fixtures/probes
git commit -m "Detect font fallback from the renderer via CDP"
```

---

### Task 6: Judge — frame, overflow, safe-zone and console

**Files:**

- Modify: `src/check/judge.ts`
- Test: `test/judge-structural.test.mjs`

**Interfaces:**

- Consumes: the geometry fields already on `ProbeSlide`/`DeckProbe`.
- Produces: `frame`, `overflow`, `safe-zone`, `console` findings — the assertions `verify` makes today, as `error`-severity findings.

- [ ] **Step 1: Write the failing test**

Create `test/judge-structural.test.mjs`. Port every assertion from `src/verify.ts:483-537`:

```js
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
      activeRect: null,
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
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm build && node --test test/judge-structural.test.mjs`
Expected: FAIL — no structural findings produced.

- [ ] **Step 3: Implement**

Port the checks from `src/verify.ts:483-537` into `judge.ts`, each emitting a `Finding` at `error` severity with the matching category. Deck-level checks (`frameCount === 0`, `slideCount !== innerSlideCount`) attach to `slideIndex: 1`. `browserErrors` become one finding each, deduplicated by message.

- [ ] **Step 4: Run it**

Run: `pnpm build && node --test test/judge-structural.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/judge.ts test/judge-structural.test.mjs
git commit -m "Judge frame, overflow, safe-zone and console from the probe"
```

---

### Task 7: Wire the CLI — one `check` command, `verify` removed

**Files:**

- Modify: `src/cli.ts:175-247`
- Modify: `src/check/checker.ts` — keep the file, reduced to thin orchestration: build the theme list, call `probeDeck` per theme, call `judge` on each result, and merge the findings into one `CheckReport`. Do not move `checkPresentation` into `judge.ts`; `judge.ts` must stay pure and browser-free, and `checkPresentation` is the browser-driving entry point.
- Modify: `src/check/report.ts`
- Test: `test/cli.test.mjs`

**Interfaces:**

- Consumes: `probeDeck`, `judge`.
- Produces: `checkPresentation(options): Promise<CheckReport>` — same name as today so `src/index.ts`'s export survives, now browser-backed and accepting `width`, `height`, `safeMargin`, `timeoutMs`, `browserEndpoint`, `only`.

- [ ] **Step 1: Write the failing test**

In `test/cli.test.mjs`, add:

```js
test("verify is gone and check absorbs its flags", async () => {
  const help = await runCli(["--help"]);
  assert.ok(!help.stdout.includes("zerp verify"), "verify is no longer a command");
  assert.match(help.stdout, /--only/);
  assert.match(help.stdout, /--safe-margin/);
});

test("check reports both audits in one pass", async () => {
  const result = await runCli(["check", "test/fixtures/stack-coverage-deck", "--json"]);
  const report = JSON.parse(result.stdout);
  const categories = new Set(report.findings.map((f) => f.category));
  assert.ok(categories.has("glyph"), "the Greek h1 falls back and is reported");
  assert.ok(!("skippedSelectors" in report), "nothing is skipped any more");
});
```

Follow the file's existing `runCli` helper; read it first.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm build && node --test test/cli.test.mjs`
Expected: FAIL — `verify` is still in help.

- [ ] **Step 3: Implement**

Merge the two command blocks in `src/cli.ts` into one `check`. Parse `--only` into a validated `FindingCategory[]`, rejecting unknown names with a message listing the valid set. Reuse `parseVerifySize`, `parseSafeMargin`, `parseVerifyTimeout`, `resolveBrowserEndpoint` unchanged. Delete the `verify` block and its help text; add the absorbed flags to the help.

In `report.ts`, delete the `skippedSelectors` block and prefix each finding line with its category:

```ts
lines.push(
  `  ${ICONS[finding.severity]} [${finding.category}] "${finding.snippet}" — ${finding.message}`,
);
```

Update the summary line to read `zerp check — N slides · <theme counts>` as it does today.

- [ ] **Step 4: Run the suite**

Run: `pnpm build && node --test test/cli.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/check/checker.ts src/check/report.ts test/cli.test.mjs
git commit -m "Merge verify into check as a single browser pass"
```

---

### Task 8: Delete the static engine

**Files:**

- Delete: `src/check/cascade.ts`, `src/check/css-model.ts`, `src/check/font-stack.ts`, `src/check/coverage.ts`, `src/woff2.ts`
- Delete: `test/cascade.test.mjs`, `test/css-model.test.mjs`, `test/font-stack.test.mjs`, `test/coverage.test.mjs`, `test/woff2.test.mjs`
- Modify: `src/fonts.ts` (drop the `selectedFaces` export), `test/fonts.test.mjs`
- Modify: `src/verify.ts` (drop the command-level entry point; keep browser plumbing)
- Modify: `src/index.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: a tree with no static cascade.

**Verified before planning:** `src/woff2.ts`'s only consumers are `src/check/coverage.ts` and `test/woff2.test.mjs`. `selectedFaces`' only consumers are `src/check/coverage.ts` and `test/fonts.test.mjs`. `src/fonts.ts` uses `selectFaceBlocks` internally and keeps it.

- [ ] **Step 1: Confirm nothing else imports them**

Run:

```bash
grep -rn "cascade\.js\|css-model\.js\|font-stack\.js\|coverage\.js\|woff2\.js\|selectedFaces" src/ test/ scripts/
```

Every hit must be inside a file this task deletes, or a line this task edits. **If anything else appears, stop and report it** — the plan's premise is wrong.

- [ ] **Step 2: Delete**

```bash
git rm src/check/cascade.ts src/check/css-model.ts src/check/font-stack.ts src/check/coverage.ts src/woff2.ts
git rm test/cascade.test.mjs test/css-model.test.mjs test/font-stack.test.mjs test/coverage.test.mjs test/woff2.test.mjs
```

Remove the `selectedFaces` export from `src/fonts.ts` and its cases from `test/fonts.test.mjs`, keeping every case that covers subset selection and inlining. Remove `verifyPresentation` and its report types from `src/index.ts`; keep `resolveBrowserExecutable` and `installBrowser`.

- [ ] **Step 3: Verify**

Run: `pnpm check && pnpm lint && pnpm test`
Expected: all green. TypeScript is the real gate here — an orphaned import fails the build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Delete the static cascade, cmap reader and coverage walk"
```

---

### Task 9: Documentation

**Files:**

- Modify: `README.md`, `llms.txt`, `AGENTS.md`, `MIGRATION.md`, `CHANGELOG.md`, `docs/style-system.html`
- Regenerate: `docs/style-system.pdf`

- [ ] **Step 1: Sweep every mention of `verify`**

Run `grep -rn "zerp verify\|verifyPresentation" README.md llms.txt AGENTS.md MIGRATION.md docs/style-system.html` and rewrite each: the command no longer exists, and `zerp check` covers it. `AGENTS.md`'s Commands block and its verification bullets both need it.

- [ ] **Step 2: Rewrite the coverage section of `llms.txt`**

It currently describes per-stack judging with codepoint lists. The new behaviour: `zerp check` reports when text rendered in a font the deck does not bundle, naming the element and the fallback family. Bundling is per role, and the renderer decides. Emoji stay exempt. State the granularity honestly — per element, not per codepoint.

- [ ] **Step 3: State the Chrome requirement**

`zerp check` now requires Chrome/Chromium and errors with `Run \`zerp install-browser\``without it. Say so in`README.md`and`llms.txt` where the authoring loop is described.

- [ ] **Step 4: CHANGELOG**

Add to the existing `0.11.0` section — do not open a new one. Cover: `verify` removed and folded into `check`; `check` now requires a browser; findings gain a `category` and `--only`; `skippedSelectors` gone; glyph findings now name an element and fallback family rather than codepoints; and that everything inside `@media`, every `!important`, and every previously-unsupported selector is now audited for the first time.

- [ ] **Step 5: Reprint the guide**

Run: `pnpm build:docs`, then read the PDF and confirm the type section and footer are correct. Chrome 149 hangs on shutdown in this repo — if it appears to hang _after_ writing the PDF, check the timestamp rather than assuming failure.

- [ ] **Step 6: Commit**

```bash
git add README.md llms.txt AGENTS.md MIGRATION.md CHANGELOG.md docs/style-system.html docs/style-system.pdf
git commit -m "Document the merged browser-backed check"
```

---

### Task 10: Triage the new findings on kitchen-sink and casino

**Files:**

- Modify (as needed): `test/fixtures/kitchen-sink/slides/**`, `examples/casino/slides/**`, or `src/` if a finding is a false positive

**This is the task with unknown scope.** The browser sees what the static cascade could not: casino's 10 previously-skipped selectors, everything inside `@media`, and every `!important`.

- [ ] **Step 1: Run the audit**

```bash
pnpm build
node dist/cli.js check test/fixtures/kitchen-sink --theme both
node dist/cli.js check examples/casino --theme both
```

- [ ] **Step 2: Triage every finding**

For each, decide and record which it is:

- **Real** — the static engine was blind, the deck has a genuine defect. Fix the slide. Prefer the smallest change that removes the defect.
- **False positive** — the probe or judge is wrong. **Fix the code, not the fixture.** A fixture edited to silence a real bug buries it.

Two shapes to expect specifically:

- **Emoji over-reporting**, if the 40-character `snippet` truncation undercounts exempt characters (flagged in Task 5). The fix is to record the full exempt count in the probe, not to widen the exemption.
- **Chrome's own UA styles** surfacing surface or contrast findings on elements the deck never styles. Judge on merit.

- [ ] **Step 3: Re-run until clean**

Both decks must report `all clear ✓` in both themes.

- [ ] **Step 4: Regenerate probe fixtures if any deck changed**

Run: `pnpm record-probe` and commit the updated JSON.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Fix what the browser-backed check newly surfaces"
```

---

### Task 11: Full verification and 0.11.0-rc.2

**Files:**

- Modify: `package.json`
- Regenerate: `docs/style-system.pdf`

- [ ] **Step 1: Full gates**

```bash
pnpm check && pnpm lint && pnpm format:check && pnpm test && pnpm test:browser
```

All green.

- [ ] **Step 2: Both decks, both themes**

```bash
node dist/cli.js check test/fixtures/kitchen-sink --theme both
node dist/cli.js check examples/casino --theme both
```

`all clear ✓`.

- [ ] **Step 3: Confirm the no-Chrome failure mode**

```bash
CHROME_BIN=/nonexistent node dist/cli.js check examples/casino
```

Expected: a non-zero exit and the message naming `zerp install-browser`. It must **not** silently fall back or produce a clean report.

- [ ] **Step 4: Measure**

Time `check --theme both` on casino and record it in the report — the spec predicted roughly `verify`'s 3.7s, and a large regression is worth knowing before release.

- [ ] **Step 5: Bump and reprint**

Set `"version": "0.11.0-rc.2"` in `package.json`, then run `pnpm build:docs` so the PDF footer stamps the new version, and read it. Do not tag, publish, or merge.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Release prep: 0.11.0-rc.2"
```

---

## Notes for the executor

- **`pnpm test` builds first.** A test failing with "not exported" usually means a stale `dist/`, not a missing implementation.
- **Never use `document.fonts.check()` for coverage.** It returns `true` for a family that does not exist. This is verified, not theoretical.
- **Never match on `familyName`.** It is the platform face name — `Montserrat Thin`, not `Montserrat`. `isCustomFont` is the only reliable signal.
- **`DOM.getDocument` must be re-sent per slide**; `window.next()` invalidates node ids.
- **Judge code must not import `playwright-core`.** If a judge test starts needing a browser, the probe/judge seam has leaked and the fast suite is gone.
- Tasks 1, 5 and 10 are the risky ones. Tasks 2, 3, 4, 6 are mechanical once the probe shape is fixed.
