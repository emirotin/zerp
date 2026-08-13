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
  "the probe records which fonts actually rendered each element",
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
  },
);
