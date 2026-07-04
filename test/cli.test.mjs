import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" });
}

test("zerp check fails on the broken deck with a grouped report", () => {
  const result = runCli(["check", "test/fixtures/broken-deck"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /slide 1 \(slides\/00-bad\.html\) \[dark\]/);
  assert.match(result.stdout, /✗/);
});

test("zerp check passes on the clean deck", () => {
  const result = runCli(["check", "test/fixtures/clean-deck"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /all clear/);
});

test("zerp build prints wrote-path and check summary", () => {
  const result = runCli(["build", "test/fixtures/clean-deck", "--theme", "dark"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote .*index\.html/);
  assert.match(result.stdout, /zerp check — 1 slides/);
});

test("invalid theme is rejected", () => {
  const result = runCli(["build", "test/fixtures/clean-deck", "--theme", "sepia"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid theme/);
});
