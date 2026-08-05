import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { test } from "node:test";

import { chromium } from "playwright-core";

import { resolveBrowserEndpoint } from "../dist/verify.js";

const ENV_VAR = "ZERP_BROWSER_ENDPOINT";
const browserTestsEnabled = process.env.ZERP_RUN_BROWSER_TEST === "1";

/** Run `body` with ZERP_BROWSER_ENDPOINT set to `value` (undefined unsets it). */
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

test("no endpoint configured means launch a browser", () => {
  withEnv(undefined, () => {
    assert.equal(resolveBrowserEndpoint(), undefined);
    assert.equal(resolveBrowserEndpoint(""), undefined);
  });
});

test("the environment supplies an endpoint and an explicit one wins", () => {
  withEnv("http://127.0.0.1:9222", () => {
    assert.equal(resolveBrowserEndpoint(), "http://127.0.0.1:9222");
    assert.equal(resolveBrowserEndpoint("ws://127.0.0.1:1234/abc"), "ws://127.0.0.1:1234/abc");
  });
});

// A host that configured reuse and silently got a per-run launch would carry
// the cost it was trying to avoid, with nothing to show it.
test("an endpoint naming no transport is rejected rather than ignored", () => {
  withEnv("127.0.0.1:9222", () => {
    assert.throws(() => resolveBrowserEndpoint(), /Invalid browser endpoint/);
  });
  assert.throws(() => resolveBrowserEndpoint("/tmp/chrome.sock"), /Invalid browser endpoint/);
});

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function canFindChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
    "chromium-browser",
  ].filter(Boolean);
  return candidates.some((candidate) => {
    if (candidate.includes("/") && !existsSync(candidate)) {
      return false;
    }
    return spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0;
  });
}

/**
 * Deliberately async, unlike the other CLI tests' `spawnSync`.
 *
 * The host browser below is launched from THIS process, so playwright's pipe
 * transport to it is serviced by this event loop. `spawnSync` blocks that loop
 * for the child's whole lifetime; the browser then fills its unread pipe,
 * stalls, and the child times out against a frozen browser. Any host keeping a
 * browser warm for other processes has the same obligation — stay responsive.
 */
function runVerify(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "dist/cli.js",
        "verify",
        "test/fixtures/wrapper-deck",
        "--theme",
        "dark",
        "--size",
        "1280x720",
        "--json",
        ...args,
      ],
      { env: { ...process.env, ...env } },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

// The point of the feature: a host keeps one browser warm and pays no launch
// per check. This exercises the real CDP transport — the interoperable one,
// since the host's playwright build and zerp's need not match — and pins the
// two properties that make reuse safe: the borrowed browser outlives the run,
// and each run takes its context back with it.
test(
  "zerp verify reuses a browser over CDP without closing or leaking into it",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
    const port = await freePort();
    const host = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${port}`],
    });
    const endpoint = `http://127.0.0.1:${port}`;
    try {
      const inspector = await chromium.connectOverCDP(endpoint);
      const baselineContexts = inspector.contexts().length;
      await inspector.close();

      const first = await runVerify(["--browser-endpoint", endpoint]);
      assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
      const [firstReport] = JSON.parse(first.stdout);
      assert.equal(firstReport.fontsActive, true);
      assert.deepEqual(firstReport.failures, []);
      assert.equal(firstReport.slides[0]?.viewportWidth, 1280);

      // Still alive after the first run: a borrowed browser is disconnected
      // from, never terminated — otherwise the second run has nothing to reuse.
      assert.equal(host.isConnected(), true);

      // The env var is the path a spawning host actually uses.
      const second = await runVerify([], { [ENV_VAR]: endpoint });
      assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
      const [secondReport] = JSON.parse(second.stdout);
      assert.deepEqual(secondReport.failures, []);
      assert.equal(host.isConnected(), true);

      // Contexts are the thing that accumulates when a client walks away from a
      // browser it does not own, so two runs must leave the count where it was.
      const after = await chromium.connectOverCDP(endpoint);
      assert.equal(
        after.contexts().length,
        baselineContexts,
        "verification contexts were left behind in the borrowed browser",
      );
      await after.close();
    } finally {
      await host.close();
    }
  },
);

test(
  "zerp verify needs no local browser when one is supplied",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
    const port = await freePort();
    const host = await chromium.launch({
      headless: true,
      args: [`--remote-debugging-port=${port}`],
    });
    try {
      // CHROME_BIN points at a path that does not exist: resolution must not run
      // at all when the browser arrives over the endpoint.
      const result = await runVerify(["--browser-endpoint", `http://127.0.0.1:${port}`], {
        CHROME_BIN: "/nonexistent/chrome",
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const [report] = JSON.parse(result.stdout);
      assert.deepEqual(report.failures, []);
    } finally {
      await host.close();
    }
  },
);

// The other documented transport. Version-locked between client and server, so
// it fits a host that spawns this CLI from the same playwright build — which is
// exactly what this test is.
test(
  "zerp verify reuses a playwright browser server over ws://",
  { skip: !browserTestsEnabled || !canFindChrome() },
  async () => {
    const server = await chromium.launchServer({ headless: true });
    try {
      const result = await runVerify(["--browser-endpoint", server.wsEndpoint()]);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      const [report] = JSON.parse(result.stdout);
      assert.equal(report.fontsActive, true);
      assert.deepEqual(report.failures, []);

      // The server is still serving: a second run reuses it.
      const again = await runVerify(["--browser-endpoint", server.wsEndpoint()]);
      assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
    } finally {
      await server.close();
    }
  },
);

test(
  "an unreachable endpoint fails the run instead of quietly launching a browser",
  { skip: !browserTestsEnabled },
  async () => {
    const port = await freePort();
    const result = await runVerify([
      "--browser-endpoint",
      `http://127.0.0.1:${port}`,
      "--timeout",
      "5000",
    ]);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout, "");
  },
);
