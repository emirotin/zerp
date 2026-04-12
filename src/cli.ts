#!/usr/bin/env node
import path from "node:path";

import { writePresentation } from "./presentation.js";
import { servePresentation } from "./server.js";

function printUsage(): void {
  process.stderr.write(
    [
      "Usage:",
      "  zerp serve <deck-dir> [port]",
      "  zerp build <deck-dir>",
      "",
      "A deck directory must contain slides/.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [, , command, deckArg, portArg] = process.argv;

  if (!command || !deckArg) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const rootDir = path.resolve(deckArg);

  if (command === "build") {
    const outFile = await writePresentation({ rootDir });
    process.stdout.write(`Wrote ${outFile}\n`);
    return;
  }

  if (command === "serve") {
    const port = portArg ? Number.parseInt(portArg, 10) : 8000;
    if (!Number.isInteger(port)) {
      throw new Error(`Invalid port: ${portArg}`);
    }
    await servePresentation(rootDir, port);
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
