// Records real browser probes as judge-test fixtures. Hand-writing these would
// let them drift from what Chrome actually reports, which is the one thing the
// probe/judge split must not allow.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { probeDeck } from "../dist/check/probe.js";

const DECKS = [
  ["stack-coverage-deck", "test/fixtures/stack-coverage-deck"],
  ["kitchen-sink", "test/fixtures/kitchen-sink"],
  ["broken-deck", "test/fixtures/broken-deck"],
];
const OUT = "test/fixtures/probes";

await mkdir(OUT, { recursive: true });
for (const [name, rootDir] of DECKS) {
  for (const theme of ["dark", "light"]) {
    const probe = await probeDeck({
      rootDir,
      theme,
      width: 1920,
      height: 1080,
      safeMargin: 0,
      timeoutMs: 30000,
    });
    const file = path.join(OUT, `${name}-${theme}.json`);
    await writeFile(file, `${JSON.stringify(probe, null, 2)}\n`);
    process.stdout.write(`${file}\n`);
  }
}
