import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { buildPresentationHtml } from "../dist/presentation.js";

test("built default stylesheet = generated tokens + token-free base styles", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  assert.match(css, /--zerp-bg: #12141c;/);
  assert.match(css, /\.card \{/);
  assert.match(css, /\.stat-row \{/);
  assert.match(css, /\[hidden\] \{[^}]*display: none !important/);
  assert.match(css, /\[data-zerp-slide\] \{[^}]*display: none/);
  assert.match(css, /\[data-zerp-slide\]\[data-zerp-slide-active\] \{[^}]*display: flex/);
  assert.match(css, /\.slide \{[^}]*display: flex/);
  assert.doesNotMatch(css, /\.slide\.active\s*\{[^}]*display/);
  const afterTokens = css.split("/* base styles */")[1];
  assert.ok(afterTokens, "base styles marker present");
  assert.doesNotMatch(afterTokens, /#[0-9a-fA-F]{3,8}\b/, "no raw hex outside generated tokens");
  assert.doesNotMatch(css, /\.two-col|\.big-number|\.accent-green/, "0.1.x classes removed");
});

test("built stylesheet paginates one page per slide in print", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  const printBlock = css.slice(css.indexOf("@media print"));
  assert.ok(printBlock.startsWith("@media print"), "print block present");
  // The print block is last so its frame display override wins by source order.
  assert.ok(css.indexOf("@media print") > css.indexOf("/* base styles */"));
  // Each frame becomes one page box.
  assert.match(printBlock, /\[data-zerp-slide\] \{[^}]*display: flex/);
  assert.match(printBlock, /\[data-zerp-slide\] \{[^}]*break-after: page/);
  // Presentation chrome is hidden on paper.
  assert.match(printBlock, /\.source-badge \{[^}]*display: none !important/);
  // Colors print as authored.
  assert.match(printBlock, /print-color-adjust: exact/);
});

test("step-hiding rules are scoped to @media screen", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  const screenBlock = css.slice(css.indexOf("@media screen"), css.indexOf("@media print"));
  assert.match(screenBlock, /\[data-step\]:not\(\.revealed\) \{[^}]*visibility: hidden/);
  assert.match(screenBlock, /\[data-until-step\]\.step-done \{[^}]*visibility: hidden/);
  // The unscoped base frame rule stays outside any at-rule.
  const beforeScreen = css.slice(0, css.indexOf("@media screen"));
  assert.match(beforeScreen, /\[data-zerp-slide\] \{[^}]*display: none/);
});

test("a built deck inlines the Zerp Symbols arrow face, scoped to U+2192", async () => {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/kitchen-sink" });
  const block = html.match(/@font-face \{[^}]*Zerp Symbols[^}]*\}/)?.[0];
  assert.ok(block, "Zerp Symbols @font-face present in the single-file deck");
  // Inlined as data, like every other face: a built deck stays offline.
  assert.match(block, /src: url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\);/);
  // The range is the whole point — without it this face would answer for
  // characters Montserrat and Roboto Mono already cover.
  assert.match(block, /unicode-range: U\+2192;/);
});

test("the arrow markers name Zerp Symbols first so exporters pick it up", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  assert.match(css, /\.slide ul li::before \{[^}]*font-family: "Zerp Symbols", "Montserrat"/);
  assert.match(css, /\.flow > \* \+ \*::before \{[^}]*font-family: "Zerp Symbols", "Montserrat"/);
  // Behind the real family everywhere else, where it only ever serves U+2192.
  assert.match(css, /font-family: "Montserrat", "Zerp Symbols", sans-serif;/);
  assert.match(css, /font-family: "Roboto Mono", "Zerp Symbols", monospace;/);
});

test("token contrast json is emitted for the checker", async () => {
  const json = JSON.parse(await readFile("dist/check/token-contrast.json", "utf8"));
  assert.ok(json.dark.lc["--zerp-bg"]["--zerp-muted"] < -60);
  assert.equal(json.light.bg["--zerp-surface"], "#fafbfe");
});
