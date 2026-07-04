#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";

import { checkPresentation } from "./check/checker.js";
import { formatReport, reportHasFailures } from "./check/report.js";
import { type ThemeName, writePresentation } from "./presentation.js";
import { servePresentation } from "./server.js";

const THEME_NAMES = new Set(["dark", "light", "system"]);

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  zerp serve [deck-dir] [port] [--theme dark|light|system]",
      "  zerp build [deck-dir] [--theme dark|light|system]",
      "  zerp check [deck-dir] [--strict]",
      "",
      "A deck directory must contain slides/.",
      "",
    ].join("\n"),
  );
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

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      theme: { type: "string" },
      strict: { type: "boolean", default: false },
    },
  });
  const [command, firstArg, secondArg] = positionals;

  if (command === "build") {
    const rootDir = path.resolve(firstArg ?? ".");
    const theme = parseTheme(values.theme);
    const outFile = await writePresentation({ rootDir, theme });
    process.stdout.write(`Wrote ${outFile}\n`);
    const report = await checkPresentation({ rootDir });
    process.stdout.write(formatReport(report, { summaryOnly: true }));
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
    const report = await checkPresentation({ rootDir });
    process.stdout.write(formatReport(report));
    process.exitCode = reportHasFailures(report, values.strict ?? false) ? 1 : 0;
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
