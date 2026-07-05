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

test("slides carry their source path and chrome markup is present", async () => {
  const html = await buildPresentationHtml({ rootDir });
  assert.match(html, /<div class="slide" data-zerp-src="slides\/00-ok\.md">/);
  assert.match(html, /id="theme-switch"/);
  assert.match(html, /data-theme-choice="system"/);
});

test("fonts are bundled inline and no external requests remain", async () => {
  const html = await buildPresentationHtml({ rootDir });
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
  assert.match(html, /@font-face/);
  assert.match(html, /src: url\(data:font\/woff2;base64,/);
  assert.match(html, /unicode-range:/);
  for (const face of ["Montserrat", "Roboto Mono"]) {
    assert.ok(html.includes(`font-family: '${face}'`), `${face} bundled`);
  }
  assert.ok(html.includes("font-weight: 900"), "black weight bundled");
  assert.ok(html.includes("font-style: italic"), "italic face bundled");
  assert.ok(html.length > 200_000, "inlined fonts present");
  assert.ok(html.length < 2_000_000, "bundle stays lean");
});
