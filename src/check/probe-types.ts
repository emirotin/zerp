import type { SafeZoneItem } from "../verify.js";

export type { SafeZoneItem };

export interface ProbeElement {
  /** Stable within one slide; assigned by the in-page walk. */
  id: number;
  tag: string; // lowercase
  className: string | null;
  snippet: string; // collapsed text, ≤40 chars with ellipsis
  hasOwnText: boolean; // has a non-whitespace direct text child
  color: string; // computed, always rgb()/rgba()
  backgroundColor: string;
  backgroundImage: string;
  fontSizePx: number;
  fontWeight: number;
  opacity: number;
  boxShadow: string;
  borderWidthPx: number;
  borderColor: string;
  /** Index into the slide's element list, or null for the slide root. */
  parent: number | null;
  /** Populated in Task 5; empty until then. */
  fonts: ProbeFont[];
}

export interface ProbeFont {
  familyName: string;
  glyphCount: number;
  isCustomFont: boolean;
}

export interface ProbeSlide {
  index: number; // 1-based, matches today's Finding.slideIndex
  src: string | null;
  srcSlide: string | null;
  elements: ProbeElement[];
  activeCount: number;
  visibleCount: number;
  activeIndex: number | null;
  bodyHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  activeDisplay: string | null;
  activeClass: boolean;
  activeRect: { x: number; y: number; width: number; height: number } | null;
  safeZoneItems: SafeZoneItem[] | null;
  svgTextSnippets: string[];
  /**
   * The document's own computed background (`getComputedStyle(document.body)`),
   * where the theme background actually lives — `.slide` itself carries no
   * background rule. judge.ts's contrast/surface backdrop walk falls back to
   * this when no ancestor inside the slide has an opaque background, instead
   * of assuming a color it was never told.
   */
  pageBackgroundColor: string;
}

export interface DeckProbe {
  theme: "dark" | "light";
  width: number;
  height: number;
  sizeDefaulted: boolean;
  frameCount: number;
  slideCount: number;
  innerSlideCount: number;
  slides: ProbeSlide[];
  browserErrors: string[];
}

export interface ProbeOptions {
  rootDir: string;
  theme: "dark" | "light";
  width: number;
  height: number;
  safeMargin: number;
  timeoutMs: number;
  sizeDefaulted?: boolean;
  browserEndpoint?: string;
}
