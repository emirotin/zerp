import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";

/** One top-level element of the authored slide, measured against the viewport
 * for the print-safe-zone check. Viewport-relative CSS px. */
export interface SafeZoneItem {
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * The safe-zone verdict for one measured element: a message naming every page
 * edge the element gets closer to than `safeMargin`, or null when it stays
 * clear. A distance exactly at the margin passes — the margin is a floor.
 */
export function safeZoneFailureMessage(
  item: SafeZoneItem,
  viewportWidth: number,
  viewportHeight: number,
  safeMargin: number,
): string | null {
  const edges: [string, number][] = [
    ["left", item.left],
    ["top", item.top],
    ["right", viewportWidth - item.right],
    ["bottom", viewportHeight - item.bottom],
  ];
  const intrusions = edges
    .filter(([, distance]) => distance < safeMargin)
    .map(([edge, distance]) => `${edge} (${Math.round(Math.max(0, distance))}px)`);
  if (intrusions.length === 0) {
    return null;
  }
  return `${item.label} enters the ${safeMargin}px print safe margin: ${intrusions.join(", ")}`;
}

/** One check failure. Deck-level failures (browser errors, frame-count
 * mismatches) carry only `message`; per-slide failures name the 1-based deck
 * position and, when zerp could attribute it, the source file to edit. */
export interface VerifyFailure {
  slide?: number;
  src?: string;
  message: string;
}

/** The human line for a failure: `slide N (slides/foo.html): message`. */
export function formatVerifyFailure(failure: VerifyFailure): string {
  if (failure.slide === undefined) {
    return failure.message;
  }
  const label = failure.src ? `slide ${failure.slide} (${failure.src})` : `slide ${failure.slide}`;
  return `${label}: ${failure.message}`;
}

// System-Chrome fallbacks, tried after CHROME_BIN and playwright's own managed
// chromium. Each is validated by a `--version` spawn before use.
const SYSTEM_CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser",
];

/**
 * Budget for one browser session when the caller names none.
 *
 * It covers everything: launching a cold browser, navigating, waiting for the
 * inlined fonts to activate, and running the probe. Fine for a laptop with a
 * warm page cache, and deliberately overridable — the same work on a small,
 * loaded CI or container host, or on a deck carrying megabytes of imagery, can
 * take several times as long, and a session that runs out of budget yields no
 * report at all rather than a slow one.
 */
export const DEFAULT_VERIFICATION_TIMEOUT_MS = 20_000;

/** Env fallback for the timeout, for hosts that spawn the CLI. */
const TIMEOUT_ENV_VAR = "ZERP_VERIFY_TIMEOUT_MS";

/**
 * The session budget in ms: an explicit option, else the environment, else the
 * default.
 *
 * A malformed env value throws rather than falling back. Silently ignoring it
 * would leave the operator who set it believing verification has a budget it
 * does not have — the failure that raising the timeout was meant to prevent,
 * now invisible.
 */
export function resolveVerificationTimeoutMs(explicit?: number): number {
  if (explicit !== undefined) {
    return assertTimeoutMs(explicit, "timeout option");
  }
  const fromEnv = process.env[TIMEOUT_ENV_VAR];
  if (fromEnv === undefined || fromEnv === "") {
    return DEFAULT_VERIFICATION_TIMEOUT_MS;
  }
  return assertTimeoutMs(Number(fromEnv), TIMEOUT_ENV_VAR);
}

function assertTimeoutMs(value: number, source: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid ${source}: ${value} (expected a positive integer in ms)`);
  }
  return value;
}

/** Env fallback for the browser endpoint, for hosts that spawn the CLI. */
const BROWSER_ENDPOINT_ENV_VAR = "ZERP_BROWSER_ENDPOINT";

/** How long a shared browser gets to take its context back before we give up on it. */
const CONTEXT_CLEANUP_TIMEOUT_MS = 5_000;

/**
 * The already-running browser to verify in: an explicit option, else the
 * environment, else none (launch one).
 *
 * Rejects an endpoint whose scheme names no transport rather than guessing, for
 * the same reason a malformed timeout throws — a host that configured browser
 * reuse and silently got a per-run launch has the cost it was trying to avoid
 * and no signal that it does.
 */
export function resolveBrowserEndpoint(explicit?: string): string | undefined {
  const value = explicit ?? process.env[BROWSER_ENDPOINT_ENV_VAR];
  if (value === undefined || value === "") {
    return undefined;
  }
  if (!/^(?:https?|wss?):\/\//.test(value)) {
    throw new Error(
      `Invalid browser endpoint: ${value} (expected an http(s):// CDP or ws(s):// playwright URL)`,
    );
  }
  return value;
}

/**
 * Attach to a browser someone else is running.
 *
 * CDP is the interoperable transport: it is the browser's own protocol, so the
 * two sides need no common playwright build. The playwright protocol is
 * version-locked between client and server, so `ws://` is for a server started
 * by a matching `chromium.launchServer()` — typically the same application that
 * spawns this CLI.
 */
function connectBrowser(endpoint: string, timeoutMs: number): Promise<Browser> {
  return endpoint.startsWith("http")
    ? chromium.connectOverCDP(endpoint, { timeout: timeoutMs })
    : chromium.connect(endpoint, { timeout: timeoutMs });
}

/**
 * Resolve a Chromium executable for headless work, in priority order:
 *
 *   1. `CHROME_BIN` — an explicit override (wrapper scripts that exec a
 *      browser with extra flags are supported), validated the same way the
 *      system candidates in step 3 are: a path-like value must exist, and
 *      the binary must actually run `--version`. An unvalidated override
 *      would otherwise surface as a raw Playwright launch failure three
 *      layers away from the typo that caused it, instead of a clear,
 *      actionable error naming the bad path right here.
 *   2. playwright-core's own managed chromium, if `zerp install-browser` (or a
 *      prior playwright install) has downloaded it. `executablePath()` computes
 *      a path whether or not it exists — and throws in some builds when nothing
 *      is installed — so guard it with `existsSync`.
 *   3. A system-installed Chrome/Chromium, validated by `--version`.
 *   4. None found — point at `zerp install-browser` or `CHROME_BIN`.
 *
 * Exported so every headless entry point resolves a browser identically — the
 * docs PDF build (`scripts/build-docs.mjs`) and the check probe both use it.
 */
export function resolveBrowserExecutable(): string {
  const override = process.env.CHROME_BIN;
  if (override) {
    if (override.includes("/") && !existsSync(override)) {
      throw new Error(
        `CHROME_BIN is set to "${override}", but no file exists there. Fix the path, or unset CHROME_BIN and run \`zerp install-browser\` to let zerp resolve a browser itself.`,
      );
    }
    const probe = spawnSync(override, ["--version"], { stdio: "ignore" });
    if (probe.status !== 0) {
      throw new Error(
        `CHROME_BIN is set to "${override}", but it did not run ("${override} --version" failed). Fix the path, or unset CHROME_BIN and run \`zerp install-browser\` to let zerp resolve a browser itself.`,
      );
    }
    return override;
  }
  try {
    const managed = chromium.executablePath();
    if (managed && existsSync(managed)) {
      return managed;
    }
  } catch {
    // playwright-core has no managed browser installed; fall through.
  }
  for (const candidate of SYSTEM_CHROME_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) {
      return candidate;
    }
  }
  throw new Error(
    "No Chrome/Chromium found. Run `zerp install-browser` or set CHROME_BIN to a browser binary.",
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Installed at document start so resource and script errors are collected
// from the first byte of the deck, before any slide markup runs.
const COLLECTOR_SOURCE = `
window.__zerpVerifyErrors = [];
window.addEventListener("error", function (event) {
  var target = event.target;
  var message = event.message || (target && (target.src || target.href)) || "browser error";
  window.__zerpVerifyErrors.push(String(message));
}, true);
window.addEventListener("unhandledrejection", function (event) {
  window.__zerpVerifyErrors.push(String(event.reason || "unhandled rejection"));
});
`;

export interface BrowserSessionOptions {
  /** Absent when {@link BrowserSessionOptions.browserEndpoint} supplies a browser instead. */
  executablePath?: string;
  htmlPath: string;
  width: number;
  height: number;
  timeoutMs: number;
  /** An already-running browser to use, instead of launching one:
   * `http(s)://` connects over CDP, `ws(s)://` over the playwright protocol.
   * The browser belongs to whoever started it and is never closed here. */
  browserEndpoint?: string;
  /** Named by the caller so a timeout names the budget that ran out and the
   * flag/env var that raises it — the one failure whose fix is a
   * configuration change the operator cannot make without knowing which
   * value was too small. */
  timeoutMessage: string;
}

/**
 * Drive Chromium through playwright-core (a battle-tested browser driver with
 * no bundled browsers of its own) for one session: borrow or launch a
 * browser, open an exact-viewport context, install the error collector,
 * navigate to `htmlPath`, hand the live page and context to `run`, and tear
 * everything down afterward.
 *
 * The borrow-versus-launch distinction decides the whole teardown: a supplied
 * browser is borrowed and only its context is closed; a launched one is ours
 * and is closed outright. Shared by every caller that needs a live browser
 * session — `zerp check`'s probe today — so this lifecycle is defined once.
 */
export async function runBrowserSession<T>(
  options: BrowserSessionOptions,
  run: (page: Page, context: BrowserContext) => Promise<T>,
): Promise<T> {
  const { htmlPath, width, height, timeoutMs, browserEndpoint, timeoutMessage } = options;
  // A supplied browser is borrowed; a launched one is ours to terminate. The
  // distinction decides the whole teardown below.
  const borrowed = browserEndpoint !== undefined;
  const opening = borrowed
    ? connectBrowser(browserEndpoint, timeoutMs)
    : // playwright-core defaults `chromiumSandbox: false`, so this stays root-safe
      // without extra flags; the launch is bounded so a wedged browser cannot hang.
      chromium.launch({
        ...(options.executablePath === undefined ? {} : { executablePath: options.executablePath }),
        headless: true,
        timeout: timeoutMs,
      });
  let browser: Browser | undefined;
  // Held as a promise, not a value: if the session times out while the context
  // is still being created, the value assignment never happens and a borrowed
  // browser would keep the context forever.
  let opened: Promise<BrowserContext> | undefined;
  const session = opening.then(async (connected) => {
    browser = connected;
    // An exact layout viewport, unlike `--window-size`, whose delivered
    // innerWidth/innerHeight vary by platform and required calibration.
    opened = connected.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    const context = await opened;
    const page = await context.newPage();
    await page.addInitScript(COLLECTOR_SOURCE);
    await page.goto(`file://${htmlPath}#1`, { waitUntil: "load" });
    return run(page, context);
  });
  try {
    return await withTimeout(session, timeoutMs, timeoutMessage);
  } finally {
    // The context is closed explicitly rather than left to the browser: a
    // borrowed browser survives this process, so an abandoned context is a leak
    // that accumulates over every session the host runs. Bounded, because
    // teardown must not outlive the run it is cleaning up after.
    if (opened) {
      await withTimeout(
        opened.then((context) => context.close()),
        CONTEXT_CLEANUP_TIMEOUT_MS,
        "closing the verification context timed out",
      ).catch(() => {});
    }
    // Also close the browser even if the race above rejected: if it already
    // resolved, `browser` holds the handle; if it is still settling, await it
    // so a late-arriving browser is not leaked. On a borrowed browser this
    // severs our connection and leaves the browser itself running.
    const connected = browser ?? (await opening.catch(() => undefined));
    if (connected) {
      await connected.close().catch(() => {});
    }
  }
}
