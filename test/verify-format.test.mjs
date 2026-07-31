import assert from "node:assert/strict";
import { test } from "node:test";

import { formatVerifyFailure } from "../dist/verify.js";

test("formatVerifyFailure renders a fully attributed failure", () => {
  const line = formatVerifyFailure({
    slide: 3,
    src: "slides/10-intro.html",
    message: "body height is 812px",
  });
  assert.equal(line, "slide 3 (slides/10-intro.html): body height is 812px");
});

test("formatVerifyFailure omits the source when zerp could not attribute it", () => {
  const line = formatVerifyFailure({ slide: 5, message: "expected one active frame, got 0" });
  assert.equal(line, "slide 5: expected one active frame, got 0");
});

test("formatVerifyFailure passes deck-level failures through untouched", () => {
  const line = formatVerifyFailure({ message: "deck has no slide frames" });
  assert.equal(line, "deck has no slide frames");
});
