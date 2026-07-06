import { readFile } from "node:fs/promises";

import { parseHTML } from "linkedom";

import { buildPresentationHtml } from "../presentation.js";
import { contrastLc, MIN_ERROR_PX, MIN_WARN_PX, neededLc, requiredPx } from "./apca.js";
import { StyleResolver } from "./cascade.js";
import { blend, parseColor, rgbDistance, toHex } from "./color.js";
import { parseStylesheets, type StyleSheetInput } from "./css-model.js";
import type { CheckReport, CheckTheme, DomElement, Finding } from "./types.js";

export interface CheckOptions {
  rootDir: string;
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

interface DomQueryable {
  querySelectorAll(selector: string): { length: number; [index: number]: unknown };
}

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);
const THEMES: CheckTheme[] = ["dark", "light"];
// Surfaces need either a luminance step (APCA clips small deltas to 0 near
// the poles, so RGB channel distance carries near-white/near-black cases) or
// a visible border/shadow to read as a distinct panel.
const SURFACE_MIN_RGB_DIST = 30;
const SURFACE_MIN_LC = 15;

let tokenContrastCache: TokenContrast | null = null;

async function loadTokenContrast(): Promise<TokenContrast> {
  tokenContrastCache ??= JSON.parse(
    await readFile(new URL("./token-contrast.json", import.meta.url), "utf8"),
  ) as TokenContrast;
  return tokenContrastCache;
}

function snippetOf(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > 40 ? `${collapsed.slice(0, 37)}…` : collapsed;
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

function walkText(el: DomElement, visit: (text: string, parent: DomElement) => void): void {
  if (SKIP_TAGS.has(el.tagName)) {
    return;
  }
  if (el.getAttribute("aria-hidden") === "true") {
    return;
  }
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (!child) {
      continue;
    }
    if (child.nodeType === 3) {
      const text = child.textContent ?? "";
      if (/\S/.test(text)) {
        visit(text, el);
      }
    } else if (child.nodeType === 1) {
      walkText(child as DomElement, visit);
    }
  }
}

function walkElements(el: DomElement, visit: (el: DomElement) => void): void {
  if (SKIP_TAGS.has(el.tagName)) {
    return;
  }
  if (el.getAttribute("aria-hidden") === "true" || el.getAttribute("hidden") !== null) {
    return;
  }
  visit(el);
  for (let i = 0; i < el.childNodes.length; i++) {
    const child = el.childNodes[i];
    if (child && child.nodeType === 1) {
      walkElements(child as DomElement, visit);
    }
  }
}

function elementLabel(el: DomElement): string {
  const cls = el.getAttribute("class");
  const label = `<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ""}>`;
  return label.length > 40 ? `${label.slice(0, 37)}…>` : label;
}

export async function checkPresentation(options: CheckOptions): Promise<CheckReport> {
  const html = await buildPresentationHtml({ rootDir: options.rootDir });
  const { document } = parseHTML(html) as unknown as { document: DomQueryable };
  const styleNodes = document.querySelectorAll("style");
  const sheets: StyleSheetInput[] = [];
  for (let i = 0; i < styleNodes.length; i++) {
    const node = styleNodes[i] as DomElement;
    sheets.push({
      css: node.textContent ?? "",
      origin: node.getAttribute("data-zerp") ? "framework" : "deck",
    });
  }
  const model = parseStylesheets(sheets);
  const slideNodes = document.querySelectorAll(".slide");
  const tokenContrast = await loadTokenContrast();
  const findings: Finding[] = [];

  for (const theme of THEMES) {
    const resolver = new StyleResolver(model, model.themeVars[theme]);
    const evaluated = new Set<DomElement>();
    const surfaceEvaluated = new Set<DomElement>();
    for (let slideIndex = 0; slideIndex < slideNodes.length; slideIndex++) {
      const slide = slideNodes[slideIndex] as DomElement;
      const slideSrc = slide.getAttribute("data-zerp-src");
      const slideSrcSlide = slide.getAttribute("data-zerp-src-slide");
      walkText(slide, (text, parentEl) => {
        if (evaluated.has(parentEl)) {
          return;
        }
        evaluated.add(parentEl);
        const snippet = snippetOf(text);
        const push = (
          severity: Finding["severity"],
          message: string,
          suggestion: string | null = null,
        ): void => {
          findings.push({
            severity,
            theme,
            slideIndex: slideIndex + 1,
            slideSrc,
            slideSrcSlide,
            snippet,
            message,
            suggestion,
          });
        };
        const computed = resolver.computedFor(parentEl);
        const sizePx = Math.round(computed.fontSizePx * 10) / 10;
        const weight = computed.fontWeight;
        if (sizePx < MIN_ERROR_PX) {
          push("error", `${sizePx}px text is below the ${MIN_ERROR_PX}px hard minimum`);
        } else if (sizePx < MIN_WARN_PX) {
          push("warning", `${sizePx}px text is below the ${MIN_WARN_PX}px recommended minimum`);
        }
        const bg = resolver.backgroundFor(parentEl);
        if (bg.kind === "unverifiable") {
          push("unverifiable", `${bg.reason} — verify contrast manually`);
          return;
        }
        const fgParsed = parseColor(resolver.resolveVars(computed.color));
        if (!fgParsed) {
          push("unverifiable", `could not parse text color "${computed.color}"`);
          return;
        }
        const fgEffective = blend({ ...fgParsed, a: fgParsed.a * computed.opacity }, bg.color);
        const lc = contrastLc(fgEffective, bg.color);
        const lcAbs = Math.round(Math.abs(lc));
        const pair = `${toHex(fgEffective)} on ${toHex(bg.color)}`;
        const req = requiredPx(lc, weight);
        if (req === null) {
          push(
            "error",
            `contrast Lc ${lcAbs} (${pair}) is unusable for text at any size`,
            suggestionFor(tokenContrast[theme], toHex(bg.color), sizePx, weight),
          );
        } else if (sizePx < req) {
          const target = neededLc(sizePx, weight);
          push(
            "error",
            `${sizePx}px/${weight} text has contrast Lc ${lcAbs} (${pair}); needs ≥${req}px at this contrast${target === null ? "" : ` or Lc ≥ ${target} at this size`}`,
            suggestionFor(tokenContrast[theme], toHex(bg.color), sizePx, weight),
          );
        }
      });

      walkElements(slide, (el) => {
        if (el === slide || surfaceEvaluated.has(el)) {
          return;
        }
        surfaceEvaluated.add(el);
        const surface = resolver.surfaceInfo(el);
        if (!surface.hasBackground || surface.hasShadow) {
          return;
        }
        const parent = el.parentElement;
        if (!parent) {
          return;
        }
        const ownBg = resolver.backgroundFor(el);
        const behindBg = resolver.backgroundFor(parent);
        if (ownBg.kind !== "color" || behindBg.kind !== "color") {
          return;
        }
        const dist = rgbDistance(ownBg.color, behindBg.color);
        const lcSurface = Math.abs(contrastLc(ownBg.color, behindBg.color));
        if (dist >= SURFACE_MIN_RGB_DIST || lcSurface >= SURFACE_MIN_LC) {
          return;
        }
        if (
          surface.borderWidthPx >= 1 &&
          surface.borderColor &&
          rgbDistance(blend(surface.borderColor, behindBg.color), behindBg.color) >=
            SURFACE_MIN_RGB_DIST
        ) {
          return;
        }
        findings.push({
          severity: "warning",
          theme,
          slideIndex: slideIndex + 1,
          slideSrc,
          slideSrcSlide,
          snippet: elementLabel(el),
          message: `surface ${toHex(ownBg.color)} blends into ${toHex(behindBg.color)} behind it (Δ${Math.round(dist)})`,
          suggestion: "use a stronger tint, or add a visible border or shadow",
        });
      });
    }
  }

  return { slideCount: slideNodes.length, findings, skippedSelectors: model.skippedSelectors };
}
