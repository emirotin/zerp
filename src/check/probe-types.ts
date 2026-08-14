import type { SafeZoneItem } from "../verify.js";

export type { SafeZoneItem };

export interface ProbeElement {
  /** Stable within one slide; assigned by the in-page walk. */
  id: number;
  tag: string; // lowercase
  className: string | null;
  snippet: string; // collapsed text, ≤40 chars with ellipsis
  hasOwnText: boolean; // has a non-whitespace direct text child
  /**
   * Concatenated ::before/::after generated text, resolved by the browser
   * (`content: attr(data-vs)` arrives here as its attribute's value). Optional
   * so hand-authored probes in tests stay valid; absent means "not recorded",
   * which judge.ts treats as empty.
   */
  pseudoText?: string;
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
  /** Per-family glyph counts from CDP's CSS.getPlatformFontsForNode. */
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
  /**
   * The document's own computed `background-image` (`getComputedStyle(document.body)`).
   * A deck that paints the page via a gradient or image resets `background-color`
   * to a transparent value that parses fine, so judge.ts cannot tell "no page
   * background was declared" from "the color channel alone". This field is
   * judge.ts's signal that the true backdrop is not a flat color at all, and
   * anything measured against it must be reported `unverifiable` instead.
   * Optional so hand-authored probes in tests stay valid; absent means "not
   * recorded", which judge.ts treats as no image.
   */
  pageBackgroundImage?: string;
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
