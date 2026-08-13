export type CheckTheme = "dark" | "light";
export type Severity = "error" | "warning" | "unverifiable";
// The runtime list backs the type so both stay in sync automatically — the
// CLI's `--only` validation needs the values at runtime, not just the type.
export const FINDING_CATEGORIES = [
  "contrast",
  "type-size",
  "surface",
  "glyph",
  "svg-text",
  "frame",
  "overflow",
  "safe-zone",
  "console",
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export interface Finding {
  severity: Severity;
  category: FindingCategory;
  theme: CheckTheme;
  slideIndex: number;
  slideSrc: string | null;
  slideSrcSlide: string | null;
  snippet: string;
  message: string;
  suggestion: string | null;
}
export interface CheckReport {
  slideCount: number;
  themes: CheckTheme[];
  findings: Finding[];
}
export interface DomNode {
  nodeType: number;
  textContent: string | null;
}
export interface DomElement extends DomNode {
  tagName: string;
  parentElement: DomElement | null;
  childNodes: { length: number; [index: number]: DomNode | undefined };
  getAttribute(name: string): string | null;
  matches(selector: string): boolean;
}
