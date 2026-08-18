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
  // Five stacks, defined once and read by every rule, so a deck can redefine
  // them without the framework knowing which rules exist.
  assert.match(css, /--zerp-font-body: "Montserrat", "Zerp Symbols", sans-serif;/);
  assert.match(css, /--zerp-font-marker: "Zerp Symbols", "Montserrat", sans-serif;/);
  assert.match(css, /--zerp-font-mono: "Roboto Mono", "Zerp Symbols", monospace;/);
  // The nav's ← and → both come from the same fallback on purpose.
  assert.match(css, /--zerp-font-nav: "Roboto Mono", monospace;/);
  assert.match(css, /\.slide ul li::before \{[^}]*font-family: var\(--zerp-font-marker\)/);
  assert.match(css, /\.flow > \* \+ \*::before \{[^}]*font-family: var\(--zerp-font-marker\)/);
  assert.match(css, /\.nav button \{[^}]*font-family: var\(--zerp-font-nav\)/);
  assert.match(css, /--zerp-font-display: "Montserrat", "Zerp Symbols", sans-serif;/);
  assert.match(css, /:where\(\.slide h1\) \{\s*font-family: var\(--zerp-font-display\)/);
  // No rule names a family directly any more.
  assert.doesNotMatch(css.split(":root {").slice(2).join(""), /font-family: "/);
});

test("a deck that configures no fonts is unchanged by the display role", async () => {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/kitchen-sink" });
  assert.ok(!html.includes("font-tokens"), "no token block, so no per-deck override");
  // The default h1 stack and the default body stack name the same family, so
  // adding the role cannot change a default deck's rendering.
  assert.match(html, /--zerp-font-display: "Montserrat", "Zerp Symbols", sans-serif;/);
});

test("token contrast json is emitted for the checker", async () => {
  const json = JSON.parse(await readFile("dist/check/token-contrast.json", "utf8"));
  assert.ok(json.dark.lc["--zerp-bg"]["--zerp-muted"] < -60);
  assert.equal(json.light.bg["--zerp-surface"], "#fafbfe");
});

test("frame and stage geometry read the stage tokens", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  assert.match(css, /--zerp-stage-w: 1920px/);
  assert.match(css, /--zerp-stage-h: 1080px/);
  assert.match(css, /\[data-zerp-stage\] \{[^}]*container-type: size/);
  assert.match(css, /\[data-zerp-slide\] \{[^}]*width: var\(--zerp-stage-w\)/);
  const screenPart = css.slice(0, css.indexOf("@media print"));
  assert.ok(!/[0-9]+v[hw]/.test(screenPart), "no viewport units outside @media print");
});

test("print block restores viewport-relative pagination and kills the transform", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  const printBlock = css.slice(css.indexOf("@media print"));
  assert.match(printBlock, /\[data-zerp-stage\] \{[^}]*transform: none/);
  assert.match(printBlock, /\[data-zerp-slide\] \{[^}]*height: 100vh/);
});
