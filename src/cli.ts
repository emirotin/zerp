#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";

import type { ThemeName } from "./presentation.js";
import { writePresentation } from "./presentation.js";
import { servePresentation } from "./server.js";

const THEME_NAMES = new Set(["dark", "light", "system"]);

function parseTheme(raw: string | undefined): ThemeName {
  if (raw === undefined) {
    return "system";
  }
  if (!THEME_NAMES.has(raw)) {
    throw new Error(`Invalid theme: ${raw} (expected dark, light, or system)`);
  }
  return raw as ThemeName;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  zerp serve [deck-dir] [port] [--theme dark|light|system]",
      "  zerp build [deck-dir] [--theme dark|light|system]",
      "",
      "A deck directory must contain slides/.",
      "",
    ].join("\n"),
  );
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

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === "build") {
    const rootDir = path.resolve(firstArg ?? ".");
    const outFile = await writePresentation({ rootDir, theme: parseTheme(values.theme) });
    process.stdout.write(`Wrote ${outFile}\n`);
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

  printUsage();
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
