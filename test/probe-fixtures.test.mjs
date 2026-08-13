import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

export function loadProbe(name) {
  return JSON.parse(readFileSync(`test/fixtures/probes/${name}.json`, "utf8"));
}

test("recorded probes carry resolved values, not CSS source text", () => {
  const probe = loadProbe("kitchen-sink-dark");
  assert.ok(probe.slides.length > 0);
  const all = probe.slides.flatMap((s) => s.elements);
  assert.ok(all.length > 0);
  assert.ok(
    all.every((el) => /^rgba?\(/.test(el.color)),
    "every color is computed",
  );
  assert.ok(all.every((el) => typeof el.fontSizePx === "number" && el.fontSizePx > 0));
  assert.ok(!JSON.stringify(probe).includes("var(--"), "no unresolved custom properties survive");
});
