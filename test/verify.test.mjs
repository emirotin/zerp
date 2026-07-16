import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser",
].filter(Boolean);
const browserTestsEnabled = process.env.ZERP_RUN_BROWSER_TEST === "1";

function canFindChrome() {
  return CHROME_CANDIDATES.some((candidate) => {
    if (candidate.includes("/") && !existsSync(candidate)) {
      return false;
    }
    return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0;
  });
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
        "1280x720",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const [report] = JSON.parse(result.stdout);
    for (const slide of report.slides) {
      assert.equal(slide.viewportWidth, 1280);
      assert.equal(slide.viewportHeight, 720);
    }
  },
);

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
        "1280x720",
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
    }
  },
);
