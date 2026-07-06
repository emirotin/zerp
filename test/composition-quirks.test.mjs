// Pins the current behavior of the regex-based composition pipeline — both
// its load-bearing quirks and its known bugs — so that any refactor (see
// docs/composition-fidelity.md) changes them consciously, not by accident.
// A test failing here after a composition change means: read the doc, decide
// whether the new behavior is the intended fix, then update the pin.
//
// The probe deck is written to a temp dir at runtime: it contains
// deliberately unusual markup (unquoted attributes, '>' inside an attribute
// value) that a formatter would "fix" if it lived on disk as a fixture.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

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
  // the same slides/-prefix rewrite as attributes. A DOM-based rewriter would
  // skip script bodies and break offline demos — keep this working.
  assert.match(html, /img\.src="slides\/images\/from-script\.png"/);
});

test("known bug: slide-div markup inside a script string gets annotated and skews counts", () => {
  // The author's JS string is rewritten…
  assert.match(html, /var tpl = '<div class="slide" data-zerp-src=/);
  // …and counted: the file has 3 real DOM slides (the unquoted one is missed,
  // see below) but reports 4, so data-zerp-index drifts from the runtime
  // counter for every later slide.
  assert.match(html, /data-zerp-src-slide="4\/4" data-zerp-index="4">\s*<style>/);
});

test("known bug: a '>' inside an attribute value derails the annotation", () => {
  // The attrs regex stops at the first '>', so the injected attributes land
  // inside the title value and the markup is mangled.
  assert.match(html, /title="a {2}data-zerp-src=/);
});

test("known bug: unquoted class attributes are never annotated", () => {
  // querySelectorAll(".slide") sees this slide; the annotation regex does not.
  assert.match(html, /<div class=slide>/);
  assert.doesNotMatch(html, /class=slide data-zerp/);
});

test("documented gap: url() references in style blocks are not rewritten", () => {
  assert.match(html, /url\("\.\/images\/from-css\.png"\)/);
});
