import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { resolveBrowserExecutable } from "../dist/verify.js";

const ENV_VAR = "CHROME_BIN";

/** Run `body` with the env var `name` set to `value` (undefined unsets it). */
function withEnv(name, value, body) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return body();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

/**
 * A fresh temp dir holding one executable `name` whose `--version` prints
 * `banner`. Callers own cleanup of the returned dir.
 */
function writeFakeBrowser(name, banner) {
  const dir = mkdtempSync(join(tmpdir(), "zerp-browser-resolver-"));
  const bin = join(dir, name);
  writeFileSync(bin, `#!/bin/sh\necho "${banner}"\n`);
  chmodSync(bin, 0o755);
  return { dir, bin };
}

/**
 * Resolve in a child process whose PATH is exactly `fixtureDir`, with the
 * managed-chromium step pointed at a location that holds no browser. The
 * in-process tests below cover the CHROME_BIN branch, which returns before
 * the managed step; the system fallback can only be reached hermetically
 * this way, and `candidates` is injected so a real Chrome installed on the
 * developer machine cannot preempt the fixture.
 */
function resolveInChildProcess(fixtureDir, candidates) {
  const script = `
import { resolveBrowserExecutable } from ${JSON.stringify(new URL("../dist/verify.js", import.meta.url).href)};
try {
  process.stdout.write(JSON.stringify({ resolved: resolveBrowserExecutable(${JSON.stringify(candidates)}) }));
} catch (error) {
  process.stdout.write(JSON.stringify({ failed: error.message }));
}
`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      PATH: fixtureDir,
      HOME: fixtureDir,
      PLAYWRIGHT_BROWSERS_PATH: join(fixtureDir, "no-managed-browser"),
    },
  });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
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
  withEnv(ENV_VAR, badPath, () => {
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

// An executable can exist and exit 0 from `--version` without being a browser:
// Ubuntu's apt `chromium` is a shell stub that defers to snapd and prints
// unrelated noise. Exit status alone is not evidence — the version banner is
// what every real Chromium-class binary answers with — so a bannerless
// CHROME_BIN must be rejected here, not handed to a launch it cannot survive.
test("a CHROME_BIN that runs but prints no version banner is rejected, naming the path and the remedy", () => {
  const { dir, bin } = writeFakeBrowser("not-a-browser", "xdg-settings: not found");
  try {
    withEnv(ENV_VAR, bin, () => {
      assert.throws(
        () => resolveBrowserExecutable(),
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /CHROME_BIN/);
          assert.ok(error.message.includes(bin));
          assert.match(error.message, /zerp install-browser/);
          return true;
        },
      );
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// playwright's launch({ executablePath }) does no PATH lookup — it checks the
// literal string against the filesystem — so a bare command name that probes
// fine via spawnSync still fails to launch. Whatever the resolver returns must
// be the absolute path the probe actually exercised.
test("a CHROME_BIN naming a bare command resolves to the absolute path on PATH", () => {
  const { dir, bin } = writeFakeBrowser("zerp-fake-chrome", "Chromium 151.0.7922.34");
  try {
    withEnv("PATH", `${dir}${delimiter}${process.env.PATH}`, () => {
      withEnv(ENV_VAR, "zerp-fake-chrome", () => {
        assert.equal(resolveBrowserExecutable(), bin);
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The same PATH-vs-literal mismatch, on the system-fallback candidates
// (`google-chrome`, `chromium`, `chromium-browser`): the probe found a working
// browser through PATH, then the bare name was returned and the launch failed
// three layers away with "executable doesn't exist at chromium" — about the
// very browser the probe had just run.
test("a bare-name system candidate resolves to the absolute path the probe ran", () => {
  const { dir, bin } = writeFakeBrowser("chromium", "Chromium 151.0.7922.34");
  try {
    const result = resolveInChildProcess(dir, ["chromium"]);
    assert.equal(result.resolved, bin);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The snap-stub scenario at the fallback: a non-browser squatting on a
// candidate name, exiting 0 without a banner, must be skipped so resolution
// falls through to the real "nothing found" error and its remedy.
test("a system candidate that answers --version without a version banner is skipped", () => {
  const { dir } = writeFakeBrowser("chromium", "xdg-settings: not found");
  try {
    const result = resolveInChildProcess(dir, ["chromium"]);
    assert.equal(result.resolved, undefined);
    assert.match(result.failed, /No Chrome\/Chromium found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
