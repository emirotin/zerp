#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";

import { checkPresentation } from "./check/checker.js";
import { formatReport, reportHasFailures } from "./check/report.js";
import { FINDING_CATEGORIES, type CheckTheme, type FindingCategory } from "./check/types.js";
import { type DeckSize, parseWxH } from "./deck-config.js";
import { type ThemeName, writePresentation } from "./presentation.js";
import { servePresentation } from "./server.js";
import { formatSlideList, listDeckSlides } from "./slides.js";
import { resolveBrowserEndpoint, resolveVerificationTimeoutMs } from "./verify.js";

const THEME_NAMES = new Set(["dark", "light", "system"]);

const USAGE = `Usage:
  zerp serve [deck-dir] [port] [--theme dark|light|system]
  zerp build [deck-dir] [--theme dark|light|system]
  zerp check [deck-dir] [--theme dark|light|both] [--size WxH (default: the deck's zerp.size or 1920x1080)] [--safe-margin px] [--timeout ms] [--browser-endpoint url] [--only category,...] [--strict] [--json]
  zerp slides [deck-dir] [--json]
  zerp install-browser

A deck directory must contain slides/.
`;

function printUsage(): void {
  process.stderr.write(USAGE);
}

/**
 * Download the playwright-managed Chromium that `zerp check` can resolve
 * without a system browser. playwright-core ships the downloader as its own
 * CLI (`cli.js`, its package `bin`); locate it from the installed package
 * directory so this works from a global or local zerp install, then hand off,
 * streaming its output through and returning its exit code.
 */
function installBrowser(): Promise<number> {
  const require = createRequire(import.meta.url);
  const cliPath = path.join(
    path.dirname(require.resolve("playwright-core/package.json")),
    "cli.js",
  );
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, "install", "chromium"], {
      stdio: "inherit",
    });
    child.on("error", (error: Error) => {
      process.stderr.write(`${error.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

function parseTheme(raw: string | undefined): ThemeName {
  if (raw === undefined) {
    return "system";
  }
  if (!THEME_NAMES.has(raw)) {
    throw new Error(`Invalid theme: ${raw} (expected dark, light, or system)`);
  }
  return raw as ThemeName;
}

function parseCheckThemes(raw: string | undefined): CheckTheme[] {
  if (raw === undefined || raw === "both") {
    return ["dark", "light"];
  }
  if (raw === "dark" || raw === "light") {
    return [raw];
  }
  throw new Error(`Invalid check theme: ${raw} (expected dark, light, or both)`);
}

/** Print-safe inset for `zerp check`; 0 (the default) disables the check. */
function parseSafeMargin(raw: string | undefined): number {
  const value = raw ?? "0";
  if (!/^\d+$/.test(value)) {
    throw new Error(`Invalid safe margin: ${value} (expected a non-negative integer in CSS px)`);
  }
  return Number.parseInt(value, 10);
}

/**
 * Session budget for `zerp check`'s browser pass, in ms. Absent defers to the
 * environment and then to zerp's default, so the flag, `ZERP_VERIFY_TIMEOUT_MS`
 * and the default are resolved in one place rather than each growing its own
 * precedence rule. Reuses verify.ts's env var name (rather than a new
 * `ZERP_CHECK_TIMEOUT_MS`) so a host already configured for the old `zerp
 * verify` keeps working unchanged.
 */
function parseVerifyTimeout(raw: string | undefined): number {
  if (raw !== undefined && !/^\d+$/.test(raw)) {
    throw new Error(`Invalid timeout: ${raw} (expected a positive integer in ms)`);
  }
  return resolveVerificationTimeoutMs(raw === undefined ? undefined : Number.parseInt(raw, 10));
}

function parseVerifySize(raw: string | undefined): DeckSize | undefined {
  if (raw === undefined) return undefined;
  const size = parseWxH(raw);
  if (!size) throw new Error(`Invalid verification size: ${raw} (expected positive WxH)`);
  return size;
}

const FINDING_CATEGORY_SET = new Set<string>(FINDING_CATEGORIES);

/** `--only category,category` narrows `zerp check` to a subset of rule categories. */
function parseOnly(raw: string | undefined): FindingCategory[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const requested = raw.split(",").map((entry) => entry.trim());
  const unknown = requested.filter((entry) => !FINDING_CATEGORY_SET.has(entry));
  if (unknown.length > 0) {
    throw new Error(
      `Invalid --only category: ${unknown.join(", ")} (expected one or more of ${FINDING_CATEGORIES.join(", ")})`,
    );
  }
  return requested as FindingCategory[];
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      theme: { type: "string" },
      strict: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      size: { type: "string" },
      "safe-margin": { type: "string" },
      timeout: { type: "string" },
      "browser-endpoint": { type: "string" },
      only: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  const [command, firstArg, secondArg] = positionals;

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }

  if (command === "build") {
    const rootDir = path.resolve(firstArg ?? ".");
    const theme = parseTheme(values.theme);
    const outFile = await writePresentation({ rootDir, theme });
    process.stdout.write(`Wrote ${outFile}\n`);
    // The build itself needs no browser and must still succeed without one; the
    // post-build check is a courtesy that now drives real Chrome, so its
    // absence is reported explicitly rather than folded into a generic
    // "check skipped" line a CI host with no browser installed could scroll
    // past without noticing it lost check coverage.
    try {
      const report = await checkPresentation({ rootDir });
      process.stdout.write(formatReport(report, { summaryOnly: true }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      // Both messages originate solely from resolveBrowserExecutable (no
      // browser found at all, or CHROME_BIN pointing at something that
      // doesn't exist/run) — the two ways "build without a browser" happens.
      // Anything else (a genuinely broken deck, a timeout) keeps the
      // generic line below.
      if (
        message.includes("No Chrome/Chromium found") ||
        message.includes("CHROME_BIN is set to")
      ) {
        process.stdout.write(
          `check skipped: no browser found — run \`zerp install-browser\`, set CHROME_BIN, ` +
            `or run \`zerp check\` once a browser is available (${message})\n`,
        );
      } else {
        process.stdout.write(`check skipped: ${message}\n`);
      }
    }
    return;
  }

  if (command === "serve") {
    const hasExplicitDeckDir = firstArg !== undefined && !/^\d+$/.test(firstArg);
    const rootDir = path.resolve(hasExplicitDeckDir ? firstArg : ".");
    const portArg = hasExplicitDeckDir ? secondArg : firstArg;
    const port = portArg ? Number.parseInt(portArg, 10) : 8000;
    if (!Number.isInteger(port)) {
      throw new Error(`Invalid port: ${portArg}`);
    }
    await servePresentation(rootDir, port, { theme: parseTheme(values.theme) });
    return;
  }

  if (command === "check") {
    const rootDir = path.resolve(firstArg ?? ".");
    const themes = parseCheckThemes(values.theme);
    const size = parseVerifySize(values.size);
    const safeMargin = parseSafeMargin(values["safe-margin"]);
    const timeoutMs = parseVerifyTimeout(values.timeout);
    const only = parseOnly(values.only);
    // Resolved once, before any browser work: an unusable endpoint should be
    // rejected on the spot rather than once per theme.
    const browserEndpoint = resolveBrowserEndpoint(values["browser-endpoint"]);
    const report = await checkPresentation({
      rootDir,
      themes,
      ...(size === undefined ? {} : size),
      safeMargin,
      timeoutMs,
      ...(browserEndpoint === undefined ? {} : { browserEndpoint }),
      ...(only === undefined ? {} : { only }),
    });
    process.stdout.write(
      values.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report),
    );
    process.exitCode = reportHasFailures(report, values.strict ?? false) ? 1 : 0;
    return;
  }

  if (command === "slides") {
    const rootDir = path.resolve(firstArg ?? ".");
    const slides = await listDeckSlides(rootDir);
    process.stdout.write(
      values.json ? `${JSON.stringify(slides, null, 2)}\n` : formatSlideList(slides),
    );
    return;
  }

  if (command === "install-browser") {
    process.exitCode = await installBrowser();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
