import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";

import { cmapCodepoints, woff2Codepoints } from "../dist/woff2.js";

const require = createRequire(import.meta.url);

const fontsourceFile = (pkg, file) =>
  path.join(path.dirname(require.resolve(`${pkg}/400.css`)), "files", file);

const codepointsOf = async (file) => woff2Codepoints(await readFile(file));
const cp = (character) => character.codePointAt(0);

test("the bundled symbol face carries exactly one glyph", async () => {
  const covered = await codepointsOf("src/assets/fonts/zerp-symbols.woff2");
  // 812 bytes, one glyph: the whole claim the arrow face rests on.
  assert.deepEqual([...covered], [cp("→")]);
});

test("Montserrat's latin subset has ↑ and ↓ but no →", async () => {
  const covered = await codepointsOf(
    fontsourceFile("@fontsource/montserrat", "montserrat-latin-400-normal.woff2"),
  );
  assert.ok(covered.has(cp("A")));
  assert.ok(covered.has(cp("↑")) && covered.has(cp("↓")), "the arrows it does carry");
  assert.ok(!covered.has(cp("→")), "the one it does not — hence the symbol face");
  assert.ok(!covered.has(cp("Ж")), "cyrillic lives in its own subset");
});

test("Roboto Mono's latin subset carries no arrows at all", async () => {
  const covered = await codepointsOf(
    fontsourceFile("@fontsource/roboto-mono", "roboto-mono-latin-400-normal.woff2"),
  );
  assert.ok(covered.has(cp("0")) && covered.has(cp("/")));
  for (const arrow of ["→", "↑", "↓"]) {
    assert.ok(!covered.has(cp(arrow)), `no ${arrow}`);
  }
});

test("a subset's cmap and its unicode-range are different facts", async () => {
  const covered = await codepointsOf(
    fontsourceFile("@fontsource/montserrat", "montserrat-cyrillic-400-normal.woff2"),
  );
  assert.ok(covered.has(cp("Ж")));
  // Its declared range is U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116 —
  // yet the file also maps a few latin glyphs. Coverage has to be read as the
  // cmap intersected with the range the @font-face declares, because the
  // browser never consults the face outside that range.
  assert.ok(covered.has(cp("A")), "mapped in the file, outside the declared range");
});

// Format 4 is what every Google Fonts woff2 uses, but its glyph-array branch
// (idRangeOffset ≠ 0) only fires on fonts that need it, so it is exercised
// here directly, together with format 12, which CJK families ship.
const u16 = (value) => {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16BE(value);
  return buffer;
};
const u32 = (value) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
};
const cmapOf = (subtable) => Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), subtable]);

test("format 4 resolves glyphs through the glyph array and skips notdef", () => {
  const subtable = Buffer.concat([
    u16(4),
    u16(38),
    u16(0),
    u16(4),
    u16(0),
    u16(0),
    u16(0),
    u16(0x43),
    u16(0xffff), // endCode
    u16(0), // reservedPad
    u16(0x41),
    u16(0xffff), // startCode
    u16(0),
    u16(1), // idDelta
    u16(4),
    u16(0), // idRangeOffset: the first segment points at the array
    u16(5),
    u16(0),
    u16(7), // glyphIdArray: A → 5, B → notdef, C → 7
  ]);
  const covered = cmapCodepoints(cmapOf(subtable));
  assert.deepEqual(
    [...covered].sort((a, b) => a - b),
    [cp("A"), cp("C")],
  );
});

test("format 12 covers supplementary-plane groups", () => {
  const subtable = Buffer.concat([
    u16(12),
    u16(0),
    u32(40),
    u32(0),
    u32(2),
    u32(0x4e00),
    u32(0x4e01),
    u32(9), // two CJK ideographs
    u32(0x1f600),
    u32(0x1f600),
    u32(11), // one astral codepoint
  ]);
  const covered = cmapCodepoints(cmapOf(subtable));
  assert.deepEqual(
    [...covered].sort((a, b) => a - b),
    [0x4e00, 0x4e01, 0x1f600],
  );
});

test("a file that is not woff2 is rejected, not misread", async () => {
  const notAFont = await readFile("package.json");
  assert.throws(() => woff2Codepoints(notAFont), /not a woff2 file/);
});
