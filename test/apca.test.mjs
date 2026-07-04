import assert from "node:assert/strict";
import { test } from "node:test";

import { contrastLc, neededLc, requiredPx } from "../dist/check/apca.js";

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

test("Lc matches apca-w3 reference values", () => {
  assert.ok(Math.abs(contrastLc(WHITE, BLACK) - -107.88) < 0.1);
  assert.ok(Math.abs(contrastLc(BLACK, WHITE) - 106.04) < 0.1);
});

test("required px from the APCA font lookup table", () => {
  assert.equal(requiredPx(75, 400), 18);
  assert.equal(requiredPx(-75, 400), 18);
  assert.equal(requiredPx(75, 700), 14);
  assert.equal(requiredPx(65, 400), 21.75);
  assert.equal(requiredPx(15, 400), null);
});

test("neededLc finds the minimum passing contrast for a size", () => {
  const lc = neededLc(18, 400);
  assert.ok(lc !== null && lc <= 75 && requiredPx(lc, 400) <= 18);
  assert.equal(neededLc(4, 100), null);
});
