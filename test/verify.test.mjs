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
    // The probe waits for the inlined fonts before measuring; fontsActive
    // proves the wait happened instead of assuming it.
    assert.equal(report.fontsActive, true);
    // An explicitly passed --size is recorded as a deliberate choice.
    assert.deepEqual(report.viewport, { width: 1280, height: 720, defaulted: false });
    for (const slide of report.slides) {
      assert.equal(slide.viewportWidth, 1280);
      assert.equal(slide.viewportHeight, 720);
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
    assert.deepEqual(report.viewport, { width: 1280, height: 720, defaulted: true });
  },
);

test("verify measures after fonts settle over a live CDP session", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("dist/verify.js", "utf8");
  // Guard the two load-bearing transport properties: the probe must wait for
  // font activation (font-dependent overflow was invisible without it), and
  // the viewport must come from device-metrics emulation, not --window-size
  // calibration against a one-shot DOM dump.
  assert.match(source, /document\.fonts\.ready/);
  assert.match(source, /Emulation\.setDeviceMetricsOverride/);
  assert.match(source, /--remote-debugging-pipe/);
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
