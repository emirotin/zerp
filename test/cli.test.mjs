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

test("zerp check --json emits a machine-readable report with sourced errors", () => {
  const result = runCli(["check", "test/fixtures/broken-deck", "--json"]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.themes, ["dark", "light"]);
  const errors = report.findings.filter((f) => f.severity === "error");
  assert.ok(errors.length > 0, "broken deck reports errors");
  assert.ok(
    errors.every((f) => typeof f.slideSrc === "string"),
    "error findings carry their source file",
  );
  assert.equal(errors[0].slideSrc, "slides/00-bad.html");
});

test("zerp check --json on a clean deck has no error findings and exits 0", () => {
  const result = runCli(["check", "test/fixtures/clean-deck", "--json"]);
  assert.equal(result.status, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.findings.filter((f) => f.severity === "error").length, 0);
});

test("zerp check --theme dark scopes the report to one theme", () => {
  const result = runCli(["check", "test/fixtures/broken-deck", "--theme", "dark", "--json"]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.themes, ["dark"]);
  assert.ok(report.findings.length > 0, "broken deck still produces findings");
  assert.ok(
    report.findings.every((f) => f.theme === "dark"),
    "only dark findings when --theme dark",
  );
});

test("zerp check rejects an invalid theme", () => {
  const result = runCli(["check", "test/fixtures/broken-deck", "--theme", "sepia"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid check theme/);
});

test("zerp build prints wrote-path and check summary", () => {
  const result = runCli(["build", "test/fixtures/clean-deck", "--theme", "dark"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote .*index\.html/);
  assert.match(result.stdout, /zerp check — 1 slides/);
});

test("zerp slides prints the deck mapping", () => {
  const result = runCli(["slides", "test/fixtures/multi-deck"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /1\s+slides\/00-two\.html\s+1\/2\s+Alpha/);
  assert.match(result.stdout, /4\s+slides\/01-more\.md\s+2\/2\s+Delta/);
});

test("zerp slides --json emits the machine-readable mapping", () => {
  const result = runCli(["slides", "test/fixtures/multi-deck", "--json"]);
  assert.equal(result.status, 0);
  const slides = JSON.parse(result.stdout);
  assert.equal(slides.length, 4);
  assert.deepEqual(slides[1], {
    index: 2,
    file: "slides/00-two.html",
    slideInFile: 2,
    slidesInFile: 2,
    title: "Beta",
  });
});

test("invalid theme is rejected", () => {
  const result = runCli(["build", "test/fixtures/clean-deck", "--theme", "sepia"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid theme/);
});

test("invalid verify size is rejected before launching a browser", () => {
  const result = runCli(["verify", "test/fixtures/clean-deck", "--size", "wide"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid verification size/);
});
