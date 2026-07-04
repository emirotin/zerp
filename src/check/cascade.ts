import { blend, parseColor, type Rgba } from "./color.js";
import type { CssModel, StyleRule } from "./css-model.js";
import type { DomElement } from "./types.js";

export interface ComputedText {
  color: string;
  fontSizePx: number;
  fontWeight: number;
  opacity: number;
}

export type BackgroundResult =
  | { kind: "color"; color: Rgba }
  | { kind: "unverifiable"; reason: string };

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

  constructor(model: CssModel, vars: Map<string, string>) {
    this.model = model;
    this.vars = vars;
  }

  resolveVars(value: string): string {
    let out = value;
    for (let i = 0; i < 8 && /var\(/.test(out); i++) {
      let changed = false;
      out = out.replace(
        /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,\s*([^()]*))?\)/g,
        (_whole, name: string, fallback: string | undefined) => {
          changed = true;
          return this.vars.get(name) ?? fallback?.trim() ?? "unresolved";
        },
      );
      if (!changed) {
        break;
      }
    }
    return out;
  }

  private ownDeclarations(el: DomElement): Map<string, string> {
    const cached = this.ownCache.get(el);
    if (cached) {
      return cached;
    }
    const matched: StyleRule[] = [];
    for (const rule of this.model.rules) {
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
          const property = part.slice(0, idx).trim().toLowerCase();
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
          color: this.vars.get("--zerp-text") ?? "#000000",
          fontSizePx: ROOT_PX,
          fontWeight: 400,
          opacity: 1,
        };
    const own = this.ownDeclarations(el);
    const sizeRaw = own.get("font-size");
    const fontSizePx = sizeRaw
      ? (parseSize(this.resolveVars(sizeRaw), parentComputed.fontSizePx) ??
        parentComputed.fontSizePx)
      : parentComputed.fontSizePx;
    const weightRaw = own.get("font-weight");
    const fontWeight = weightRaw
      ? parseWeight(weightRaw, parentComputed.fontWeight)
      : parentComputed.fontWeight;
    const colorRaw = own.get("color");
    const color = !colorRaw || colorRaw === "inherit" ? parentComputed.color : colorRaw;
    const opacityRaw = Number.parseFloat(own.get("opacity") ?? "1");
    const opacity =
      parentComputed.opacity *
      (Number.isNaN(opacityRaw) ? 1 : Math.min(Math.max(opacityRaw, 0), 1));
    const computed: ComputedText = { color, fontSizePx, fontWeight, opacity };
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
      const resolved = this.resolveVars(raw);
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
}
