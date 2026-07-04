import assert from "node:assert/strict";
import { test } from "node:test";

import { parseStylesheets } from "../dist/check/css-model.js";

const framework = `
:root[data-zerp-theme="dark"] { color-scheme: dark; --zerp-bg: #12141c; --zerp-text: #f0f3ff; }
:root[data-zerp-theme="light"] { color-scheme: light; --zerp-bg: #f0f3ff; --zerp-text: #2c2e37; }
@media (prefers-color-scheme: dark) { :root:not([data-zerp-theme]) { --zerp-bg: #000000; } }
.slide p, .slide li { font-size: 1.25em; }
.nav button:hover { color: red; }
`;

const deck = `
:root { --brand: #ff0000; }
.hero { color: var(--brand); }
.door:hover { border-color: red; }
`;

test("theme blocks feed var maps and are excluded from rules", () => {
  const model = parseStylesheets([
    { css: framework, origin: "framework" },
    { css: deck, origin: "deck" },
  ]);
  assert.equal(model.themeVars.dark.get("--zerp-bg"), "#12141c");
  assert.equal(model.themeVars.light.get("--zerp-bg"), "#f0f3ff");
  assert.equal(model.themeVars.dark.get("--brand"), "#ff0000");
  assert.equal(model.themeVars.light.get("--brand"), "#ff0000");
  assert.ok(!model.rules.some((r) => r.selector.includes("data-zerp-theme")));
  assert.ok(!model.rules.some((r) => r.selector.includes(":not")), "media content skipped");
});

test("comma selectors split; specificity computed; unsupported deck selectors reported", () => {
  const model = parseStylesheets([
    { css: framework, origin: "framework" },
    { css: deck, origin: "deck" },
  ]);
  const p = model.rules.find((r) => r.selector === ".slide p");
  const li = model.rules.find((r) => r.selector === ".slide li");
  assert.ok(p && li);
  assert.deepEqual([...p.specificity], [0, 1, 1]);
  assert.equal(p.declarations.get("font-size"), "1.25em");
  assert.deepEqual(model.skippedSelectors, [".door:hover"]);
});
