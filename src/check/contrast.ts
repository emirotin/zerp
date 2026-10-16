import type { Rgba } from "./color.js";

export const MIN_WARN_PX = 16;
export const MIN_ERROR_PX = 14;

// WCAG 2.x defines large text as at least 18pt regular or 14pt bold.
// CSS uses 96px/in and 72pt/in, so those thresholds are 24px and 18.667px.
const LARGE_REGULAR_PX = 24;
const LARGE_BOLD_PX = 14 * (96 / 72);
const BOLD_WEIGHT = 700;
const NORMAL_TEXT_RATIO = 4.5;
const LARGE_TEXT_RATIO = 3;

function linearChannel(channel: number): number {
  const srgb = channel / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(color: Rgba): number {
  return (
    0.2126 * linearChannel(color.r) +
    0.7152 * linearChannel(color.g) +
    0.0722 * linearChannel(color.b)
  );
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const fgLuminance = relativeLuminance(fg);
  const bgLuminance = relativeLuminance(bg);
  const lighter = Math.max(fgLuminance, bgLuminance);
  const darker = Math.min(fgLuminance, bgLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function largeTextPx(weight: number): number {
  return weight >= BOLD_WEIGHT ? LARGE_BOLD_PX : LARGE_REGULAR_PX;
}

export function requiredPx(ratio: number, weight: number): number | null {
  if (ratio >= NORMAL_TEXT_RATIO) {
    return 0;
  }
  if (ratio >= LARGE_TEXT_RATIO) {
    return largeTextPx(weight);
  }
  return null;
}

export function neededRatio(px: number, weight: number): number {
  return px >= largeTextPx(weight) ? LARGE_TEXT_RATIO : NORMAL_TEXT_RATIO;
}
