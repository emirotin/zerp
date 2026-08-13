import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { probeDeck } from "../dist/check/probe.js";

const SYSTEM_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser",
];
const CHROME_CANDIDATES = [process.env.CHROME_BIN, ...SYSTEM_CHROME_CANDIDATES].filter(Boolean);
const browserTestsEnabled = process.env.ZERP_RUN_BROWSER_TEST === "1";

function systemChromeAvailable(candidates) {
  return candidates.some((candidate) => {
    if (candidate.includes("/") && !existsSync(candidate)) {
      return false;
    }
    return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0;
  });
}

function canFindChrome() {
  return systemChromeAvailable(CHROME_CANDIDATES);
}

test(
  "the probe reports computed styles and geometry per slide",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
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
    assert.ok(h1.fonts.length > 0, "fonts are collected via CDP (see probe-fonts.test.mjs)");
  },
);

test(
  "the probe advances through every slide",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
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
  },
);

// Ported from the deleted `zerp verify` CLI tests (test/verify.test.mjs) when
// the verify command was merged into check: these facts (viewport per slide,
// frame/visibility/display counts) live on DeckProbe, not on CheckReport's
// JSON (which only carries slideCount/themes/findings), so there is no
// `zerp check --json` equivalent to assert them through — probeDeck is the
// layer that actually owns them, same as it always did.
test(
  "a custom --size reaches every slide's viewport, not just the default",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
    // 1600x900 rather than the 1920x1080 default, so this pins width/height
    // actually taking effect rather than merely matching what the default
    // probe would have reported anyway.
    const probe = await probeDeck({
      rootDir: "test/fixtures/wrapper-deck",
      theme: "dark",
      width: 1600,
      height: 900,
      safeMargin: 0,
      timeoutMs: 30000,
    });
    assert.equal(probe.width, 1600);
    assert.equal(probe.height, 900);
    for (const slide of probe.slides) {
      assert.equal(slide.viewportWidth, 1600);
      assert.equal(slide.viewportHeight, 900);
    }
  },
);

test(
  "the probe honors an authored slide root's own display value and reports frame/visibility facts per slide",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
    // wrapper-deck's first slide sets `display: grid` on its own authored
    // root (see slides/00-grid-root.html); the framework's frame wrapper
    // must not override it. This is exactly the class of regression `zerp
    // verify` used to catch (wrapper visibility, custom root display) —
    // ported here onto the probe directly.
    const probe = await probeDeck({
      rootDir: "test/fixtures/wrapper-deck",
      theme: "dark",
      width: 1920,
      height: 1080,
      safeMargin: 0,
      timeoutMs: 30000,
    });
    assert.equal(probe.frameCount, 2);
    assert.equal(probe.slideCount, 2);
    assert.equal(probe.innerSlideCount, 2);
    assert.equal(probe.slides[0]?.activeDisplay, "grid");
    assert.deepEqual(
      probe.slides.map((slide) => [
        slide.activeCount,
        slide.visibleCount,
        slide.activeIndex,
        slide.activeClass,
      ]),
      [
        [1, 1, 1, true],
        [1, 1, 2, true],
      ],
    );
    // Each slide carries its source attribution, mirroring zerp check.
    assert.deepEqual(
      probe.slides.map((slide) => slide.src),
      ["slides/00-grid-root.html", "slides/01-plain.md"],
    );
    for (const slide of probe.slides) {
      assert.equal(slide.srcSlide, "1/1");
    }
  },
);

test(
  "browser errors report deck-relative paths, not absolute file:// URLs",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
    // kitchen-sink intentionally references missing images that generate 404 errors.
    // The probe should report these as deck-relative paths (slides/...) not as
    // file:///absolute/path URLs, so fixtures remain portable across machines.
    const probe = await probeDeck({
      rootDir: "test/fixtures/kitchen-sink",
      theme: "dark",
      width: 1920,
      height: 1080,
      safeMargin: 0,
      timeoutMs: 30000,
    });
    assert.ok(probe.browserErrors.length > 0, "kitchen-sink has intentional missing assets");
    assert.ok(
      probe.browserErrors.every((err) => !err.startsWith("file://")),
      "no error starts with file:// (all are deck-relative)",
    );
    // Missing image paths should be resolved relative to the deck root.
    assert.ok(
      probe.browserErrors.some((err) => err.includes("slides/images/missing")),
      "contains expected missing image references",
    );
  },
);
