import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPresentationHtml } from "../dist/presentation.js";

const rootDir = "test/fixtures/clean-deck";

test("default theme is system", async () => {
  const html = await buildPresentationHtml({ rootDir });
  assert.match(html, /<html lang="en" data-zerp-theme="system" data-zerp-default-theme="system">/);
});

test("explicit theme is baked into the html element", async () => {
  const html = await buildPresentationHtml({ rootDir, theme: "light" });
  assert.match(html, /data-zerp-theme="light" data-zerp-default-theme="light"/);
});

test("slides carry their source path and fonts include weight 600", async () => {
  const html = await buildPresentationHtml({ rootDir });
  assert.match(html, /<div class="slide" data-zerp-src="slides\/00-ok\.md">/);
  assert.match(html, /Montserrat:wght@400;600;700;900/);
  assert.match(html, /id="theme-switch"/);
  assert.match(html, /data-theme-choice="system"/);
});
