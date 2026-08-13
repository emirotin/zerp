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
    assert.equal(h1.fonts.length, 0, "fonts arrive in a later task");
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
