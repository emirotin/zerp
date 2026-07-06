import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { APCAcontrast, sRGBtoY } from "apca-w3";

const require = createRequire(import.meta.url);

const HUES = ["blue", "green", "orange", "purple", "red", "amber", "teal"];
// Harmony's "green" hue (123°) reads olive/lime in UI accents; zerp's green draws from emerald.
const SOURCE_HUES = { green: "emerald" };
const SEMANTIC = { accent: "blue", ok: "green", warn: "amber", danger: "red" };
const NEUTRAL_STEPS = {
  dark: { bg: "950", surface: "900", border: "800", text: "100", muted: "300", faint: "600" },
  light: { bg: "100", surface: "50", border: "300", text: "900", muted: "700", faint: "400" },
};
const HUE_STEPS = {
  dark: { text: "400", solid: "600", tint: "900", onTint: "200" },
  light: { text: "600", solid: "600", tint: "200", onTint: "800" },
};

async function loadHueHex(hue) {
  const cssPath = require.resolve(`@evilmartians/harmony/css/${hue}.css`);
  const css = await readFile(cssPath, "utf8");
  const supportsIndex = css.indexOf("@supports");
  const rootBlock = supportsIndex === -1 ? css : css.slice(0, supportsIndex);
  const steps = {};
  for (const match of rootBlock.matchAll(/--[a-z]+-(\d+)\s*:\s*(#[0-9a-fA-F]{6})/g)) {
    steps[match[1]] = match[2].toLowerCase();
  }
  return steps;
}

async function loadPalette() {
  const entries = await Promise.all(
    [...HUES, "gray"].map(async (hue) => [hue, await loadHueHex(SOURCE_HUES[hue] ?? hue)]),
  );
  return Object.fromEntries(entries);
}

const SHADOW = {
  dark: "0 8px 24px rgb(0 0 0 / 0.55)",
  light: "0 8px 24px rgb(0 0 0 / 0.18)",
};

function themeTokens(palette, theme) {
  const tokens = {};
  for (const [name, step] of Object.entries(NEUTRAL_STEPS[theme])) {
    tokens[`--zerp-${name}`] = palette.gray[step];
  }
  for (const hue of HUES) {
    const steps = HUE_STEPS[theme];
    tokens[`--zerp-${hue}`] = palette[hue][steps.text];
    tokens[`--zerp-${hue}-solid`] = palette[hue][steps.solid];
    tokens[`--zerp-${hue}-tint`] = palette[hue][steps.tint];
    tokens[`--zerp-${hue}-on-tint`] = palette[hue][steps.onTint];
  }
  tokens["--zerp-on-solid"] = palette.gray["50"];
  tokens["--zerp-shadow"] = SHADOW[theme];
  for (const [semantic, hue] of Object.entries(SEMANTIC)) {
    tokens[`--zerp-${semantic}`] = tokens[`--zerp-${hue}`];
  }
  return tokens;
}

function cssBlock(selector, tokens, scheme) {
  const body = Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `${selector} {
  color-scheme: ${scheme};
${body}
}`;
}

export async function generateTokensCss() {
  const palette = await loadPalette();
  const dark = themeTokens(palette, "dark");
  const light = themeTokens(palette, "light");
  const systemSelector = ':root[data-zerp-theme="system"],\n:root:not([data-zerp-theme])';
  return [
    "/* Generated from @evilmartians/harmony - do not edit by hand. */",
    cssBlock(':root[data-zerp-theme="dark"]', dark, "dark"),
    cssBlock(':root[data-zerp-theme="light"]', light, "light"),
    `@media (prefers-color-scheme: dark) {\n${cssBlock(systemSelector, dark, "dark")}\n}`,
    `@media (prefers-color-scheme: light) {\n${cssBlock(systemSelector, light, "light")}\n}`,
  ].join("\n\n");
}

function lcBetween(fgHex, bgHex) {
  const rgb = (hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
  const lc = APCAcontrast(sRGBtoY(rgb(fgHex)), sRGBtoY(rgb(bgHex)));
  return Math.round((typeof lc === "string" ? Number.parseFloat(lc) : lc) * 10) / 10;
}

export async function generateTokenContrast() {
  const palette = await loadPalette();
  const result = {};
  for (const theme of ["dark", "light"]) {
    const tokens = themeTokens(palette, theme);
    const bg = { "--zerp-bg": tokens["--zerp-bg"], "--zerp-surface": tokens["--zerp-surface"] };
    for (const hue of HUES) bg[`--zerp-${hue}-tint`] = tokens[`--zerp-${hue}-tint`];
    const fg = { "--zerp-text": tokens["--zerp-text"], "--zerp-muted": tokens["--zerp-muted"] };
    for (const hue of HUES) {
      fg[`--zerp-${hue}`] = tokens[`--zerp-${hue}`];
      fg[`--zerp-${hue}-on-tint`] = tokens[`--zerp-${hue}-on-tint`];
    }
    const lc = {};
    for (const [bgToken, bgHex] of Object.entries(bg)) {
      lc[bgToken] = {};
      for (const [fgToken, fgHex] of Object.entries(fg)) {
        lc[bgToken][fgToken] = lcBetween(fgHex, bgHex);
      }
    }
    result[theme] = { bg, fg, lc };
  }
  return result;
}
