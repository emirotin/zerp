import { readFile } from "node:fs/promises";

import { parseHTML } from "linkedom";

import { buildPresentationHtml } from "../presentation.js";
import { contrastLc, MIN_ERROR_PX, MIN_WARN_PX, neededLc, requiredPx } from "./apca.js";
import { StyleResolver } from "./cascade.js";
import { blend, parseColor, toHex } from "./color.js";
import { parseStylesheets, type StyleSheetInput } from "./css-model.js";
import type { CheckReport, CheckTheme, DomElement, DomNode, Finding } from "./types.js";

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

export async function checkPresentation(options: CheckOptions): Promise<CheckReport> {
  const html = await buildPresentationHtml({ rootDir: options.rootDir });
  const { document } = parseHTML(html) as unknown as { document: DomQueryable };
  const styleNodes = document.querySelectorAll("style");
  const sheets: StyleSheetInput[] = [];
  for (let i = 0; i < styleNodes.length; i++) {
    const node = styleNodes[i] as DomNode;
    sheets.push({ css: node.textContent ?? "", origin: i === 0 ? "framework" : "deck" });
  }
  const model = parseStylesheets(sheets);
  const slideNodes = document.querySelectorAll(".slide");
  const tokenContrast = await loadTokenContrast();
  const findings: Finding[] = [];

  for (const theme of THEMES) {
    const resolver = new StyleResolver(model, model.themeVars[theme]);
    const evaluated = new Set<DomElement>();
    for (let slideIndex = 0; slideIndex < slideNodes.length; slideIndex++) {
      const slide = slideNodes[slideIndex] as DomElement;
      const slideSrc = slide.getAttribute("data-zerp-src");
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
    }
  }

  return { slideCount: slideNodes.length, findings, skippedSelectors: model.skippedSelectors };
}
