import { blend, parseColor, type Rgba } from "./color.js";
import type { CssModel, StyleRule } from "./css-model.js";
import type { DomElement } from "./types.js";

export interface ComputedText {
  color: string;
  /** Already var()-substituted, at the element that declared it. */
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  opacity: number;
}

export type BackgroundResult =
  | { kind: "color"; color: Rgba }
  | { kind: "unverifiable"; reason: string };

export interface SurfaceInfo {
  hasBackground: boolean;
  hasShadow: boolean;
  borderWidthPx: number;
  borderColor: Rgba | null;
}

/** A custom property's winning declaration; `owner` undefined means :root. */
interface VarHit {
  value: string;
  owner: DomElement | undefined;
}

const ROOT_PX = 16;
const VIEWPORT = { w: 1920, h: 1080 };

function parseSize(value: string, parentPx: number): number | null {
  const v = value.trim().toLowerCase();
  const num = Number.parseFloat(v);
  if (Number.isNaN(num)) {
    if (v === "larger") {
      return parentPx * 1.2;
    }
    if (v === "smaller") {
      return parentPx / 1.2;
    }
    return null;
  }
  if (v.endsWith("px")) {
    return num;
  }
  if (v.endsWith("rem")) {
    return num * ROOT_PX;
  }
  if (v.endsWith("em")) {
    return num * parentPx;
  }
  if (v.endsWith("%")) {
    return (num / 100) * parentPx;
  }
  if (v.endsWith("vmin")) {
    return (num / 100) * Math.min(VIEWPORT.w, VIEWPORT.h);
  }
  if (v.endsWith("vmax")) {
    return (num / 100) * Math.max(VIEWPORT.w, VIEWPORT.h);
  }
  if (v.endsWith("vh")) {
    return (num / 100) * VIEWPORT.h;
  }
  if (v.endsWith("vw")) {
    return (num / 100) * VIEWPORT.w;
  }
  return null;
}

function parseWeight(value: string, parentWeight: number): number {
  const v = value.trim().toLowerCase();
  if (v === "normal") {
    return 400;
  }
  if (v === "bold") {
    return 700;
  }
  if (v === "bolder") {
    return Math.min(900, parentWeight + 300);
  }
  if (v === "lighter") {
    return Math.max(100, parentWeight - 300);
  }
  const num = Number.parseFloat(v);
  return Number.isNaN(num) ? parentWeight : num;
}

function extractColor(value: string): Rgba | null {
  const direct = parseColor(value);
  if (direct) {
    return direct;
  }
  const candidates = value.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|\b[a-zA-Z]+\b/g) ?? [];
  for (const candidate of candidates) {
    const parsed = parseColor(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
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

export class StyleResolver {
  private readonly model: CssModel;
  private readonly vars: Map<string, string>;
  private readonly computedCache = new Map<DomElement, ComputedText>();
  private readonly ownCache = new Map<DomElement, Map<string, string>>();
  private readonly varCache = new Map<DomElement, Map<string, VarHit | null>>();

  constructor(model: CssModel, vars: Map<string, string>) {
    this.model = model;
    this.vars = vars;
  }

  /**
   * Substitute every `var()` in `value`. Pass the element the declaration
   * applies to, so custom properties declared anywhere in its ancestor chain
   * are visible; without one only `:root`/`html`/theme values are. A value
   * with no `var()` comes back untouched, so callers holding an already
   * substituted string can call this harmlessly.
   */
  resolveVars(value: string, el?: DomElement): string {
    return this.substitute(value, el, 0);
  }

  private substitute(value: string, el: DomElement | undefined, depth: number): string {
    let out = value;
    // The iteration cap is what stops a cyclic custom property (--a: var(--a))
    // from spinning; it bounds the nesting depth too, via `depth`.
    for (let i = 0; i < 8 && /var\(/.test(out); i++) {
      let changed = false;
      out = out.replace(
        /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*))?\)/g,
        (_whole, name: string, fallback: string | undefined) => {
          changed = true;
          const hit = this.lookupVar(el, name);
          if (!hit) {
            return fallback?.trim() ?? "unresolved";
          }
          if (depth >= 8) {
            return "unresolved";
          }
          // A custom property's own value substitutes at the element that
          // declared it, not at whoever reads it further down the tree.
          return this.substitute(hit.value, hit.owner, depth + 1);
        },
      );
      if (!changed) {
        break;
      }
    }
    return out;
  }

  /**
   * The winning declaration of a custom property for `el`: its own matched
   * declarations first, then each ancestor's (custom properties inherit),
   * then the `:root`/`html`/theme map. Memoized per element like the other
   * walks — decks read the same tokens on almost every element.
   */
  private lookupVar(el: DomElement | undefined, name: string): VarHit | null {
    if (!el) {
      const root = this.vars.get(name);
      return root === undefined ? null : { value: root, owner: undefined };
    }
    let cache = this.varCache.get(el);
    if (!cache) {
      cache = new Map();
      this.varCache.set(el, cache);
    }
    const cached = cache.get(name);
    if (cached !== undefined) {
      return cached;
    }
    let hit: VarHit | null = null;
    // Stop before the document element: `this.vars` already holds :root ∪
    // theme values in the correct precedence (css-model.ts merges a plain
    // `:root`/`html` block into both themes, then lets a `:root[data-zerp-
    // theme=…]` block override it). Walking into <html>'s own declarations
    // here would re-surface the pre-override plain :root value — html
    // matches the `:root` selector in linkedom — and that value would win
    // over the theme-specific one purely because the walk reaches it first.
    for (let node: DomElement | null = el; node?.parentElement; node = node.parentElement) {
      const declared = this.ownDeclarations(node).get(name);
      if (declared !== undefined) {
        hit = { value: declared, owner: node };
        break;
      }
    }
    hit ??= this.lookupVar(undefined, name);
    cache.set(name, hit);
    return hit;
  }

  private ownDeclarations(el: DomElement): Map<string, string> {
    const cached = this.ownCache.get(el);
    if (cached) {
      return cached;
    }
    const matched: StyleRule[] = [];
    for (const rule of this.model.rules) {
      // A ::before/::after rule styles the pseudo-element it renders, not the
      // originating element itself; letting it through here would tint every
      // matching element's computed style with content the DOM never shows.
      if (rule.pseudoElement !== null) {
        continue;
      }
      let ok = false;
      try {
        ok = el.matches(rule.selector);
      } catch {
        ok = false;
      }
      if (ok) {
        matched.push(rule);
      }
    }
    matched.sort(
      (x, y) =>
        x.specificity[0] - y.specificity[0] ||
        x.specificity[1] - y.specificity[1] ||
        x.specificity[2] - y.specificity[2] ||
        x.order - y.order,
    );
    const merged = new Map<string, string>();
    for (const rule of matched) {
      for (const [property, value] of rule.declarations) {
        if (property === "background") {
          merged.delete("background-color");
        }
        merged.set(property, value);
      }
    }
    const inline = el.getAttribute("style");
    if (inline) {
      for (const part of inline.split(";")) {
        const idx = part.indexOf(":");
        if (idx > 0) {
          const rawProperty = part.slice(0, idx).trim();
          // Custom properties are case-sensitive; only fold case for the
          // fixed CSS property vocabulary, matching css-model.ts's handling
          // of stylesheet declarations.
          const property = rawProperty.startsWith("--") ? rawProperty : rawProperty.toLowerCase();
          if (property === "background") {
            merged.delete("background-color");
          }
          merged.set(property, part.slice(idx + 1).trim());
        }
      }
    }
    this.ownCache.set(el, merged);
    return merged;
  }

  computedFor(el: DomElement): ComputedText {
    const cached = this.computedCache.get(el);
    if (cached) {
      return cached;
    }
    const parent = el.parentElement;
    const parentComputed: ComputedText = parent
      ? this.computedFor(parent)
      : {
          color: this.resolveVars(this.vars.get("--zerp-text") ?? "#000000"),
          fontFamily: this.resolveVars(this.vars.get("--zerp-font-body") ?? "sans-serif"),
          fontSizePx: ROOT_PX,
          fontWeight: 400,
          opacity: 1,
        };
    const own = this.ownDeclarations(el);
    const sizeRaw = own.get("font-size");
    const fontSizePx = sizeRaw
      ? (parseSize(this.resolveVars(sizeRaw, el), parentComputed.fontSizePx) ??
        parentComputed.fontSizePx)
      : parentComputed.fontSizePx;
    const weightRaw = own.get("font-weight");
    const fontWeight = weightRaw
      ? parseWeight(weightRaw, parentComputed.fontWeight)
      : parentComputed.fontWeight;
    // Substitution happens here, on the element the declaration applies to;
    // what inherits from the parent is its already substituted value, so a
    // descendant redefining the same custom property cannot reach back and
    // change it.
    const colorRaw = own.get("color");
    const color =
      !colorRaw || colorRaw === "inherit" ? parentComputed.color : this.resolveVars(colorRaw, el);
    const familyRaw = own.get("font-family");
    const fontFamily =
      !familyRaw || familyRaw === "inherit"
        ? parentComputed.fontFamily
        : this.resolveVars(familyRaw, el);
    const opacityRaw = Number.parseFloat(own.get("opacity") ?? "1");
    const opacity =
      parentComputed.opacity *
      (Number.isNaN(opacityRaw) ? 1 : Math.min(Math.max(opacityRaw, 0), 1));
    const computed: ComputedText = { color, fontFamily, fontSizePx, fontWeight, opacity };
    this.computedCache.set(el, computed);
    return computed;
  }

  backgroundFor(el: DomElement): BackgroundResult {
    const layers: Rgba[] = [];
    for (let node: DomElement | null = el; node; node = node.parentElement) {
      const own = this.ownDeclarations(node);
      const image = own.get("background-image");
      if (image && image !== "none") {
        return { kind: "unverifiable", reason: "background image/gradient" };
      }
      const raw = own.get("background-color") ?? own.get("background");
      if (!raw) {
        continue;
      }
      // Against `node`, not `el`: the declaration being read is this
      // ancestor's, so its custom properties resolve from where it sits.
      const resolved = this.resolveVars(raw, node);
      if (/url\(|gradient\(/i.test(resolved)) {
        return { kind: "unverifiable", reason: "background image/gradient" };
      }
      const trimmed = resolved.trim();
      if (trimmed === "none") {
        continue;
      }
      const color = extractColor(resolved);
      if (!color) {
        return { kind: "unverifiable", reason: `unparseable background "${raw}"` };
      }
      if (color.a >= 1) {
        return { kind: "color", color: compositeLayers(layers, color) };
      }
      layers.push(color);
    }
    const base = parseColor(this.vars.get("--zerp-bg") ?? "") ?? { r: 0, g: 0, b: 0, a: 1 };
    return { kind: "color", color: compositeLayers(layers, base) };
  }

  surfaceInfo(el: DomElement): SurfaceInfo {
    const own = this.ownDeclarations(el);
    const backgroundRaw = own.get("background-color") ?? own.get("background");
    const hasBackground =
      backgroundRaw !== undefined &&
      backgroundRaw.trim() !== "none" &&
      this.resolveVars(backgroundRaw, el).trim() !== "transparent";
    const shadow = own.get("box-shadow");
    const hasShadow = shadow !== undefined && shadow.trim() !== "none";
    const borderRaw = own.get("border");
    let borderWidthPx = 0;
    let borderColor: Rgba | null = null;
    if (borderRaw && borderRaw.trim() !== "none" && borderRaw.trim() !== "0") {
      const resolved = this.resolveVars(borderRaw, el);
      const widthMatch = resolved.match(/(\d+(?:\.\d+)?)px/);
      borderWidthPx = widthMatch ? Number.parseFloat(widthMatch[1] ?? "0") : 1;
      borderColor = extractColor(resolved);
    }
    const borderColorRaw = own.get("border-color");
    if (borderColorRaw) {
      borderColor = extractColor(this.resolveVars(borderColorRaw, el)) ?? borderColor;
      borderWidthPx = Math.max(borderWidthPx, 1);
    }
    const borderWidthRaw = own.get("border-width");
    if (borderWidthRaw) {
      const widthMatch = this.resolveVars(borderWidthRaw, el).match(/(\d+(?:\.\d+)?)px/);
      if (widthMatch) {
        borderWidthPx = Number.parseFloat(widthMatch[1] ?? "0");
      }
    }
    return { hasBackground, hasShadow, borderWidthPx, borderColor };
  }
}
