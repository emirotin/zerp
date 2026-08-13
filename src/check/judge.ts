import { contrastLc, MIN_ERROR_PX, MIN_WARN_PX, neededLc, requiredPx } from "./apca.js";
import { blend, parseColor, rgbDistance, toHex, type Rgba } from "./color.js";
import type { DeckProbe, ProbeElement, ProbeSlide, SafeZoneItem } from "./probe-types.js";
import type { Finding, FindingCategory } from "./types.js";

export interface ThemeContrastData {
  bg: Record<string, string>;
  fg: Record<string, string>;
  lc: Record<string, Record<string, number>>;
}

export interface TokenContrast {
  dark: ThemeContrastData;
  light: ThemeContrastData;
}

export interface JudgeOptions {
  only?: FindingCategory[];
  safeMargin?: number;
  // A JSON module import of token-contrast.json (`with { type: "json" }`) was
  // tried first: it fails tsc, because the file lives only under dist/ once
  // scripts/build.mjs generates it at build time — src/check has no sibling
  // JSON for the compiler to resolve. readFileSync was rejected too: it is a
  // syscall in judge()'s call path that can fail for reasons unrelated to the
  // DeckProbe argument, and it assumes judge.js keeps a JSON file next to it
  // on disk, which breaks under bundling. So the table is optional input:
  // the caller (the CLI, in a later task) loads it once and passes it in.
  // Without it, contrast/type-size findings still fire; only the "use this
  // token instead" suggestion is omitted.
  tokenContrast?: TokenContrast;
}

type BackgroundResult = { kind: "color"; color: Rgba } | { kind: "unverifiable"; reason: string };

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

// Every font zerp ships is an inlined @font-face, so a system font drawing
// glyphs means the renderer fell back — that text looks different on every
// machine and is re-resolved again on export. Emoji are the one exemption:
// every platform draws them from its own colour font by design, so they are
// subtracted from the system glyph count rather than reported.
//
// `snippet` is truncated to 40 characters (see probe.ts), so for a long,
// emoji-heavy run the exempt count here is an approximation of the full
// element text. If that proves to misreport in practice, the fix is to have
// the probe record the full-text exempt count (where the untruncated string
// is still available) rather than widening this exemption. Multi-codepoint
// sequences (e.g. a ZWJ family emoji, which is 3 Extended_Pictographic-ish
// codepoints drawing 1 glyph) also make this an overcount of exempt
// characters relative to glyphs — harmless in the direction it errs, since
// it can only suppress a real finding, never invent one.
const EXEMPT = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/gu;

type FontCount = { count: number; isCustomFont: boolean };

// CSS.getPlatformFontsForNode aggregates over the node's entire subtree (see
// collectFonts in probe.ts), so an element's own reported `fonts` double-count
// every descendant's fonts on top of whatever the element's own text (or
// generated content, e.g. ::after) drew. Subtracting each direct child's
// aggregate from the parent's, per family, isolates what this element alone
// is responsible for — recursively correct, because each child's own `fonts`
// was itself already aggregated over its subtree the same way.
function ownFontCounts(slide: ProbeSlide, element: ProbeElement): Map<string, FontCount> {
  const counts = new Map<string, FontCount>();
  for (const font of element.fonts) {
    const entry = counts.get(font.familyName) ?? { count: 0, isCustomFont: font.isCustomFont };
    entry.count += font.glyphCount;
    counts.set(font.familyName, entry);
  }
  for (const child of slide.elements) {
    if (child.parent !== element.id) {
      continue;
    }
    for (const font of child.fonts) {
      const entry = counts.get(font.familyName);
      if (entry) {
        entry.count = Math.max(0, entry.count - font.glyphCount);
      }
    }
  }
  return counts;
}

function fallbackGlyphs(
  slide: ProbeSlide,
  element: ProbeElement,
): { count: number; families: string[] } {
  const counts = ownFontCounts(slide, element);
  let drawn = 0;
  const families: string[] = [];
  for (const [family, { count, isCustomFont }] of counts) {
    if (isCustomFont || count === 0) {
      continue;
    }
    drawn += count;
    families.push(family);
  }
  const exempt = (element.snippet.match(EXEMPT) ?? []).length;
  return { count: Math.max(0, drawn - exempt), families };
}

function judgeGlyphs(
  probe: DeckProbe,
  only: FindingCategory[] | undefined,
  findings: Finding[],
): void {
  if (!wanted(only, "glyph")) {
    return;
  }

  for (const slide of probe.slides) {
    for (const el of slide.elements) {
      // Gate on hasOwnText, not just a nonzero count: `snippet` collapses to
      // "" for an element whose own direct children are whitespace-only text
      // nodes (see probe.ts's walk), which is exactly the case where an
      // element's only own contribution is generated content (e.g. a
      // ::after character) rather than real, quotable text. Reporting those
      // would point the author at nothing locatable. This does mean a
      // fallback glyph drawn purely by ::after/::before content on an
      // element with no real text of its own goes unreported — a known gap,
      // not silently absorbed: such content is rare, and the alternative
      // (reporting against an empty snippet) is worse for the deck author.
      if (!el.hasOwnText) {
        continue;
      }
      const { count, families } = fallbackGlyphs(slide, el);
      if (count === 0) {
        continue;
      }
      findings.push({
        severity: "warning",
        category: "glyph",
        theme: probe.theme,
        slideIndex: slide.index,
        slideSrc: slide.src,
        slideSrcSlide: slide.srcSlide,
        snippet: el.snippet,
        message: `${count} glyph${count === 1 ? "" : "s"} rendered by a system font (${families.join(", ")}), not a bundled one`,
        suggestion:
          "use characters covered by the bundled fonts (Montserrat, Roboto Mono), or bundle a face that covers this text",
      });
    }
  }
}

// Surfaces need either a luminance step (APCA clips small deltas to 0 near
// the poles, so RGB channel distance carries near-white/near-black cases) or
// a visible border/shadow to read as a distinct panel.
const SURFACE_MIN_RGB_DIST = 30;
const SURFACE_MIN_LC = 15;

function judgeSurfaceBlend(
  probe: DeckProbe,
  only: FindingCategory[] | undefined,
  findings: Finding[],
): void {
  if (!wanted(only, "surface")) {
    return;
  }

  for (const slide of probe.slides) {
    for (const el of slide.elements) {
      // Skip the slide root and elements with shadows, which need no separator.
      if (el.id === 0 || el.boxShadow !== "none") {
        continue;
      }

      // We need an actual background color on the element itself.
      const ownBgParsed = parseColor(el.backgroundColor);
      if (!ownBgParsed) {
        continue;
      }

      // Resolve the parent and bail if this element has no parent.
      const parent = el.parent === null ? undefined : slide.elements[el.parent];
      if (!parent) {
        continue;
      }

      // Measure the element against its parent's background, not against itself.
      const backdropResult = backdropFor(slide, parent);
      if (backdropResult.kind === "unverifiable") {
        continue;
      }

      const ownBg = ownBgParsed;
      const behindBg = backdropResult.color;

      // Check if the surface blends into its backdrop.
      const dist = rgbDistance(ownBg, behindBg);
      const lcSurface = Math.abs(contrastLc(ownBg, behindBg));

      // If the surface is distinct enough, no warning needed.
      if (dist >= SURFACE_MIN_RGB_DIST || lcSurface >= SURFACE_MIN_LC) {
        continue;
      }

      // Check if a visible border rescues the surface.
      if (
        el.borderWidthPx >= 1 &&
        el.borderColor &&
        rgbDistance(
          blend(parseColor(el.borderColor) || { r: 0, g: 0, b: 0, a: 1 }, behindBg),
          behindBg,
        ) >= SURFACE_MIN_RGB_DIST
      ) {
        continue;
      }

      findings.push({
        severity: "warning",
        category: "surface",
        theme: probe.theme,
        slideIndex: slide.index,
        slideSrc: slide.src,
        slideSrcSlide: slide.srcSlide,
        snippet: el.snippet,
        message: `surface ${toHex(ownBg)} blends into ${toHex(behindBg)} behind it (Δ${Math.round(dist)})`,
        suggestion: "use a stronger tint, or add a visible border or shadow",
      });
    }
  }
}

function judgeSvgText(
  probe: DeckProbe,
  only: FindingCategory[] | undefined,
  findings: Finding[],
): void {
  if (!wanted(only, "svg-text")) {
    return;
  }

  for (const slide of probe.slides) {
    if (slide.svgTextSnippets.length === 0) {
      continue;
    }

    // Report once per slide with the first SVG text snippet.
    const snippet = slide.svgTextSnippets[0]!;
    findings.push({
      severity: "warning",
      category: "svg-text",
      theme: probe.theme,
      slideIndex: slide.index,
      slideSrc: slide.src,
      slideSrcSlide: slide.srcSlide,
      snippet,
      message:
        "<text> in <svg> is audited as HTML — its fill and font-size attributes are invisible here",
      suggestion: "put the label in HTML positioned over the svg and keep the svg to shapes",
    });
  }
}

function judgeContrastAndTypeSize(
  probe: DeckProbe,
  only: FindingCategory[] | undefined,
  tokenContrast: TokenContrast | undefined,
  findings: Finding[],
): void {
  const wantsContrast = wanted(only, "contrast");
  const wantsTypeSize = wanted(only, "type-size");
  if (!wantsContrast && !wantsTypeSize) {
    return;
  }
  const themeContrast = tokenContrast?.[probe.theme];
  const suggest = (bgHex: string, sizePx: number, weight: number): string | null =>
    themeContrast ? suggestionFor(themeContrast, bgHex, sizePx, weight) : null;

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
          suggest(toHex(bg.color), sizePx, weight),
        );
      } else if (sizePx < req) {
        const target = neededLc(sizePx, weight);
        push(
          "error",
          "contrast",
          `${sizePx}px/${weight} text has contrast Lc ${lcAbs} (${pair}); needs ≥${req}px at this contrast${target === null ? "" : ` or Lc ≥ ${target} at this size`}`,
          suggest(toHex(bg.color), sizePx, weight),
        );
      }
    }
  }
}

// Ported from src/verify.ts's rectFailure. Kept as a local, pure copy rather
// than imported: verify.ts pulls in playwright-core and node:fs at module
// scope, and judge.ts must stay importable with none of that in its graph.
function rectFailure(
  rect: ProbeSlide["activeRect"],
  viewportWidth: number,
  viewportHeight: number,
): string | null {
  if (!rect) {
    return "active frame has no bounding rectangle";
  }
  const tolerance = 1;
  if (
    Math.abs(rect.x) > tolerance ||
    Math.abs(rect.y) > tolerance ||
    Math.abs(rect.width - viewportWidth) > tolerance ||
    Math.abs(rect.height - viewportHeight) > tolerance
  ) {
    return `active frame rect is ${rect.x},${rect.y},${rect.width},${rect.height}; expected viewport ${viewportWidth}x${viewportHeight}`;
  }
  return null;
}

// Ported from src/verify.ts's safeZoneFailureMessage. Kept as a local, pure
// copy rather than imported: verify.ts pulls in playwright-core and node:fs
// at module scope, and judge.ts must stay importable with none of that in
// its graph.
function safeZoneFailureMessage(
  item: SafeZoneItem,
  viewportWidth: number,
  viewportHeight: number,
  safeMargin: number,
): string | null {
  const edges: [string, number][] = [
    ["left", item.left],
    ["top", item.top],
    ["right", viewportWidth - item.right],
    ["bottom", viewportHeight - item.bottom],
  ];
  const intrusions = edges
    .filter(([, distance]) => distance < safeMargin)
    .map(([edge, distance]) => `${edge} (${Math.round(Math.max(0, distance))}px)`);
  if (intrusions.length === 0) {
    return null;
  }
  return `${item.label} enters the ${safeMargin}px print safe margin: ${intrusions.join(", ")}`;
}

// Deck-level structural findings (no slide of their own to attribute to) sit
// on slideIndex 1, mirroring how the CLI's later merge step will surface them.
function deckFinding(probe: DeckProbe, category: FindingCategory, message: string): Finding {
  return {
    severity: "error",
    category,
    theme: probe.theme,
    slideIndex: 1,
    slideSrc: null,
    slideSrcSlide: null,
    snippet: "",
    message,
    suggestion: null,
  };
}

/**
 * Ports every assertion `zerp verify` makes today (src/verify.ts's
 * `validateProbe`, lines 478-541) onto the probe/judge split: frame count
 * and identity, body overflow, the active inner slide's display, class and
 * bounding rect versus the viewport, the print safe-zone, and collected
 * browser errors. All fire at `error` severity — these are hard contract
 * violations, not style advice. Safe-zone checking stays off unless
 * `safeMargin` is supplied, matching `verify`'s `safeMargin > 0` gate on
 * the probe side.
 */
function judgeStructural(
  probe: DeckProbe,
  only: FindingCategory[] | undefined,
  safeMargin: number | undefined,
  findings: Finding[],
): void {
  const wantsFrame = wanted(only, "frame");
  const wantsOverflow = wanted(only, "overflow");
  const wantsSafeZone = wanted(only, "safe-zone");
  const wantsConsole = wanted(only, "console");
  if (!wantsFrame && !wantsOverflow && !wantsSafeZone && !wantsConsole) {
    return;
  }

  if (wantsConsole) {
    // Headless Chrome can fire the same window error twice (once from the
    // event, once from an unhandled-rejection echo); dedupe by message so a
    // single real fault does not read as a pile of findings.
    const seen = new Set<string>();
    for (const error of probe.browserErrors) {
      const message = `browser error: ${error}`;
      if (seen.has(message)) {
        continue;
      }
      seen.add(message);
      findings.push(deckFinding(probe, "console", message));
    }
  }

  if (wantsFrame) {
    if (probe.frameCount === 0) {
      findings.push(deckFinding(probe, "frame", "deck has no slide frames"));
    }
    if (probe.slideCount !== probe.frameCount) {
      findings.push(
        deckFinding(
          probe,
          "frame",
          `deck has ${probe.slideCount} .slide elements for ${probe.frameCount} slide frames`,
        ),
      );
    }
    if (probe.innerSlideCount !== probe.frameCount) {
      findings.push(
        deckFinding(
          probe,
          "frame",
          `deck has ${probe.innerSlideCount} framed slide roots for ${probe.frameCount} slide frames`,
        ),
      );
    }
  }

  for (const slide of probe.slides) {
    // Failures carry the source file when known, mirroring zerp check's file
    // attribution so a failure maps straight to the file to edit.
    const at = (category: FindingCategory, message: string): Finding => ({
      severity: "error",
      category,
      theme: probe.theme,
      slideIndex: slide.index,
      slideSrc: slide.src,
      slideSrcSlide: slide.srcSlide,
      snippet: "",
      message,
      suggestion: null,
    });

    if (wantsFrame) {
      if (slide.activeCount !== 1) {
        findings.push(at("frame", `expected one active frame, got ${slide.activeCount}`));
      }
      if (slide.visibleCount !== 1) {
        findings.push(at("frame", `expected one visible frame, got ${slide.visibleCount}`));
      }
      if (slide.activeIndex !== slide.index) {
        findings.push(at("frame", `active frame is ${slide.activeIndex ?? "missing"}`));
      }
      if (slide.activeDisplay === "none") {
        findings.push(at("frame", "active inner slide is display:none"));
      }
      if (!slide.activeClass) {
        findings.push(at("frame", "active inner slide is missing the active class"));
      }
      const rectMessage = rectFailure(slide.activeRect, slide.viewportWidth, slide.viewportHeight);
      if (rectMessage) {
        findings.push(at("frame", rectMessage));
      }
    }

    if (wantsOverflow && slide.bodyHeight > slide.viewportHeight + 1) {
      findings.push(at("overflow", `body height is ${slide.bodyHeight}px`));
    }

    if (wantsSafeZone && safeMargin !== undefined) {
      for (const item of slide.safeZoneItems ?? []) {
        const message = safeZoneFailureMessage(
          item,
          slide.viewportWidth,
          slide.viewportHeight,
          safeMargin,
        );
        if (message) {
          findings.push(at("safe-zone", message));
        }
      }
    }
  }
}

/**
 * Pure judgement over a recorded `DeckProbe`: no browser, no network, no
 * deck-directory filesystem access. Every rule category (contrast,
 * type-size, surface, svg-text, etc.) is gated behind `options.only` so
 * the CLI can narrow which checks run.
 */
export function judge(probe: DeckProbe, options: JudgeOptions = {}): Finding[] {
  const findings: Finding[] = [];
  judgeContrastAndTypeSize(probe, options.only, options.tokenContrast, findings);
  judgeSurfaceBlend(probe, options.only, findings);
  judgeSvgText(probe, options.only, findings);
  judgeGlyphs(probe, options.only, findings);
  judgeStructural(probe, options.only, options.safeMargin, findings);
  return findings;
}
