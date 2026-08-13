import { readFile } from "node:fs/promises";

import { resolveVerificationTimeoutMs } from "../verify.js";
import { judge, type TokenContrast } from "./judge.js";
import { probeDeck } from "./probe.js";
import type { CheckReport, CheckTheme, Finding, FindingCategory } from "./types.js";

export interface CheckOptions {
  rootDir: string;
  themes?: CheckTheme[];
  width?: number;
  height?: number;
  sizeDefaulted?: boolean;
  safeMargin?: number;
  timeoutMs?: number;
  browserEndpoint?: string;
  only?: FindingCategory[];
}

const THEMES: CheckTheme[] = ["dark", "light"];
// Matches zerp verify's historical default: a 1080p viewport suits most decks
// and callers that omit width/height (e.g. `zerp build`'s post-write summary)
// still get a real probe rather than an error.
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

// svg-text and glyph findings describe the deck's markup and font coverage —
// facts that do not change with the color theme. judge() has no notion of
// "themes" (it judges one probe at a time), so without this the same finding
// would be pushed once per requested theme. Kept only for the first requested
// theme's probe, mirroring what the pre-browser static checker did
// explicitly for the same reason.
const STRUCTURAL_CATEGORIES: ReadonlySet<FindingCategory> = new Set(["svg-text", "glyph"]);

let tokenContrastCache: TokenContrast | null = null;

async function loadTokenContrast(): Promise<TokenContrast> {
  tokenContrastCache ??= JSON.parse(
    await readFile(new URL("./token-contrast.json", import.meta.url), "utf8"),
  ) as TokenContrast;
  return tokenContrastCache;
}

/**
 * Thin orchestration over the probe/judge split: drive a real browser over
 * each requested theme (`probeDeck`), hand the recorded facts to the pure
 * rule set (`judge`), and merge the per-theme findings into one report. All
 * measurement lives in probe.ts and all verdicts live in judge.ts — this
 * function only wires the two together and loads the fix-hint table judge()
 * needs but cannot load itself (judge.ts stays filesystem-free).
 */
export async function checkPresentation(options: CheckOptions): Promise<CheckReport> {
  const themes = options.themes ?? THEMES;
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const safeMargin = options.safeMargin ?? 0;
  const timeoutMs = options.timeoutMs ?? resolveVerificationTimeoutMs();
  const tokenContrast = await loadTokenContrast();

  let slideCount = 0;
  const findings: Finding[] = [];
  const primaryTheme = themes[0];
  for (const theme of themes) {
    const probe = await probeDeck({
      rootDir: options.rootDir,
      theme,
      width,
      height,
      safeMargin,
      timeoutMs,
      sizeDefaulted: options.sizeDefaulted ?? false,
      ...(options.browserEndpoint === undefined
        ? {}
        : { browserEndpoint: options.browserEndpoint }),
    });
    // Every theme probes the same deck, so slideCount is theme-invariant;
    // the last write is as good as any.
    slideCount = probe.slideCount;
    for (const finding of judge(probe, {
      ...(options.only === undefined ? {} : { only: options.only }),
      safeMargin,
      tokenContrast,
    })) {
      if (STRUCTURAL_CATEGORIES.has(finding.category) && theme !== primaryTheme) {
        continue;
      }
      findings.push(finding);
    }
  }

  return { slideCount, themes, findings };
}
