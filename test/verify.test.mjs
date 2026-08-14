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

// `zerp verify` renders the exact requested viewport size / records whether
// the checked size was the default: both used to live here, asserting on
// VerifyReport's own `viewport`/`fontsActive` fields. checkPresentation's
// report carries neither (it exposes slideCount/themes/findings, not a
// per-run viewport echo), so there is no equivalent to convert those two
// cases to — that was verify's own report surface, not a behavior check.
// The behavior itself (a custom --size actually reaching the browser) is
// ported onto probeDeck directly in probe.test.mjs, which is the layer that
// still owns those facts.

test("the probe measures after fonts settle over a playwright-core session", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile("dist/check/probe.js", "utf8");
  // Guard the two load-bearing transport properties: the probe must wait for
  // font activation (font-dependent overflow was invisible without it), and
  // the transport must be playwright-core — the battle-tested driver that
  // retired the hand-rolled `--remote-debugging-pipe` CDP client. Task 8
  // deleted verify.ts's own copy of this browser session (its old
  // `verifyPresentation`/`runProbe` command, superseded by `zerp check`);
  // probe.ts now drives the one shared session verify.ts exports
  // (`runBrowserSession`), so this pins the properties on the file that
  // actually runs them.
  assert.match(source, /document\.fonts\.ready/);
  const verifySource = await readFile("dist/verify.js", "utf8");
  assert.match(verifySource, /playwright-core/);
});

// wrapper-deck's frame/visibility/custom-root-display regression coverage
// moved to probe.test.mjs ("the probe honors an authored slide root's own
// display value...") — CheckReport's findings can only prove the *absence*
// of a frame problem, not pin the exact activeDisplay/activeIndex/src facts
// the original verify test checked, so the faithful port is onto the probe
// layer that still carries them.

test(
  "zerp check resolves a browser with CHROME_BIN unset",
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
        "check",
        "test/fixtures/wrapper-deck",
        "--theme",
        "dark",
        "--size",
        "1920x1080",
        "--only",
        "frame",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000, env },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.findings, []);
  },
);

test(
  "zerp check --safe-margin flags edge-hugging content and honors data-zerp-bleed",
  { skip: !browserTestsEnabled || !canFindChrome() },
  () => {
    const withoutFlag = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "check",
        "test/fixtures/safe-zone-deck",
        "--theme",
        "light",
        "--size",
        "1920x1080",
        "--only",
        "safe-zone",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(withoutFlag.status, 0, `${withoutFlag.stdout}\n${withoutFlag.stderr}`);
    const cleanReport = JSON.parse(withoutFlag.stdout);
    // safe-zone checking is off unless --safe-margin is given (0 disables it).
    assert.deepEqual(cleanReport.findings, []);

    const withFlag = spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "check",
        "test/fixtures/safe-zone-deck",
        "--theme",
        "light",
        "--size",
        "1920x1080",
        "--safe-margin",
        "24",
        "--only",
        "safe-zone",
        "--json",
      ],
      { encoding: "utf8", timeout: 60_000 },
    );
    assert.equal(withFlag.status, 1, `${withFlag.stdout}\n${withFlag.stderr}`);
    const report = JSON.parse(withFlag.stdout);
    assert.equal(report.findings.length, 1, JSON.stringify(report.findings));
    const [finding] = report.findings;
    assert.equal(finding.category, "safe-zone");
    assert.equal(finding.slideIndex, 1);
    assert.equal(finding.slideSrc, "slides/01-edge.html");
    assert.match(finding.message, /edge-badge enters the 24px print safe margin/);
    assert.match(finding.message, /left \(0px\)/);
    assert.match(finding.message, /top \(\d+px\)/);
  },
);
