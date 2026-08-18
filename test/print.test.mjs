import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { printPresentation } from "../dist/print.js";
import { resolveBrowserExecutable } from "../dist/verify.js";

const browserTestsEnabled = process.env.ZERP_RUN_BROWSER_TEST === "1";

function chromeAvailable() {
  try {
    return Boolean(resolveBrowserExecutable());
  } catch {
    return false;
  }
}

test(
  "prints a deck to PDF at its design size",
  { skip: !browserTestsEnabled || !chromeAvailable() },
  async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "zerp-print-"));
    const out = path.join(outDir, "deck.pdf");
    const written = await printPresentation({ rootDir: "test/fixtures/clean-deck", out });
    assert.equal(written, out);
    const pdf = await readFile(out);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 10_000, "a real multi-page PDF, not an empty page");
    const leftover = (await readdir("test/fixtures/clean-deck")).filter((f) =>
      f.startsWith(".zerp-print-"),
    );
    assert.deepEqual(leftover, [], "temp HTML cleaned up");
  },
);
