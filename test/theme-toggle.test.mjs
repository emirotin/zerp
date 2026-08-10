import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

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

// localStorage is the whole subject here, so the deck needs a real origin —
// a file:// page gets an opaque one in Chromium.
async function serve(html) {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Reads the whole visible state of the control in one hop: what is painted,
// what is pinned, and where the button says the next press leads.
const STATE = `(() => ({
  theme: document.documentElement.dataset.zerpTheme,
  stored: localStorage.getItem("zerp-theme"),
  target: document.getElementById("theme-toggle").dataset.themeTarget,
  sunVisible: getComputedStyle(document.querySelector(".theme-icon-sun")).display !== "none",
  moonVisible: getComputedStyle(document.querySelector(".theme-icon-moon")).display !== "none",
}))()`;

async function withDeck(theme, colorScheme, body) {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/clean-deck", theme });
  const site = await serve(html);
  const browser = await chromium.launch({ executablePath: resolveBrowserExecutable() });
  try {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await page.goto(site.url);
    await body(page, context);
  } finally {
    await browser.close();
    await site.close();
  }
}

test(
  "the toggle pins the opposite scheme, then hands control back to the default",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    await withDeck("system", "dark", async (page) => {
      // Untouched: following the OS, and the button offers the other scheme.
      assert.deepEqual(await page.evaluate(STATE), {
        theme: "system",
        stored: null,
        target: "light",
        sunVisible: true,
        moonVisible: false,
      });

      // First press pins the literal opposite of what is on screen.
      await page.click("#theme-toggle");
      assert.deepEqual(await page.evaluate(STATE), {
        theme: "light",
        stored: "light",
        target: "dark",
        sunVisible: false,
        moonVisible: true,
      });

      // Second press unpins it — the stored value is removed, not overwritten.
      await page.click("#theme-toggle");
      assert.deepEqual(await page.evaluate(STATE), {
        theme: "system",
        stored: null,
        target: "light",
        sunVisible: true,
        moonVisible: false,
      });
    });
  },
);

test(
  "a pinned override survives an OS scheme change that agrees with it",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    await withDeck("system", "dark", async (page) => {
      await page.click("#theme-toggle");
      assert.equal(await page.evaluate(`localStorage.getItem("zerp-theme")`), "light");

      // The OS now agrees with the pin. Tidying up here would silently demote
      // a deliberate choice into a default, on an event the user never caused.
      await page.emulateMedia({ colorScheme: "light" });
      // Both sides of the toggle now paint light, so the button leads there
      // too — but pressing it still releases the pin. The media-query change
      // event lands asynchronously, so wait for the restated target.
      await page.waitForFunction(
        `document.getElementById("theme-toggle").dataset.themeTarget === "light"`,
      );
      const state = await page.evaluate(STATE);
      assert.equal(state.stored, "light");
      assert.equal(state.theme, "light");

      await page.click("#theme-toggle");
      assert.equal(await page.evaluate(`localStorage.getItem("zerp-theme")`), null);
    });
  },
);

test(
  "a deck built with an explicit default toggles against that default, not the OS",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    await withDeck("light", "dark", async (page) => {
      assert.deepEqual(await page.evaluate(STATE), {
        theme: "light",
        stored: null,
        target: "dark",
        sunVisible: false,
        moonVisible: true,
      });

      await page.click("#theme-toggle");
      assert.deepEqual(await page.evaluate(STATE), {
        theme: "dark",
        stored: "dark",
        // Back to the deck's own default, which the OS has no say in.
        target: "light",
        sunVisible: true,
        moonVisible: false,
      });
    });
  },
);

test(
  "the t key drives the same two-state cycle as the button",
  { skip: !browserTestsEnabled || !chromeAvailable(), timeout: 60_000 },
  async () => {
    await withDeck("system", "light", async (page) => {
      await page.keyboard.press("t");
      assert.deepEqual(await page.evaluate(STATE), {
        theme: "dark",
        stored: "dark",
        target: "light",
        sunVisible: true,
        moonVisible: false,
      });

      await page.keyboard.press("t");
      assert.equal(await page.evaluate(`localStorage.getItem("zerp-theme")`), null);
    });
  },
);
