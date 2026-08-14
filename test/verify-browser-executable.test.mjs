import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveBrowserExecutable } from "../dist/verify.js";

const ENV_VAR = "CHROME_BIN";

/** Run `body` with CHROME_BIN set to `value` (undefined unsets it). */
function withEnv(value, body) {
  const previous = process.env[ENV_VAR];
  if (value === undefined) {
    delete process.env[ENV_VAR];
  } else {
    process.env[ENV_VAR] = value;
  }
  try {
    return body();
  } finally {
    if (previous === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = previous;
    }
  }
}

// CHROME_BIN used to be trusted verbatim, returned without checking it names
// anything real. A typo'd path then surfaced three layers away, as a raw
// Playwright launch failure ("Failed to launch chromium because executable
// doesn't exist at ...") instead of a clear error naming the actual
// misconfiguration right here. Deterministic and machine-independent — unlike
// the browser-launching tests elsewhere (gated behind ZERP_RUN_BROWSER_TEST),
// this needs no real browser to exist anywhere, so it runs under plain
// `pnpm test`.
test("a CHROME_BIN pointing at a path that does not exist is rejected, naming the path and the remedy", () => {
  const badPath = "/nonexistent/chrome-binary-zerp-test";
  withEnv(badPath, () => {
    assert.throws(
      () => resolveBrowserExecutable(),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /CHROME_BIN/);
        // Names the offending path, so a typo is visible rather than
        // guessable from a generic message.
        assert.match(error.message, /\/nonexistent\/chrome-binary-zerp-test/);
        // Names the remedy, same as the no-browser-found case.
        assert.match(error.message, /zerp install-browser/);
        return true;
      },
    );
  });
});
