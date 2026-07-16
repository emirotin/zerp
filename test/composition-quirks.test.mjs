// Pins the source-fidelity guarantees of the composition pipeline. The probe
// deck deliberately contains markup that previously confused the regex pass.
// Keep these cases close to the parser so a future refactor cannot silently
// reintroduce the old display/annotation failures.
//
// The probe deck is written to a temp dir at runtime: it contains deliberately
// unusual markup (unquoted attributes, '>' inside an attribute value) that a
// formatter would "fix" if it lived on disk as a fixture.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { parseHTML } from "linkedom";

import { composeSlidesHtml } from "../dist/presentation.js";

const PROBE_SLIDES = `<div class="slide">
  <h2>Probe</h2>
  <script>
    var tpl = '<div class="slide">from a string</div>';
    var img = new Image();
    img.src = "./images/from-script.png";
  </script>
</div>
<div class="slide" title="a > b">
  <h2>Tricky</h2>
</div>
<div class=slide>
  <h2>Unquoted</h2>
</div>
<div class="slide">
  <style>
    .qk {
      background-image: url("./images/from-css.png");
    }
  </style>
  <h2>Css</h2>
</div>
`;

let rootDir;
let html;

before(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "zerp-quirks-"));
  await mkdir(path.join(rootDir, "slides"));
  await writeFile(path.join(rootDir, "slides", "00-quirks.html"), PROBE_SLIDES, "utf8");
  html = await composeSlidesHtml(rootDir);
});

after(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

test("guarantee: relative asset paths inside inline scripts are rewritten", () => {
  // Built decks are single files at the deck root; script-fetched assets need
  // the same slides/-prefix rewrite as attributes. Keep this narrow rewrite
  // even though the parser correctly ignores script markup as HTML.
  assert.match(html, /img\.src="slides\/images\/from-script\.png"/);
});

test("real slide markup is annotated while slide-looking script text is untouched", () => {
  assert.match(html, /var tpl = '<div class="slide">from a string<\/div>';/);
  assert.doesNotMatch(html, /var tpl = '<div class="slide" data-zerp/);
  assert.match(html, /data-zerp-src-slide="4\/4" data-zerp-index="4">\s*<style>/);
});

test("a '>' inside an attribute value does not derail annotation", () => {
  assert.match(html, /class="slide" title="a > b" data-zerp-src=/);
  assert.doesNotMatch(html, /title="a {2}data-zerp-src=/);
});

test("unquoted class attributes are annotated without normalizing authored bytes", () => {
  assert.match(html, /<div class=slide data-zerp-src="slides\/00-quirks\.html"/);
});

test("each real slide gets one framework frame", () => {
  const { document } = parseHTML(`<body>${html}</body>`);
  const frames = document.querySelectorAll("[data-zerp-slide]");
  assert.equal(frames.length, 4);
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    assert.ok(frame.querySelector(".slide"), `frame ${index + 1} has an inner slide`);
  }
});

test("documented gap: url() references in style blocks are not rewritten", () => {
  assert.match(html, /url\("\.\/images\/from-css\.png"\)/);
});

test("nested slide roots fail with an actionable composition error", async () => {
  const nestedRoot = await mkdtemp(path.join(tmpdir(), "zerp-nested-"));
  await mkdir(path.join(nestedRoot, "slides"));
  await writeFile(
    path.join(nestedRoot, "slides", "00-nested.html"),
    '<div class="slide"><div class="slide">nested</div></div>',
    "utf8",
  );
  try {
    await assert.rejects(() => composeSlidesHtml(nestedRoot), /Nested \.slide elements/);
  } finally {
    await rm(nestedRoot, { recursive: true, force: true });
  }
});
