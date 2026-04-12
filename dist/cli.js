#!/usr/bin/env node
import path from "node:path";
import { writePresentation } from "./presentation.js";
import { servePresentation } from "./server.js";
function printUsage() {
  process.stderr.write(
    [
      "Usage:",
      "  zerp serve [deck-dir] [port]",
      "  zerp build [deck-dir]",
      "",
      "A deck directory must contain slides/.",
      "",
    ].join("\n"),
  );
}
async function main() {
  const [, , command, firstArg, secondArg] = process.argv;
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (command === "build") {
    const rootDir = path.resolve(firstArg ?? ".");
    const outFile = await writePresentation({ rootDir });
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
    await servePresentation(rootDir, port);
    return;
  }
  printUsage();
  process.exitCode = 1;
}
main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
