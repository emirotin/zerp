import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Self-referencing the package by name exercises the `exports` map exactly the
// way an installed consumer's resolver does.
const require = createRequire(import.meta.url);

test("the main entry resolves and loads from CommonJS", () => {
  const resolved = require.resolve("@emirotin/zerp");
  assert.match(resolved, /dist[/\\]index\.js$/);

  const api = require("@emirotin/zerp");
  assert.equal(typeof api.buildPresentationHtml, "function");
});

test("package metadata paths are exported for path consumers", () => {
  const packageJson = require.resolve("@emirotin/zerp/package.json");
  assert.match(packageJson, /package\.json$/);
  assert.equal(require(packageJson).name, "@emirotin/zerp");

  assert.match(require.resolve("@emirotin/zerp/llms.txt"), /llms\.txt$/);
  assert.match(require.resolve("@emirotin/zerp/dist/cli.js"), /dist[/\\]cli\.js$/);
});
