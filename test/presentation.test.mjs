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
  assert.match(
    html,
    /<div data-zerp-slide>\s*<div class="slide" data-zerp-src="slides\/00-ok\.md" data-zerp-src-slide="1\/1" data-zerp-index="1">/,
  );
  assert.match(html, /id="theme-switch"/);
  assert.match(html, /data-theme-choice="system"/);
});

test("multi-slide files get in-file ordinals and global deck positions", async () => {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/multi-deck" });
  assert.match(
    html,
    /<div data-zerp-slide>\s*<div class="slide" data-zerp-src="slides\/00-two\.html" data-zerp-src-slide="1\/2" data-zerp-index="1"/,
  );
  assert.match(
    html,
    /<div data-zerp-slide>\s*<div class="slide" data-zerp-src="slides\/00-two\.html" data-zerp-src-slide="2\/2" data-zerp-index="2"/,
  );
  assert.match(
    html,
    /<div data-zerp-slide>\s*<div class="slide" data-zerp-src="slides\/01-more\.md" data-zerp-src-slide="1\/2" data-zerp-index="3"/,
  );
  assert.match(
    html,
    /<div data-zerp-slide>\s*<div class="slide" data-zerp-src="slides\/01-more\.md" data-zerp-src-slide="2\/2" data-zerp-index="4"/,
  );
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

test("deck title comes from the first slide's highest-level heading", async () => {
  // 00-styles.html is style-only (no slide div) — skipped; in 01-content.html
  // the h2 outranks the h3 that appears first in document order.
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/titled-deck" });
  assert.match(html, /<title>The Real Deck Title<\/title>/);
});

test("deck title falls back to the h1 of a markdown first slide", async () => {
  const html = await buildPresentationHtml({ rootDir });
  assert.match(html, /<title>Hello<\/title>/);
});

test("explicit title option overrides the derived title", async () => {
  const html = await buildPresentationHtml({ rootDir, title: "Custom" });
  assert.match(html, /<title>Custom<\/title>/);
});

test("deck title falls back to the folder name when the first slide has no heading", async () => {
  const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const pathMod = await import("node:path");
  const dir = await mkdtemp(pathMod.join(tmpdir(), "zerp-untitled-"));
  await mkdir(pathMod.join(dir, "slides"));
  await writeFile(
    pathMod.join(dir, "slides", "00-only.html"),
    '<div class="slide"><p>No heading here.</p></div>\n',
    "utf8",
  );
  try {
    const html = await buildPresentationHtml({ rootDir: dir });
    assert.ok(html.includes(`<title>${pathMod.basename(dir)}</title>`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
