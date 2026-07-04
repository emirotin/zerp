import assert from "node:assert/strict";
import { test } from "node:test";

import { blend, parseColor, toHex } from "../dist/check/color.js";

test("parses hex forms", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#12141c"), { r: 18, g: 20, b: 28, a: 1 });
  assert.equal(parseColor("#12141c80").a.toFixed(2), "0.50");
  assert.equal(parseColor("#12"), null);
});

test("parses rgb()/rgba() and named colors", () => {
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3, a: 1 });
  assert.equal(parseColor("rgba(0, 0, 0, 0.4)").a, 0.4);
  assert.deepEqual(parseColor("rgb(0 0 0 / 50%)").a, 0.5);
  assert.deepEqual(parseColor("white"), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(parseColor("oklch(0.5 0.1 20)"), null);
});

test("alpha blending and hex round-trip", () => {
  const half = { r: 255, g: 255, b: 255, a: 0.5 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  assert.deepEqual(blend(half, black), { r: 128, g: 128, b: 128, a: 1 });
  assert.equal(toHex(black), "#000000");
});
