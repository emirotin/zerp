import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";

import { StyleResolver } from "../dist/check/cascade.js";
import { parseColor, toHex } from "../dist/check/color.js";
import { parseStylesheets } from "../dist/check/css-model.js";

const css = `
:root[data-zerp-theme="dark"] { --zerp-bg: #12141c; --zerp-text: #f0f3ff; --zerp-muted: #cbceda; }
:root[data-zerp-theme="light"] { --zerp-bg: #f0f3ff; --zerp-text: #2c2e37; --zerp-muted: #676973; }
body { background: var(--zerp-bg); color: var(--zerp-text); }
b { font-weight: 700; }
.slide p { font-size: 1.25em; }
.muted { color: var(--zerp-muted); }
.card { background: #222222; }
`;

const html = `<html><body><div class="slide">
<p>base <span class="muted" style="font-size: 0.8em">note</span><b>bold</b></p>
<div class="card"><p id="inCard">on card</p></div>
<div style="background: rgba(255, 255, 255, 0.5)"><p id="onHalf">x</p></div>
</div></body></html>`;

function setup(theme) {
  const model = parseStylesheets([{ css, origin: "framework" }]);
  const { document } = parseHTML(html);
  return { resolver: new StyleResolver(model, model.themeVars[theme]), document };
}

test("font-size em chain, inline override, and weight", () => {
  const { resolver, document } = setup("dark");
  const span = document.querySelector("span");
  const p = document.querySelector("p");
  const b = document.querySelector("b");
  assert.equal(resolver.computedFor(p).fontSizePx, 20);
  assert.equal(resolver.computedFor(span).fontSizePx, 16);
  assert.equal(resolver.computedFor(b).fontWeight, 700);
});

test("color vars resolve per theme", () => {
  const dark = setup("dark");
  const light = setup("light");
  const pick = ({ resolver, document }) =>
    resolver.resolveVars(resolver.computedFor(document.querySelector("span")).color);
  assert.equal(pick(dark), "#cbceda");
  assert.equal(pick(light), "#676973");
});

test("background walks ancestors and composites alpha", () => {
  const { resolver, document } = setup("dark");
  const onCard = resolver.backgroundFor(document.querySelector("#inCard"));
  assert.equal(onCard.kind, "color");
  assert.equal(toHex(onCard.color), "#222222");
  const base = resolver.backgroundFor(document.querySelector("span"));
  assert.equal(toHex(base.color), "#12141c");
  const half = resolver.backgroundFor(document.querySelector("#onHalf"));
  assert.equal(toHex(half.color), "#898a8e");
  assert.ok(parseColor("#898a8e"));
});

test("background images are unverifiable", () => {
  const model = parseStylesheets([{ css, origin: "framework" }]);
  const { document } = parseHTML(
    '<html><body><div style="background-image: url(x.png)"><p id="t">x</p></div></body></html>',
  );
  const resolver = new StyleResolver(model, model.themeVars.dark);
  assert.equal(resolver.backgroundFor(document.querySelector("#t")).kind, "unverifiable");
});

test("later background shorthand resets earlier background-color longhand", () => {
  const orderedCss = `${css}
.a { background-color: #0000ff; }
.b { background: #ff0000; }
`;
  const model = parseStylesheets([{ css: orderedCss, origin: "framework" }]);
  const { document } = parseHTML('<html><body><div class="a b" id="el">x</div></body></html>');
  const resolver = new StyleResolver(model, model.themeVars.dark);
  const result = resolver.backgroundFor(document.querySelector("#el"));
  assert.equal(result.kind, "color");
  assert.equal(toHex(result.color), "#ff0000");
});

test(":where() soft defaults lose to utility classes", () => {
  const orderedCss = `
.slide :where(h3) { color: #111111; }
.slide :where(p) { font-size: 1.25em; }
.xl { font-size: 1.6em; }
.accent { color: #58a6ff; }
`;
  const model = parseStylesheets([{ css: orderedCss, origin: "framework" }]);
  const { document } = parseHTML(
    '<html><body><div class="slide"><h3 class="accent" id="h">t</h3><p class="xl" id="p">x</p><p id="plain">y</p></div></body></html>',
  );
  const resolver = new StyleResolver(model, model.themeVars.dark);
  assert.equal(
    resolver.resolveVars(resolver.computedFor(document.querySelector("#h")).color),
    "#58a6ff",
  );
  assert.equal(resolver.computedFor(document.querySelector("#p")).fontSizePx, 25.6);
  assert.equal(resolver.computedFor(document.querySelector("#plain")).fontSizePx, 20);
});

test("later background-color longhand overrides earlier background shorthand", () => {
  const orderedCss = `${css}
.a { background: #ff0000; }
.b { background-color: #0000ff; }
`;
  const model = parseStylesheets([{ css: orderedCss, origin: "framework" }]);
  const { document } = parseHTML('<html><body><div class="a b" id="el">x</div></body></html>');
  const resolver = new StyleResolver(model, model.themeVars.dark);
  const result = resolver.backgroundFor(document.querySelector("#el"));
  assert.equal(result.kind, "color");
  assert.equal(toHex(result.color), "#0000ff");
});
