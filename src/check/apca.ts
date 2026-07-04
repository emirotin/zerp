import { APCAcontrast, fontLookupAPCA, sRGBtoY } from "apca-w3";

import type { Rgba } from "./color.js";

export const MIN_WARN_PX = 16;
export const MIN_ERROR_PX = 14;
const UNUSABLE = 777;

export function contrastLc(fg: Rgba, bg: Rgba): number {
  const lc = APCAcontrast(sRGBtoY([fg.r, fg.g, fg.b]), sRGBtoY([bg.r, bg.g, bg.b]));
  return typeof lc === "string" ? Number.parseFloat(lc) : lc;
}

function weightIndex(weight: number): number {
  return Math.min(9, Math.max(1, Math.round(weight / 100)));
}

export function requiredPx(lc: number, weight: number): number | null {
  const row = fontLookupAPCA(Math.abs(lc));
  const value = row[weightIndex(weight)];
  const px = typeof value === "string" ? Number.parseFloat(value) : value;
  if (px === undefined || Number.isNaN(px) || px >= UNUSABLE) {
    return null;
  }
  return px;
}

export function neededLc(px: number, weight: number): number | null {
  for (let lc = 45; lc <= 105; lc += 1) {
    const req = requiredPx(lc, weight);
    if (req !== null && req <= px) {
      return lc;
    }
  }
  return null;
}
