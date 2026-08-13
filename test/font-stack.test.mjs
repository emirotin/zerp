import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFontStack, StackResolver } from "../dist/check/font-stack.js";

const cp = (character) => character.codePointAt(0);

test("a stack is its named families, in order, up to the first generic", () => {
  assert.deepEqual(parseFontStack('"Bebas Neue", "Zerp Symbols", sans-serif'), [
    "Bebas Neue",
    "Zerp Symbols",
  ]);
  assert.deepEqual(parseFontStack("Inter, monospace, Ignored"), ["Inter"]);
  assert.deepEqual(parseFontStack("  'Roboto Mono'  "), ["Roboto Mono"]);
  assert.deepEqual(parseFontStack("sans-serif"), []);
});

const faces = [
  { family: "Alpha", subset: "latin", file: "alpha.woff2", ranges: [{ first: 0x41, last: 0x5a }] },
  { family: "Beta", subset: "greek", file: "beta.woff2", ranges: [{ first: 0x391, last: 0x3c9 }] },
];
const cmaps = new Map([
  ["alpha.woff2", new Set([cp("A"), cp("B")])],
  ["beta.woff2", new Set([cp("Δ")])],
]);

test("a character resolves against the first family that can draw it", () => {
  const resolver = new StackResolver(faces, cmaps);
  assert.ok(resolver.resolves(["Alpha"], cp("A")));
  assert.ok(!resolver.resolves(["Alpha"], cp("Δ")), "Alpha has no greek");
  assert.ok(resolver.resolves(["Alpha", "Beta"], cp("Δ")), "Beta later in the stack does");
  assert.ok(!resolver.resolves([], cp("A")), "an exhausted stack resolves nothing");
});

test("family matching ignores case, as font-family does", () => {
  const resolver = new StackResolver(faces, cmaps);
  assert.ok(resolver.resolves(["alpha"], cp("A")));
});

test("a family with no bundled face is unknown rather than empty", () => {
  const resolver = new StackResolver(faces, cmaps);
  assert.ok(resolver.knows("Alpha"));
  assert.ok(resolver.knows("beta"), "case-insensitive, as font-family is");
  assert.ok(!resolver.knows("Georgia"));
  assert.ok(!resolver.knows("unresolved"), "the cascade's stand-in for an unknown var()");
});

test("a codepoint outside the declared range does not resolve, cmap or not", () => {
  // 'B' is in Alpha's cmap and inside its range; 0x2192 is in neither. A face
  // whose file carries a glyph the @font-face range excludes is never consulted
  // for it by the browser, so it must not count here either.
  const clipped = [{ ...faces[0], ranges: [{ first: 0x41, last: 0x41 }] }];
  const resolver = new StackResolver(clipped, cmaps);
  assert.ok(resolver.resolves(["Alpha"], cp("A")));
  assert.ok(!resolver.resolves(["Alpha"], cp("B")), "in the file, outside the range");
});

test("a codepoint inside the declared range still does not resolve without a cmap entry", () => {
  // 'C' falls inside Alpha's declared A-Z range but was never subset into the
  // file, so it is absent from the cmap. unicode-range routinely claims more
  // than the file holds, so the range alone must not be enough.
  const resolver = new StackResolver(faces, cmaps);
  assert.ok(!resolver.resolves(["Alpha"], cp("C")), "in the range, missing from the cmap");
});
