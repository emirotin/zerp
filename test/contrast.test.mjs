import assert from "node:assert/strict";
import { test } from "node:test";

import { contrastRatio, neededRatio, requiredPx } from "../dist/check/contrast.js";

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 255, g: 255, b: 255, a: 1 };

test("contrast ratio matches WCAG 2.x reference pairs", () => {
  assert.equal(contrastRatio(WHITE, BLACK), 21);
  assert.equal(contrastRatio(BLACK, WHITE), 21);
  assert.ok(Math.abs(contrastRatio({ r: 119, g: 119, b: 119, a: 1 }, WHITE) - 4.478) < 0.01);
});

test("required px applies the WCAG large-text thresholds", () => {
  assert.equal(requiredPx(4.5, 400), 0);
  assert.equal(requiredPx(4.499, 400), 24);
  assert.equal(requiredPx(3, 400), 24);
  assert.ok(Math.abs(requiredPx(3, 700) - 18.6667) < 0.001);
  assert.equal(requiredPx(2.99, 700), null);
});

test("needed ratio depends on whether the text is large", () => {
  assert.equal(neededRatio(23.9, 400), 4.5);
  assert.equal(neededRatio(24, 400), 3);
  assert.equal(neededRatio(18.6, 700), 4.5);
  assert.equal(neededRatio(18.67, 700), 3);
});
