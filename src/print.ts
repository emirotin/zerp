import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { readDeckConfig, resolveDeckSize } from "./deck-config.js";
import { buildPresentationHtml } from "./presentation.js";
import {
  DEFAULT_VERIFICATION_TIMEOUT_MS,
  resolveBrowserExecutable,
  runBrowserSession,
} from "./verify.js";

let printSequence = 0;

export interface PrintOptions {
  rootDir: string;
  theme?: "dark" | "light";
  out?: string;
  timeoutMs?: number;
  browserEndpoint?: string;
}

/**
 * Render a deck directly to a PDF at its design size, skipping the
 * screen-scaled runtime entirely.
 *
 * The assembled HTML is written into the deck dir (not a temp dir) so
 * deck-relative asset URLs resolve — the same reason the check probe does it
 * (`src/check/probe.ts`). It is removed in a `finally`, and `.zerp-print-*.html`
 * is gitignored to survive a crash between the write and the cleanup.
 */
export async function printPresentation(options: PrintOptions): Promise<string> {
  const rootDir = path.resolve(options.rootDir);
  const size = resolveDeckSize(await readDeckConfig(rootDir));
  const theme = options.theme ?? "light";
  const html = await buildPresentationHtml({ rootDir, theme });
  const tempPath = path.join(rootDir, `.zerp-print-${process.pid}-${printSequence++}.html`);
  const out = path.resolve(options.out ?? path.join(rootDir, "index.pdf"));
  await writeFile(tempPath, html);
  const executablePath = options.browserEndpoint ? undefined : resolveBrowserExecutable();
  try {
    await runBrowserSession(
      {
        ...(executablePath === undefined ? {} : { executablePath }),
        htmlPath: tempPath,
        width: size.width,
        height: size.height,
        timeoutMs: options.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
        ...(options.browserEndpoint === undefined
          ? {}
          : { browserEndpoint: options.browserEndpoint }),
        timeoutMessage:
          "zerp print did not finish in time; raise --timeout ms or ZERP_VERIFY_TIMEOUT_MS",
      },
      async (page) => {
        // Printing before fonts activate paginates on fallback metrics (the
        // 0.6.1 bug); wait like build-docs.mjs does.
        await page.evaluate(() => document.fonts.ready);
        // Explicit width/height describe the page fully; never add
        // `landscape` — Chromium would swap the dimensions (README gotcha).
        await page.pdf({
          path: out,
          width: `${size.width}px`,
          height: `${size.height}px`,
          printBackground: true,
        });
      },
    );
  } finally {
    await rm(tempPath, { force: true });
  }
  return out;
}
