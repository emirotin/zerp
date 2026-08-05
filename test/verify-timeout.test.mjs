import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { DEFAULT_VERIFICATION_TIMEOUT_MS, resolveVerificationTimeoutMs } from "../dist/verify.js";

const ENV_VAR = "ZERP_VERIFY_TIMEOUT_MS";

/** Run `body` with ZERP_VERIFY_TIMEOUT_MS set to `value` (undefined unsets it). */
function withEnv(value, body) {
  const previous = process.env[ENV_VAR];
  if (value === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = value;
  }
  try {
    body();
  } finally {
    if (previous === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previous;
    }
  }
}

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" });
}

test("the session budget falls back to the default when nothing is configured", () => {
  withEnv(undefined, () => {
    assert.equal(resolveVerificationTimeoutMs(), DEFAULT_VERIFICATION_TIMEOUT_MS);
    assert.equal(DEFAULT_VERIFICATION_TIMEOUT_MS, 20_000);
  });
});

test("the environment overrides the default", () => {
  withEnv("90000", () => {
    assert.equal(resolveVerificationTimeoutMs(), 90_000);
  });
});

test("an explicit budget wins over the environment", () => {
  withEnv("90000", () => {
    assert.equal(resolveVerificationTimeoutMs(45_000), 45_000);
  });
});

test("an empty environment value is treated as unset", () => {
  withEnv("", () => {
    assert.equal(resolveVerificationTimeoutMs(), DEFAULT_VERIFICATION_TIMEOUT_MS);
  });
});

// A budget that is silently ignored is worse than no budget: the operator who
// set it believes verification has room it does not have.
test("a malformed environment value is rejected rather than ignored", () => {
  withEnv("soon", () => {
    assert.throws(() => resolveVerificationTimeoutMs(), /Invalid ZERP_VERIFY_TIMEOUT_MS/);
  });
  withEnv("0", () => {
    assert.throws(() => resolveVerificationTimeoutMs(), /Invalid ZERP_VERIFY_TIMEOUT_MS/);
  });
  withEnv("-5", () => {
    assert.throws(() => resolveVerificationTimeoutMs(), /Invalid ZERP_VERIFY_TIMEOUT_MS/);
  });
  withEnv("1.5", () => {
    assert.throws(() => resolveVerificationTimeoutMs(), /Invalid ZERP_VERIFY_TIMEOUT_MS/);
  });
});

test("an explicit non-positive budget is rejected", () => {
  assert.throws(() => resolveVerificationTimeoutMs(0), /Invalid timeout option/);
  assert.throws(() => resolveVerificationTimeoutMs(-1), /Invalid timeout option/);
});

test("zerp verify rejects a malformed --timeout before opening a browser", () => {
  const result = runCli(["verify", "test/fixtures/wrapper-deck", "--timeout", "soon"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid timeout: soon/);
});
