import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { chromium } from "playwright-core";

import { buildPresentationHtml } from "../dist/presentation.js";
import { resolveBrowserExecutable } from "../dist/verify.js";

const browserTestsEnabled = process.env.ZERP_RUN_BROWSER_TEST === "1";

function chromeAvailable() {
  try {
    return Boolean(resolveBrowserExecutable());
  } catch {
    return false;
  }
}

let tmpDir;
let htmlPath;

before(async () => {
  if (!browserTestsEnabled || !chromeAvailable()) {
    return;
  }
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/clean-deck" });
  tmpDir = await mkdtemp(path.join(tmpdir(), "zerp-scale-"));
  htmlPath = path.join(tmpDir, "index.html");
  await writeFile(htmlPath, html, "utf8");
});

after(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

async function withViewport(width, height, body) {
  const browser = await chromium.launch({ executablePath: resolveBrowserExecutable() });
  try {
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await body(page, context);
  } finally {
    await browser.close();
  }
}

test(
  "the stage is scaled and centered to fit a smaller window, proportionally",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    // 960x540 is exactly half of the design size (1920x1080): a uniform
    // 0.5 scale with no letterboxing in either axis.
    await withViewport(960, 540, async (page) => {
      await page.goto(`file://${htmlPath}`);
      const transform = await page.evaluate(
        `document.querySelector("[data-zerp-stage]").style.transform`,
      );
      assert.match(transform, /^translate\(0px, 0px\) scale\(0\.5\)$/);
    });
  },
);

test(
  "the stage carries no transform at all when the window matches the design size",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    await withViewport(1920, 1080, async (page) => {
      await page.goto(`file://${htmlPath}`);
      const transform = await page.evaluate(
        `document.querySelector("[data-zerp-stage]").style.transform`,
      );
      assert.equal(transform, "");
    });
  },
);

test(
  "a narrower-aspect window letterboxes vertically instead of overflowing",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    // 1280x1080 is narrower than the design aspect ratio, so the limiting
    // dimension is width: scale = 1280 / 1920 = 0.6666...; the leftover
    // vertical space is split evenly above and below the scaled stage.
    const scale = 1280 / 1920;
    const expectedTy = (1080 - 1080 * scale) / 2;
    await withViewport(1280, 1080, async (page) => {
      await page.goto(`file://${htmlPath}`);
      const transform = await page.evaluate(
        `document.querySelector("[data-zerp-stage]").style.transform`,
      );
      const match = transform.match(/^translate\(0px, ([0-9.]+)px\) scale\(([0-9.]+)\)$/);
      assert.ok(match, `expected a translate+scale transform, got "${transform}"`);
      const [, ty, reportedScale] = match;
      assert.ok(
        Math.abs(Number.parseFloat(ty) - expectedTy) < 0.5,
        `expected ty near ${expectedTy}, got ${ty}`,
      );
      assert.ok(
        Math.abs(Number.parseFloat(reportedScale) - scale) < 0.001,
        `expected scale near ${scale}, got ${reportedScale}`,
      );
    });
  },
);

test(
  "the resize handler re-fits the stage live as the window changes",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    await withViewport(1920, 1080, async (page, context) => {
      await page.goto(`file://${htmlPath}`);
      await page.setViewportSize({ width: 960, height: 540 });
      // setViewportSize itself fires the resize event Chromium delivers to
      // the page; give the listener a tick to run before reading the style.
      await page.waitForFunction(
        `document.querySelector("[data-zerp-stage]").style.transform !== ""`,
      );
      const transform = await page.evaluate(
        `document.querySelector("[data-zerp-stage]").style.transform`,
      );
      assert.match(transform, /^translate\(0px, 0px\) scale\(0\.5\)$/);
      void context;
    });
  },
);

test(
  "window.__ZERP_NO_SCALE__ disables the fit entirely, even off the design size",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    await withViewport(960, 540, async (page) => {
      await page.addInitScript("window.__ZERP_NO_SCALE__ = true;");
      await page.goto(`file://${htmlPath}`);
      const transform = await page.evaluate(
        `document.querySelector("[data-zerp-stage]").style.transform`,
      );
      assert.equal(transform, "");
    });
  },
);

test(
  "cqh units survive print media instead of collapsing when the stage box goes auto",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    // container-type: size stays active on [data-zerp-stage] in print, so an
    // `auto` box there resolves the container height to 0 and collapses any
    // author cqh unit. width/height: 100vw/100vh keep the container tracking
    // the page box; prove it by measuring a cqh-sized element under print.
    const tmpDir = await mkdtemp(path.join(tmpdir(), "zerp-print-cq-"));
    try {
      await mkdir(path.join(tmpDir, "slides"));
      await writeFile(
        path.join(tmpDir, "slides", "00-cq.html"),
        '<div class="slide"><div id="cq-el" style="width: 100px; height: 60cqh;"></div></div>\n',
        "utf8",
      );
      const html = await buildPresentationHtml({ rootDir: tmpDir });
      const htmlPath2 = path.join(tmpDir, "index.html");
      await writeFile(htmlPath2, html, "utf8");
      await withViewport(1920, 1080, async (page) => {
        await page.emulateMedia({ media: "print" });
        await page.goto(`file://${htmlPath2}`);
        const stageHeight = await page.evaluate(
          `document.querySelector("[data-zerp-stage]").getBoundingClientRect().height`,
        );
        const elHeight = await page.evaluate(
          `document.getElementById("cq-el").getBoundingClientRect().height`,
        );
        assert.ok(
          Math.abs(stageHeight - 1080) < 2,
          `expected stage height near 1080, got ${stageHeight}`,
        );
        assert.ok(
          Math.abs(elHeight - 648) < 2,
          `expected cqh element height near 648, got ${elHeight}`,
        );
      });
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
);
