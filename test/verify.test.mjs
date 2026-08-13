import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { chromium } from "playwright-core";

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

// True when the resolution chain would succeed with CHROME_BIN unset: either
// playwright-core's managed chromium is installed, or a system browser is on
// the path. `executablePath()` computes a path even when nothing is installed
// (and throws in some builds), so guard it with existsSync.
function canResolveWithoutChromeBin() {
  try {
    const managed = chromium.executablePath();
    if (managed && existsSync(managed)) {
      return true;
    }
  } catch {
    // No managed browser; fall back to a system browser.
  }
  return systemChromeAvailable(SYSTEM_CHROME_CANDIDATES);
}

test(
  "zerp verify renders the exact requested viewport size",
  { skip: !browserTestsEnabled || !canFindChrome() },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "verify",
        "test/fixtures/wrapper-deck",
        "--theme",
        "dark",
        "--size",
        "1600x900",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const [report] = JSON.parse(result.stdout);
    // The probe waits for the inlined fonts before measuring; fontsActive
    // proves the wait happened instead of assuming it.
    assert.equal(report.fontsActive, true);
    // A size that differs from the 1920×1080 default, so this pins --size
    // actually taking effect rather than merely matching what verify would
    // have done anyway.
    assert.deepEqual(report.viewport, { width: 1600, height: 900, defaulted: false });
    for (const slide of report.slides) {
      assert.equal(slide.viewportWidth, 1600);
      assert.equal(slide.viewportHeight, 900);
    }
  },
);

test(
  "zerp verify records whether the checked viewport was the default",
  { skip: !browserTestsEnabled || !canFindChrome() },
  () => {
    const result = spawnSync(
      process.execPath,
      ["dist/cli.js", "verify", "test/fixtures/wrapper-deck", "--theme", "dark", "--json"],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const [report] = JSON.parse(result.stdout);
    assert.deepEqual(report.viewport, { width: 1920, height: 1080, defaulted: true });
  },
);

test("verify measures after fonts settle over a playwright-core session", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("dist/verify.js", "utf8");
  // Guard the two load-bearing transport properties: the probe must wait for
  // font activation (font-dependent overflow was invisible without it), and
  // the transport must be playwright-core — the battle-tested driver that
  // retired the hand-rolled `--remote-debugging-pipe` CDP client.
  assert.match(source, /document\.fonts\.ready/);
  assert.match(source, /playwright-core/);
});

test(
  "zerp verify catches wrapper visibility and custom root display regressions",
  { skip: !browserTestsEnabled || !canFindChrome() },
  () => {
    const result = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "verify",
        "test/fixtures/wrapper-deck",
        "--theme",
        "both",
        "--size",
        "1920x1080",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const reports = JSON.parse(result.stdout);
    assert.equal(reports.length, 2);
    for (const report of reports) {
      assert.equal(report.slideCount, 2);
      assert.deepEqual(report.failures, []);
      assert.equal(report.slides[0]?.activeDisplay, "grid");
      assert.deepEqual(
        report.slides.map((slide) => [
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
        report.slides.map((slide) => slide.src),
        ["slides/00-grid-root.html", "slides/01-plain.md"],
      );
      for (const slide of report.slides) {
        assert.equal(slide.srcSlide, "1/1");
      }
    }
  },
);

test(
  "zerp verify resolves a browser with CHROME_BIN unset",
  { skip: !browserTestsEnabled || !canResolveWithoutChromeBin() },
  () => {
    // Exercise the fallback chain (playwright-managed chromium, then system
    // Chrome) rather than the CHROME_BIN override the other browser tests use.
    const env = { ...process.env };
    delete env.CHROME_BIN;
    const result = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "verify",
        "test/fixtures/wrapper-deck",
        "--theme",
        "dark",
        "--size",
        "1920x1080",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000, env },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const [report] = JSON.parse(result.stdout);
    assert.equal(report.fontsActive, true);
    assert.deepEqual(report.failures, []);
  },
);

test(
  "zerp verify --safe-margin flags edge-hugging content and honors data-zerp-bleed",
  { skip: !browserTestsEnabled || !canFindChrome() },
  () => {
    const withoutFlag = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "verify",
        "test/fixtures/safe-zone-deck",
        "--theme",
        "light",
        "--size",
        "1920x1080",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(withoutFlag.status, 0, `${withoutFlag.stdout}\n${withoutFlag.stderr}`);
    const [cleanReport] = JSON.parse(withoutFlag.stdout);
    assert.deepEqual(cleanReport.failures, []);
    assert.equal(cleanReport.safeMargin, undefined);

    const withFlag = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "verify",
        "test/fixtures/safe-zone-deck",
        "--theme",
        "light",
        "--size",
        "1920x1080",
        "--safe-margin",
        "24",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(withFlag.status, 1, `${withFlag.stdout}\n${withFlag.stderr}`);
    const [report] = JSON.parse(withFlag.stdout);
    assert.equal(report.safeMargin, 24);
    assert.equal(report.failures.length, 1, JSON.stringify(report.failures));
    const [failure] = report.failures;
    assert.equal(failure.slide, 1);
    assert.equal(failure.src, "slides/01-edge.html");
    assert.match(failure.message, /edge-badge enters the 24px print safe margin/);
    assert.match(failure.message, /left \(0px\)/);
    assert.match(failure.message, /top \(\d+px\)/);
  },
);
