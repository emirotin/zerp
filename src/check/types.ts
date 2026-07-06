export type CheckTheme = "dark" | "light";
export type Severity = "error" | "warning" | "unverifiable";
export interface Finding {
  severity: Severity;
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
  findings: Finding[];
  skippedSelectors: string[];
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
