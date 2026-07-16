import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("built default stylesheet = generated tokens + token-free base styles", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  assert.match(css, /--zerp-bg: #12141c;/);
  assert.match(css, /\.card \{/);
  assert.match(css, /\.stat-row \{/);
  assert.match(css, /\[hidden\] \{[^}]*display: none !important/);
  assert.match(css, /\[data-zerp-slide\] \{[^}]*display: none/);
  assert.match(css, /\[data-zerp-slide\]\[data-zerp-slide-active\] \{[^}]*display: flex/);
  assert.match(css, /\.slide \{[^}]*display: flex/);
  assert.doesNotMatch(css, /\.slide\.active\s*\{[^}]*display/);
  const afterTokens = css.split("/* base styles */")[1];
  assert.ok(afterTokens, "base styles marker present");
  assert.doesNotMatch(afterTokens, /#[0-9a-fA-F]{3,8}\b/, "no raw hex outside generated tokens");
  assert.doesNotMatch(css, /\.two-col|\.big-number|\.accent-green/, "0.1.x classes removed");
});

test("token contrast json is emitted for the checker", async () => {
  const json = JSON.parse(await readFile("dist/check/token-contrast.json", "utf8"));
  assert.ok(json.dark.lc["--zerp-bg"]["--zerp-muted"] < -60);
  assert.equal(json.light.bg["--zerp-surface"], "#fafbfe");
});
