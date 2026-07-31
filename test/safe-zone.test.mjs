import assert from "node:assert/strict";
import { test } from "node:test";

import { safeZoneFailureMessage } from "../dist/verify.js";

const VIEWPORT = { width: 1280, height: 720 };

function item(overrides) {
  return {
    label: "hero",
    left: 100,
    top: 100,
    right: 1180,
    bottom: 620,
    width: 1080,
    height: 520,
    ...overrides,
  };
}

test("an element clear of every edge produces no failure", () => {
  const message = safeZoneFailureMessage(item(), VIEWPORT.width, VIEWPORT.height, 24);
  assert.equal(message, null);
});

test("a distance exactly at the margin passes — the margin is a floor", () => {
  const atMargin = item({ left: 24, top: 24, right: 1280 - 24, bottom: 720 - 24 });
  const message = safeZoneFailureMessage(atMargin, VIEWPORT.width, VIEWPORT.height, 24);
  assert.equal(message, null);
});

test("every intruded edge is named with its rounded distance", () => {
  const intruding = item({ left: 3.4, top: 10, right: 1280 - 23.6, bottom: 620 });
  const message = safeZoneFailureMessage(intruding, VIEWPORT.width, VIEWPORT.height, 24);
  assert.equal(
    message,
    "hero enters the 24px print safe margin: left (3px), top (10px), right (24px)",
  );
});

test("an element hanging off the page reports a 0px distance, not a negative one", () => {
  const offPage = item({ left: -50 });
  const message = safeZoneFailureMessage(offPage, VIEWPORT.width, VIEWPORT.height, 24);
  assert.equal(message, "hero enters the 24px print safe margin: left (0px)");
});
