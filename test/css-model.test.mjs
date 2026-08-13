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

test("a ::before rule is kept, keyed to the element it originates from", () => {
  const model = parseStylesheets([
    {
      css: '.slide ul li::before { content: "→ "; font-family: var(--zerp-font-marker); }',
      origin: "framework",
    },
  ]);
  const rule = model.rules.find((candidate) => candidate.pseudoElement === "::before");
  assert.ok(rule, "the rule survives parsing");
  assert.equal(rule.selector, ".slide ul li", "matchable against a real element");
  assert.equal(rule.declarations.get("content"), '"→ "');
});

test("a pseudo-element rule does not style the originating element", () => {
  const model = parseStylesheets([
    { css: "p::before { color: red; } p { color: blue; }", origin: "framework" },
  ]);
  const own = model.rules.filter((rule) => rule.selector === "p" && rule.pseudoElement === null);
  assert.equal(own.length, 1);
  assert.equal(own[0].declarations.get("color"), "blue");
});

test("an unsupported selector is still skipped", () => {
  const model = parseStylesheets([{ css: "a:hover + b { color: red; }", origin: "deck" }]);
  // css-tree's generator drops whitespace around combinators; the model
  // records whatever it produces, so assert against that serialization
  // rather than the original source text.
  assert.deepEqual(model.skippedSelectors, ["a:hover+b"]);
});
