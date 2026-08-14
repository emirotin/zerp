import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Optional deck settings, read from a `zerp` key in the deck's package.json.
 *
 * A deck is discovered from a directory containing `slides/` and needs no
 * configuration at all; this is for the one thing a deck cannot express any
 * other way without forking the framework — which typefaces it is set in. It
 * lives in package.json rather than a file of its own because the deck already
 * has a manifest, and because the font packages it names have to be
 * dependencies of that same manifest to be resolvable.
 */
export interface DeckFontConfig {
  /** Family name as the `@font-face` declares it, e.g. "JetBrains Mono". */
  family: string;
  /** Defaults to `@fontsource/<family slugified>`. */
  fontsourcePackage?: string;
  /** fontsource file stems: "400", "700", "400-italic". */
  weights?: string[];
}

export interface DeckConfig {
  fonts?: {
    body?: DeckFontConfig;
    display?: DeckFontConfig;
    mono?: DeckFontConfig;
  };
}

const FONT_ROLES = ["body", "display", "mono"];
const FONT_KEYS = ["family", "fontsourcePackage", "weights"];

function fail(message: string): never {
  throw new Error(`Invalid "zerp" config in package.json: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Unknown keys are rejected rather than ignored: the whole surface is five
// names, and a silently ignored typo would look exactly like zerp deciding not
// to honor the config.
function checkKeys(value: Record<string, unknown>, allowed: string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      fail(`unknown key "${key}" in ${where} (expected ${allowed.join(", ")})`);
    }
  }
}

function parseFont(value: unknown, role: string): DeckFontConfig {
  if (!isRecord(value)) {
    fail(`fonts.${role} must be an object`);
  }
  checkKeys(value, FONT_KEYS, `fonts.${role}`);
  const { family, fontsourcePackage, weights } = value;
  if (typeof family !== "string" || family.trim() === "") {
    fail(`fonts.${role}.family must be the family name the font declares`);
  }
  if (fontsourcePackage !== undefined && typeof fontsourcePackage !== "string") {
    fail(`fonts.${role}.fontsourcePackage must be a package name`);
  }
  if (
    weights !== undefined &&
    (!Array.isArray(weights) || weights.some((weight) => typeof weight !== "string"))
  ) {
    fail(`fonts.${role}.weights must be an array of strings like "400" or "400-italic"`);
  }
  return {
    family,
    ...(typeof fontsourcePackage === "string" ? { fontsourcePackage } : {}),
    ...(weights === undefined ? {} : { weights: weights as string[] }),
  };
}

function parseConfig(value: unknown): DeckConfig {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    fail("it must be an object");
  }
  checkKeys(value, ["fonts"], "zerp");
  const fonts = value.fonts;
  if (fonts === undefined) {
    return {};
  }
  if (!isRecord(fonts)) {
    fail("fonts must be an object");
  }
  checkKeys(fonts, FONT_ROLES, "fonts");
  const parsed: DeckConfig = { fonts: {} };
  for (const role of FONT_ROLES) {
    if (fonts[role] !== undefined) {
      Object.assign(parsed.fonts ?? {}, { [role]: parseFont(fonts[role], role) });
    }
  }
  return parsed;
}

/**
 * Read a deck's `zerp` settings. A deck with no package.json, or none with a
 * `zerp` key, is configured — with the defaults.
 */
export async function readDeckConfig(rootDir: string): Promise<DeckConfig> {
  const manifestPath = path.join(path.resolve(rootDir), "package.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    return {};
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    // Loud rather than silent: a manifest that does not parse may well be the
    // one carrying the config, and pretending it said nothing would ship a
    // deck in the wrong typeface.
    throw new Error(
      `Could not parse ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseConfig(isRecord(manifest) ? manifest.zerp : undefined);
}
