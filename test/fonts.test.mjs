import assert from "node:assert/strict";
import { test } from "node:test";

import { fontCss, parseUnicodeRange, selectedFaces } from "../dist/fonts.js";

const setOf = (text) => new Set([...text].map((character) => character.codePointAt(0)));
// A deck with no zerp.fonts config: zerps own families, selection only.
const deck = "test/fixtures/clean-deck";
const subsetsFor = async (text) =>
  (await selectedFaces(deck, setOf(text))).map((face) => `${face.family}/${face.subset}`);

test("unicode-range parses single codepoints, ranges and wildcards", () => {
  assert.deepEqual(parseUnicodeRange("U+2192"), [{ first: 0x2192, last: 0x2192 }]);
  assert.deepEqual(parseUnicodeRange("U+0000-00FF"), [{ first: 0, last: 0xff }]);
  assert.deepEqual(parseUnicodeRange("U+04??"), [{ first: 0x400, last: 0x4ff }]);
  assert.deepEqual(parseUnicodeRange("U+0131,U+0152-0153"), [
    { first: 0x131, last: 0x131 },
    { first: 0x152, last: 0x153 },
  ]);
  // Unparseable tokens are dropped, not guessed at.
  assert.deepEqual(parseUnicodeRange("sometimes, U+41"), [{ first: 0x41, last: 0x41 }]);
});

test("a latin deck carries latin and the symbol face, and nothing else", async () => {
  const selected = await subsetsFor("Plain English copy.");
  assert.deepEqual(selected, [
    "Montserrat/latin",
    "Montserrat/latin",
    "Montserrat/latin",
    "Montserrat/latin",
    "Montserrat/latin",
    "Roboto Mono/latin",
    "Roboto Mono/latin",
    "Zerp Symbols/symbols",
  ]);
});

test("latin is the floor even for a deck with no text at all", async () => {
  const selected = await subsetsFor("");
  assert.ok(selected.every((face) => face.endsWith("/latin") || face.endsWith("/symbols")));
  assert.ok(selected.length > 1, "the latin faces are still there");
});

test("a subset is carried exactly when the deck renders something it claims", async () => {
  // U+0416 is cyrillic; U+0141 (Ł) is latin-ext; U+2116 (№) is in the cyrillic
  // range too, which is why a deck can pull cyrillic without a cyrillic letter.
  assert.ok((await subsetsFor("Ж")).includes("Montserrat/cyrillic"));
  assert.ok((await subsetsFor("Ł")).includes("Montserrat/latin-ext"));
  assert.ok((await subsetsFor("№")).includes("Montserrat/cyrillic"));
  assert.ok(!(await subsetsFor("Ж")).includes("Montserrat/latin-ext"));
  // Subsets zerp's old allowlist never shipped are reachable now that the
  // deck's own text decides: fontsource offers them, so a deck that needs
  // them gets them.
  assert.ok((await subsetsFor("Tiếng Việt")).includes("Montserrat/vietnamese"));
  assert.ok((await subsetsFor("Ελληνικά")).includes("Roboto Mono/greek"));
});

test("the emitted css is self-contained and matches the selection", async () => {
  const { faces: css } = await fontCss(deck, setOf("Ж"));
  assert.equal(css.match(/@font-face/g).length, (await subsetsFor("Ж")).length);
  assert.match(css, /src: url\(data:font\/woff2;base64,[A-Za-z0-9+/=]+\) format\("woff2"\);/);
  assert.doesNotMatch(css, /url\(\.\/files\//, "no path survives inlining");
  assert.ok(css.includes("/* montserrat-cyrillic-400-normal */"));
});
