import { readFileSync } from "node:fs";

import { contrastLc, MIN_ERROR_PX, MIN_WARN_PX, neededLc, requiredPx } from "./apca.js";
import { blend, parseColor, toHex, type Rgba } from "./color.js";
import type { DeckProbe, ProbeElement, ProbeSlide } from "./probe-types.js";
import type { Finding, FindingCategory } from "./types.js";

export interface JudgeOptions {
  only?: FindingCategory[];
  safeMargin?: number;
}

interface ThemeContrastData {
  bg: Record<string, string>;
  fg: Record<string, string>;
  lc: Record<string, Record<string, number>>;
}

interface TokenContrast {
  dark: ThemeContrastData;
  light: ThemeContrastData;
}

type BackgroundResult = { kind: "color"; color: Rgba } | { kind: "unverifiable"; reason: string };

// judge() is a pure, synchronous function of a DeckProbe (see module doc
// below), so the token-contrast table — a small asset generated at build
// time from the theme palette, not deck input — is loaded synchronously and
// cached, the same way a compiled-in constant would be if TS allowed JSON
// import attributes across this package's build layout.
let tokenContrastCache: TokenContrast | null = null;

function loadTokenContrast(): TokenContrast {
  tokenContrastCache ??= JSON.parse(
    readFileSync(new URL("./token-contrast.json", import.meta.url), "utf8"),
  ) as TokenContrast;
  return tokenContrastCache;
}

function suggestionFor(
  data: ThemeContrastData,
  bgHex: string,
  sizePx: number,
  weight: number,
): string | null {
  const bgEntry = Object.entries(data.bg).find(([, hex]) => hex === bgHex);
  if (!bgEntry) {
    return null;
  }
  const table = data.lc[bgEntry[0]];
  if (!table) {
    return null;
  }
  const passing = Object.entries(table)
    .filter(([, lc]) => {
      const req = requiredPx(lc, weight);
      return req !== null && req <= sizePx;
    })
    .map(([token]) => token);
  if (passing.length === 0) {
    return null;
  }
  const preferred = ["--zerp-text", "--zerp-muted"].filter((token) => passing.includes(token));
  const picks = (preferred.length > 0 ? preferred : passing).slice(0, 2);
  return `use color: ${picks.map((token) => `var(${token})`).join(" or ")}`;
}

function compositeLayers(layers: Rgba[], base: Rgba): Rgba {
  let acc = base;
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer) {
      acc = blend(layer, acc);
    }
  }
  return acc;
}

// The probe records each element's own background; a transparent one means the
// backdrop is whatever the ancestors composite to, exactly as the DOM walk did.
function backdropFor(slide: ProbeSlide, el: ProbeElement): BackgroundResult {
  const layers: Rgba[] = [];
  let node: ProbeElement | undefined = el;
  while (node) {
    if (node.backgroundImage && node.backgroundImage !== "none") {
      return { kind: "unverifiable", reason: "background image/gradient" };
    }
    const color = parseColor(node.backgroundColor);
    if (color) {
      if (color.a >= 1) {
        return { kind: "color", color: compositeLayers(layers, color) };
      }
      if (color.a > 0) {
        layers.push(color);
      }
    }
    node = node.parent === null ? undefined : slide.elements[node.parent];
  }
  // Nothing opaque above the slide root: the page background is the backdrop.
  return { kind: "color", color: compositeLayers(layers, { r: 0, g: 0, b: 0, a: 1 }) };
}

function wanted(only: FindingCategory[] | undefined, category: FindingCategory): boolean {
  return only === undefined || only.includes(category);
}

function judgeContrastAndTypeSize(
  probe: DeckProbe,
  only: FindingCategory[] | undefined,
  findings: Finding[],
): void {
  const wantsContrast = wanted(only, "contrast");
  const wantsTypeSize = wanted(only, "type-size");
  if (!wantsContrast && !wantsTypeSize) {
    return;
  }
  const tokenContrast = loadTokenContrast();
  const themeContrast = tokenContrast[probe.theme];

  for (const slide of probe.slides) {
    for (const el of slide.elements) {
      if (!el.hasOwnText) {
        continue;
      }
      const snippet = el.snippet;
      const push = (
        severity: Finding["severity"],
        category: FindingCategory,
        message: string,
        suggestion: string | null = null,
      ): void => {
        findings.push({
          severity,
          category,
          theme: probe.theme,
          slideIndex: slide.index,
          slideSrc: slide.src,
          slideSrcSlide: slide.srcSlide,
          snippet,
          message,
          suggestion,
        });
      };
      const sizePx = Math.round(el.fontSizePx * 10) / 10;
      const weight = el.fontWeight;
      if (wantsTypeSize) {
        if (sizePx < MIN_ERROR_PX) {
          push(
            "error",
            "type-size",
            `${sizePx}px text is below the ${MIN_ERROR_PX}px hard minimum`,
          );
        } else if (sizePx < MIN_WARN_PX) {
          push(
            "warning",
            "type-size",
            `${sizePx}px text is below the ${MIN_WARN_PX}px recommended minimum`,
          );
        }
      }
      if (!wantsContrast) {
        continue;
      }
      const bg = backdropFor(slide, el);
      if (bg.kind === "unverifiable") {
        push("unverifiable", "contrast", `${bg.reason} — verify contrast manually`);
        continue;
      }
      const fgParsed = parseColor(el.color);
      if (!fgParsed) {
        push("unverifiable", "contrast", `could not parse text color "${el.color}"`);
        continue;
      }
      const fgEffective = blend({ ...fgParsed, a: fgParsed.a * el.opacity }, bg.color);
      const lc = contrastLc(fgEffective, bg.color);
      const lcAbs = Math.round(Math.abs(lc));
      const pair = `${toHex(fgEffective)} on ${toHex(bg.color)}`;
      const req = requiredPx(lc, weight);
      if (req === null) {
        push(
          "error",
          "contrast",
          `contrast Lc ${lcAbs} (${pair}) is unusable for text at any size`,
          suggestionFor(themeContrast, toHex(bg.color), sizePx, weight),
        );
      } else if (sizePx < req) {
        const target = neededLc(sizePx, weight);
        push(
          "error",
          "contrast",
          `${sizePx}px/${weight} text has contrast Lc ${lcAbs} (${pair}); needs ≥${req}px at this contrast${target === null ? "" : ` or Lc ≥ ${target} at this size`}`,
          suggestionFor(themeContrast, toHex(bg.color), sizePx, weight),
        );
      }
    }
  }
}

/**
 * Pure judgement over a recorded `DeckProbe`: no browser, no network, no
 * deck-directory filesystem access. Every rule category (contrast and
 * type-size so far; more land in later tasks) is gated behind
 * `options.only` so the CLI can narrow which checks run.
 */
export function judge(probe: DeckProbe, options: JudgeOptions = {}): Finding[] {
  const findings: Finding[] = [];
  judgeContrastAndTypeSize(probe, options.only, findings);
  return findings;
}
