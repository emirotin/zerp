# zerp Design-System Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace zerp's hardcoded palette with Harmony-derived light/dark theme tokens, expand the built-in CSS so LLM-authored decks need near-zero custom styling, and add a static APCA contrast checker (`zerp check`) wired into the CLI, docs, and examples.

**Architecture:** A build-time generator derives all color tokens (hex) from `@evilmartians/harmony` and prepends them to a hand-authored token-only base stylesheet; the browser runtime gains a 3-position theme switch. A new `src/check/` module parses built deck HTML with linkedom, resolves effective styles with a purpose-built cascade engine (css-tree for parsing), and evaluates every text node with `apca-w3` against both themes.

**Tech Stack:** TypeScript (strict, NodeNext, ESM), Node 24 `node:test`, `marked` (existing), new runtime deps `apca-w3` + `css-tree` + `linkedom`, new dev dep `@evilmartians/harmony`.

**Spec:** `docs/superpowers/specs/2026-07-04-design-system-evolution-design.md` (approved). Work happens on the existing `v1` branch.

## Global Constraints

- Node 24.14.1 / pnpm 10.33.0 (Volta-pinned); ESM only (`"type": "module"`); TS imports use `.js` specifiers.
- tsconfig is `strict` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` — guard all indexed access; pass optional props conditionally.
- No DOM lib in tsconfig: checker code must use the structural `DomElement`/`DomNode` interfaces from `src/check/types.ts`, never `lib.dom` types.
- `oxlint --deny-warnings` and `oxfmt` must pass; pre-commit runs `pnpm lint-staged` + `pnpm build`.
- `dist/` is gitignored — never commit it. Tests import from `dist/` (the `test` script builds first).
- `src/assets/base-styles.css` may contain **no raw color values** — only `var(--zerp-*)` references. Generated token CSS is the only hex source.
- Commit messages: short imperative sentence, no conventional-commit prefix (match `git log`), each ending with trailer line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Allowed new dependencies, exactly: runtime `apca-w3`, `css-tree`, `linkedom`; dev `@evilmartians/harmony`. Nothing else.

## Deviations from spec (verified during planning)

1. **Token source:** Harmony's npm `base` export is oklch-only, but its `css/<hue>.css` files ship plain sRGB hex fallbacks (e.g. `--gray-950:#12141c`). The generator parses those hex values; **hex only** is emitted (no oklch/P3 block — YAGNI, and it keeps the checker trivial).
2. **`fontLookupAPCA(65)` at weight 400 requires 21.75px**, so Lc-65 accent text at body size fails at normal weight. Therefore **all color utility classes set `font-weight: 700`** (colored text = emphasis).
3. **`-on-tint` role added** (dark: step 200, light: step 800) so pills/tinted surfaces have a guaranteed text pairing. Public tokens: 6 neutrals + 7×4 hue roles + `--zerp-on-solid` + 4 semantic aliases = **39** (spec said 32).
4. Verified reference numbers for tests: `calcAPCA("#fff","#000") = -107.88…`, `fontLookupAPCA(75)` row `[.., @400 → 18, ..]`, `fontLookupAPCA` sentinel `777` = unusable, gray-950 `#12141c`, gray-100 `#f0f3ff`, gray-50 `#fafbfe`.

## File Structure

| Path | Responsibility |
|---|---|
| `scripts/generate-tokens.mjs` | NEW — Harmony hex extraction, theme token tables, tokens CSS + token-contrast JSON generation |
| `scripts/build.mjs` | MODIFY — call generator, concat tokens + base CSS into `dist/assets/default-styles.css`, emit `dist/check/token-contrast.json` |
| `src/assets/base-styles.css` | NEW (replaces `default-styles.css`) — hand-authored token-referencing stylesheet |
| `src/assets/default-styles.css` | DELETE in Task 2 |
| `src/assets/default-runtime.js` | MODIFY — theme manager + switch wiring + `t` key |
| `src/presentation.ts` | MODIFY — `theme` option, html attrs, fonts URL, `data-zerp-src` injection, theme-switch markup |
| `src/cli.ts` | MODIFY — `parseArgs`, `--theme`, `check` command, `--strict` |
| `src/server.ts` | MODIFY — theme pass-through, post-build check summary |
| `src/index.ts` | MODIFY — export checker API |
| `src/check/types.ts` | NEW — `CheckTheme`, `Severity`, `Finding`, `CheckReport`, `DomNode`, `DomElement` |
| `src/check/vendor.d.ts` | NEW — module declarations for `css-tree`, `apca-w3`, `linkedom` |
| `src/check/color.ts` | NEW — `Rgba`, `parseColor`, `blend`, `toHex` |
| `src/check/apca.ts` | NEW — `contrastLc`, `requiredPx`, `neededLc`, floor constants |
| `src/check/css-model.ts` | NEW — `parseStylesheets` → rules + theme var maps + skipped selectors |
| `src/check/cascade.ts` | NEW — `StyleResolver` (computed text props, background resolution, var substitution) |
| `src/check/checker.ts` | NEW — `checkPresentation` orchestration |
| `src/check/report.ts` | NEW — `formatReport`, `reportHasFailures` |
| `test/*.test.mjs` | NEW — node:test suites (import from `dist/` and `scripts/`) |
| `test/fixtures/{clean-deck,broken-deck,kitchen-sink}/slides/…` | NEW — fixture decks |
| `examples/casino/slides/*` | MODIFY — migrate to new classes/tokens |
| `llms.txt`, `README.md`, `CLAUDE.md`, `AGENTS.md`, `MIGRATION.md`, `CHANGELOG.md`, `package.json` | MODIFY/NEW — docs + v0.2.0 |

---

### Task 1: Harmony token generator

**Files:**
- Modify: `package.json` (deps, `test` script, lint targets)
- Create: `scripts/generate-tokens.mjs`
- Test: `test/generate-tokens.test.mjs`

**Interfaces:**
- Produces: `generateTokensCss(): Promise<string>` and `generateTokenContrast(): Promise<{dark: ThemeContrastData, light: ThemeContrastData}>` where `ThemeContrastData = { bg: Record<token,hex>, fg: Record<token,hex>, lc: Record<bgToken, Record<fgToken, number>> }`. Task 2 wires both into the build; Task 7 reads the JSON at runtime.
- Token names: neutrals `--zerp-bg|surface|border|text|muted|faint`; per hue (`blue green orange purple red amber teal`): `--zerp-<hue>`, `--zerp-<hue>-solid`, `--zerp-<hue>-tint`, `--zerp-<hue>-on-tint`; shared `--zerp-on-solid`; semantic `--zerp-accent|ok|warn|danger`.
- Steps: dark text/solid/tint/on-tint = 400/600/900/200; light = 600/600/100/800. Neutral steps dark = 950/900/800/100/300/600, light = 100/50/300/900/700/400 (gray hue).

- [ ] **Step 1: Install dependencies and update scripts**

```bash
pnpm add apca-w3 css-tree linkedom
pnpm add -D @evilmartians/harmony
```

In `package.json` scripts, add and adjust:

```json
"test": "pnpm build && node --test test/",
"lint": "oxlint --deny-warnings --node-plugin --import-plugin src scripts test .zed",
"lint:fix": "oxlint --fix --deny-warnings --node-plugin --import-plugin src scripts test .zed",
```

- [ ] **Step 2: Write the failing test** — `test/generate-tokens.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTokenContrast, generateTokensCss } from "../scripts/generate-tokens.mjs";

test("tokens CSS defines both explicit themes and system fallbacks", async () => {
  const css = await generateTokensCss();
  assert.match(css, /:root\[data-zerp-theme="dark"\]/);
  assert.match(css, /:root\[data-zerp-theme="light"\]/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /@media \(prefers-color-scheme: light\)/);
  assert.match(css, /:root:not\(\[data-zerp-theme\]\)/);
});

test("dark theme uses Harmony gray-950 background and gray-100 text", async () => {
  const css = await generateTokensCss();
  const darkBlock = css.split(':root[data-zerp-theme="light"]')[0];
  assert.match(darkBlock, /--zerp-bg: #12141c;/);
  assert.match(darkBlock, /--zerp-text: #f0f3ff;/);
  assert.match(darkBlock, /--zerp-on-solid: #fafbfe;/);
  assert.match(darkBlock, /color-scheme: dark;/);
});

test("every theme exposes all 39 tokens", async () => {
  const css = await generateTokensCss();
  for (const theme of ["dark", "light"]) {
    const block = css.match(new RegExp(`:root\\[data-zerp-theme="${theme}"\\] \\{[^}]*\\}`))[0];
    assert.equal((block.match(/--zerp-/g) ?? []).length, 39);
    for (const hue of ["blue", "green", "orange", "purple", "red", "amber", "teal"]) {
      for (const suffix of ["", "-solid", "-tint", "-on-tint"]) {
        assert.match(block, new RegExp(`--zerp-${hue}${suffix}: #[0-9a-f]{6};`));
      }
    }
  }
});

test("token contrast table has signed Lc values per background", async () => {
  const contrast = await generateTokenContrast();
  const darkTextOnBg = contrast.dark.lc["--zerp-bg"]["--zerp-text"];
  assert.ok(darkTextOnBg < -90, `expected strong negative Lc, got ${darkTextOnBg}`);
  const lightTextOnBg = contrast.light.lc["--zerp-bg"]["--zerp-text"];
  assert.ok(lightTextOnBg > 90, `expected strong positive Lc, got ${lightTextOnBg}`);
  assert.ok(Math.abs(contrast.dark.lc["--zerp-surface"]["--zerp-muted"]) > 60);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/generate-tokens.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/generate-tokens.mjs'`

- [ ] **Step 4: Implement** — `scripts/generate-tokens.mjs`:

```js
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { APCAcontrast, sRGBtoY } from "apca-w3";

const require = createRequire(import.meta.url);

const HUES = ["blue", "green", "orange", "purple", "red", "amber", "teal"];
const SEMANTIC = { accent: "blue", ok: "green", warn: "amber", danger: "red" };
const NEUTRAL_STEPS = {
  dark: { bg: "950", surface: "900", border: "800", text: "100", muted: "300", faint: "600" },
  light: { bg: "100", surface: "50", border: "300", text: "900", muted: "700", faint: "400" },
};
const HUE_STEPS = {
  dark: { text: "400", solid: "600", tint: "900", onTint: "200" },
  light: { text: "600", solid: "600", tint: "100", onTint: "800" },
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
  const entries = await Promise.all([...HUES, "gray"].map(async (hue) => [hue, await loadHueHex(hue)]));
  return Object.fromEntries(entries);
}

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
  for (const [semantic, hue] of Object.entries(SEMANTIC)) {
    tokens[`--zerp-${semantic}`] = tokens[`--zerp-${hue}`];
  }
  return tokens;
}

function cssBlock(selector, tokens, scheme) {
  const body = Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `${selector} {\n  color-scheme: ${scheme};\n${body}\n}`;
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/generate-tokens.test.mjs`
Expected: PASS (4 tests). If the 39-count assertion fails, count: 6 neutrals + 28 hue roles + 1 on-solid + 4 semantic = 39.

- [ ] **Step 6: Lint, format, commit**

```bash
pnpm lint && pnpm format
git add package.json pnpm-lock.yaml scripts/generate-tokens.mjs test/generate-tokens.test.mjs
git commit -m "Add Harmony token generator

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Base stylesheet and build wiring

**Files:**
- Create: `src/assets/base-styles.css`
- Delete: `src/assets/default-styles.css`
- Modify: `scripts/build.mjs`
- Test: `test/build-output.test.mjs`

**Interfaces:**
- Consumes: `generateTokensCss`, `generateTokenContrast` from Task 1.
- Produces: `dist/assets/default-styles.css` (tokens + base concatenated — `src/presentation.ts` keeps reading this exact path) and `dist/check/token-contrast.json` (read by Task 7's checker via `new URL("./token-contrast.json", import.meta.url)`).
- CSS class surface (used by Tasks 7, 9, 10): components `.card .cols-2 .cols-3 .cols-4 .stat .stat-row .compare .flow .steps .timeline .key-thought .pill .interactive-badge .block-label .img-row .grid-demo`; utilities `.center .row .stack .spread .grow .lg .xl .sm .mono .muted .accent .ok .warn .danger .blue .green .orange .purple .red .amber .teal .tint-<hue>`; removed classes `.two-col .big-number .quote .accent-green .accent-orange .accent-purple .accent-red`.

- [ ] **Step 1: Write the failing test** — `test/build-output.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("built default stylesheet = generated tokens + token-free base styles", async () => {
  const css = await readFile("dist/assets/default-styles.css", "utf8");
  assert.match(css, /--zerp-bg: #12141c;/);
  assert.match(css, /\.card \{/);
  assert.match(css, /\.stat-row \{/);
  const afterTokens = css.split("/* base styles */")[1];
  assert.ok(afterTokens, "base styles marker present");
  assert.doesNotMatch(afterTokens, /#[0-9a-fA-F]{3,8}\b/, "no raw hex outside generated tokens");
  assert.doesNotMatch(css, /\.two-col|\.big-number|\.accent-green/, "0.1.x classes removed");
});

test("token contrast json is emitted for the checker", async () => {
  const json = JSON.parse(await readFile("dist/check/token-contrast.json", "utf8"));
  assert.ok(json.dark.lc["--zerp-bg"]["--zerp-muted"] < -60);
  assert.equal(json.light.bg["--zerp-surface"], "#fafbfe");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build && node --test test/build-output.test.mjs`
Expected: FAIL — no `--zerp-bg: #12141c` / missing `dist/check/token-contrast.json`.

- [ ] **Step 3: Create `src/assets/base-styles.css`** (delete `src/assets/default-styles.css` in the same step). Full content:

```css
/* base styles */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* Tokens are generated from @evilmartians/harmony and prepended at build
   time. Only var(--zerp-*) color references are allowed in this file. */

html,
body {
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: var(--zerp-bg);
  color: var(--zerp-text);
  font-family: "Montserrat", sans-serif;
}

b,
strong {
  font-weight: 700;
}

em,
i {
  font-style: italic;
}

img,
video {
  max-width: 100%;
}

img {
  border-radius: 10px;
  object-fit: contain;
  max-height: 60vh;
}

a {
  color: var(--zerp-accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

hr {
  border: none;
  border-top: 1px solid var(--zerp-border);
  margin: 20px 0;
}

.slide {
  display: none;
  width: 100vw;
  height: 100vh;
  padding: 50px 70px;
  flex-direction: column;
  justify-content: center;
  position: relative;
}

.slide.active {
  display: flex;
}

.slide.top {
  justify-content: flex-start;
}

.slide h1 {
  font-size: 3.2em;
  font-weight: 900;
  line-height: 1.15;
  margin-bottom: 20px;
}

.slide h2 {
  font-size: 2.2em;
  font-weight: 700;
  line-height: 1.2;
  margin-bottom: 14px;
}

.slide h3 {
  font-size: 1.4em;
  font-weight: 700;
  margin-bottom: 10px;
  color: var(--zerp-muted);
}

.slide p,
.slide li {
  font-size: 1.25em;
  line-height: 1.5;
}

.slide ul {
  list-style: none;
  padding: 0;
}

.slide li {
  padding: 5px 0;
}

.slide ul li::before {
  content: "→ ";
  color: var(--zerp-accent);
}

.slide ol {
  list-style: none;
  padding: 0;
  counter-reset: zerp-ol;
}

.slide ol > li {
  counter-increment: zerp-ol;
  display: flex;
  align-items: baseline;
  gap: 16px;
  border-bottom: 1px solid var(--zerp-border);
  padding: 10px 0;
}

.slide ol > li:last-child {
  border-bottom: none;
}

.slide ol > li::before {
  content: counter(zerp-ol, decimal-leading-zero);
  font-family: "Roboto Mono", monospace;
  font-size: 1.2em;
  font-weight: 700;
  color: var(--zerp-accent);
}

code,
kbd {
  font-family: "Roboto Mono", monospace;
  font-size: 0.95em;
  background: var(--zerp-surface);
  border-radius: 6px;
  padding: 2px 8px;
}

kbd {
  border: 1px solid var(--zerp-border);
}

pre {
  background: var(--zerp-surface);
  border: 1px solid var(--zerp-border);
  border-radius: 10px;
  padding: 18px 24px;
  margin: 16px 0;
  overflow: auto;
  text-align: left;
}

pre code {
  background: none;
  padding: 0;
  font-size: 1.05em;
  line-height: 1.6;
}

blockquote {
  border-left: 4px solid var(--zerp-accent);
  padding: 14px 20px;
  margin: 16px 0;
  background: var(--zerp-surface);
  border-radius: 0 10px 10px 0;
  font-style: italic;
  font-size: 1.2em;
}

blockquote p {
  font-size: 1em;
}

table {
  border-collapse: collapse;
  margin: 16px auto;
  font-size: 1.15em;
}

th,
td {
  padding: 10px 18px;
  text-align: left;
}

th {
  font-weight: 700;
  border-bottom: 2px solid var(--zerp-border);
}

td {
  border-bottom: 1px solid var(--zerp-border);
}

tr:last-child td {
  border-bottom: none;
}

table.mono td {
  font-family: "Roboto Mono", monospace;
}

figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  margin: 16px 0;
}

figure img {
  max-height: 55vh;
}

figcaption,
.caption {
  font-size: 1.2em;
  color: var(--zerp-muted);
  text-align: center;
}

.card {
  background: var(--zerp-surface);
  border: 1px solid var(--zerp-border);
  border-radius: 14px;
  padding: 24px 28px;
}

.cols-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  align-items: center;
}

.cols-3 {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 32px;
  align-items: center;
}

.cols-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
  align-items: center;
}

.stat {
  text-align: center;
}

.stat .value {
  font-family: "Roboto Mono", monospace;
  font-size: 3em;
  font-weight: 900;
  color: var(--zerp-accent);
  line-height: 1.1;
}

.stat .label {
  font-size: 1.2em;
  color: var(--zerp-muted);
  margin-top: 6px;
}

.stat-row {
  display: flex;
  gap: 48px;
  align-items: flex-end;
  justify-content: center;
  flex-wrap: wrap;
  margin: 24px 0;
}

.compare {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  gap: 30px;
  align-items: center;
  margin: 24px 0;
}

.compare > :first-child {
  grid-column: 1;
  grid-row: 1;
}

.compare > :last-child {
  grid-column: 3;
  grid-row: 1;
}

.compare::after {
  content: "vs";
  grid-column: 2;
  grid-row: 1;
  font-size: 1.6em;
  font-weight: 900;
  color: var(--zerp-faint);
}

.compare[data-vs]::after {
  content: attr(data-vs);
}

.flow {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  flex-wrap: wrap;
  margin: 20px 0;
  font-size: 1.25em;
  font-weight: 700;
}

.flow > * + *::before {
  content: "→";
  color: var(--zerp-faint);
  font-weight: 400;
  margin-right: 14px;
}

.steps {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
  margin: 24px 0;
  counter-reset: zerp-step;
}

.steps > * {
  background: var(--zerp-surface);
  border: 1px solid var(--zerp-border);
  border-radius: 14px;
  padding: 24px;
  text-align: center;
  counter-increment: zerp-step;
}

.steps > *::before {
  content: counter(zerp-step, decimal-leading-zero);
  display: block;
  font-family: "Roboto Mono", monospace;
  font-size: 2em;
  font-weight: 900;
  color: var(--zerp-accent);
  margin-bottom: 8px;
}

.timeline {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  justify-content: center;
  margin: 16px 0;
}

.timeline .item {
  background: var(--zerp-surface);
  border: 1px solid var(--zerp-border);
  border-radius: 10px;
  padding: 14px 18px;
  text-align: center;
  min-width: 130px;
}

.timeline .item .year {
  font-family: "Roboto Mono", monospace;
  font-size: 1.3em;
  font-weight: 700;
  color: var(--zerp-accent);
}

.timeline .item .label {
  font-size: 1em;
  margin-top: 4px;
}

.key-thought {
  background: var(--zerp-surface);
  border: 2px solid var(--zerp-accent);
  border-radius: 14px;
  padding: 28px 36px;
  margin: 16px 0;
  text-align: center;
}

.key-thought p {
  font-size: 1.4em;
  font-weight: 700;
}

.pill {
  display: inline-block;
  border-radius: 999px;
  padding: 5px 16px;
  font-size: 1em;
  font-weight: 700;
  background: var(--zerp-surface);
  border: 1px solid var(--zerp-border);
}

.interactive-badge {
  display: inline-block;
  border-radius: 999px;
  padding: 5px 16px;
  font-size: 1em;
  font-weight: 700;
  background: var(--zerp-green-tint);
  color: var(--zerp-green-on-tint);
  margin-bottom: 14px;
}

.block-label {
  position: absolute;
  top: 24px;
  left: 70px;
  font-size: 1em;
  font-weight: 700;
  color: var(--zerp-muted);
  text-transform: uppercase;
  letter-spacing: 3px;
}

.img-row {
  display: flex;
  gap: 24px;
  align-items: center;
  justify-content: center;
  margin: 24px 0;
  flex-wrap: wrap;
}

.img-row img {
  max-height: 300px;
  border-radius: 10px;
  object-fit: contain;
  background: var(--zerp-surface);
  padding: 6px;
}

.grid-demo {
  display: grid;
  grid-template-columns: repeat(7, 48px);
  gap: 3px;
  justify-content: center;
  margin: 16px 0;
}

.grid-demo .cell {
  width: 48px;
  height: 48px;
  border: 2px solid var(--zerp-border);
  border-radius: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1em;
  font-weight: 700;
  color: var(--zerp-muted);
}

.grid-demo .cell.filled {
  background: var(--zerp-red-solid);
  border-color: var(--zerp-red-solid);
  color: var(--zerp-on-solid);
}

.center {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  flex-wrap: wrap;
  margin: 16px 0;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.spread {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.grow {
  flex: 1;
}

.lg {
  font-size: 1.25em;
}

.xl {
  font-size: 1.6em;
}

.sm {
  font-size: 0.9em;
}

.mono {
  font-family: "Roboto Mono", monospace;
}

.muted {
  color: var(--zerp-muted);
}

.accent {
  color: var(--zerp-accent);
  font-weight: 700;
}

.ok {
  color: var(--zerp-ok);
  font-weight: 700;
}

.warn {
  color: var(--zerp-warn);
  font-weight: 700;
}

.danger {
  color: var(--zerp-danger);
  font-weight: 700;
}

.blue {
  color: var(--zerp-blue);
  font-weight: 700;
}

.green {
  color: var(--zerp-green);
  font-weight: 700;
}

.orange {
  color: var(--zerp-orange);
  font-weight: 700;
}

.purple {
  color: var(--zerp-purple);
  font-weight: 700;
}

.red {
  color: var(--zerp-red);
  font-weight: 700;
}

.amber {
  color: var(--zerp-amber);
  font-weight: 700;
}

.teal {
  color: var(--zerp-teal);
  font-weight: 700;
}

.tint-blue {
  background: var(--zerp-blue-tint);
}

.tint-green {
  background: var(--zerp-green-tint);
}

.tint-orange {
  background: var(--zerp-orange-tint);
}

.tint-purple {
  background: var(--zerp-purple-tint);
}

.tint-red {
  background: var(--zerp-red-tint);
}

.tint-amber {
  background: var(--zerp-amber-tint);
}

.tint-teal {
  background: var(--zerp-teal-tint);
}

.pill.tint-blue,
.pill.accent {
  background: var(--zerp-blue-tint);
  color: var(--zerp-blue-on-tint);
}

.pill.tint-green,
.pill.ok {
  background: var(--zerp-green-tint);
  color: var(--zerp-green-on-tint);
}

.pill.tint-orange {
  background: var(--zerp-orange-tint);
  color: var(--zerp-orange-on-tint);
}

.pill.tint-purple {
  background: var(--zerp-purple-tint);
  color: var(--zerp-purple-on-tint);
}

.pill.tint-red,
.pill.danger {
  background: var(--zerp-red-tint);
  color: var(--zerp-red-on-tint);
}

.pill.tint-amber,
.pill.warn {
  background: var(--zerp-amber-tint);
  color: var(--zerp-amber-on-tint);
}

.pill.tint-teal {
  background: var(--zerp-teal-tint);
  color: var(--zerp-teal-on-tint);
}

.nav {
  position: fixed;
  bottom: 24px;
  right: 36px;
  display: flex;
  gap: 10px;
  z-index: 100;
}

.nav button {
  background: none;
  border: none;
  color: var(--zerp-muted);
  padding: 4px 8px;
  cursor: pointer;
  font-size: 1em;
  font-weight: 700;
  font-family: "Roboto Mono", monospace;
}

.nav button:hover {
  color: var(--zerp-text);
}

.counter {
  position: fixed;
  bottom: 28px;
  left: 36px;
  font-size: 1em;
  font-weight: 700;
  color: var(--zerp-muted);
  font-family: "Roboto Mono", monospace;
  z-index: 100;
}

.progress {
  position: fixed;
  top: 0;
  left: 0;
  height: 3px;
  background: var(--zerp-accent);
  z-index: 100;
  transition: width 0.3s;
}

.theme-switch {
  position: fixed;
  bottom: 24px;
  right: 110px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 100;
}

.theme-switch .theme-trigger {
  background: none;
  border: none;
  color: var(--zerp-muted);
  cursor: pointer;
  font-size: 1em;
  padding: 4px 8px;
}

.theme-switch .theme-trigger:hover {
  color: var(--zerp-text);
}

.theme-switch .theme-options {
  display: flex;
  gap: 4px;
  background: var(--zerp-surface);
  border: 1px solid var(--zerp-border);
  border-radius: 999px;
  padding: 4px;
}

.theme-switch .theme-options[hidden] {
  display: none;
}

.theme-switch .theme-options button {
  background: none;
  border: none;
  border-radius: 999px;
  color: var(--zerp-muted);
  cursor: pointer;
  font-family: "Roboto Mono", monospace;
  font-size: 1em;
  font-weight: 700;
  padding: 4px 12px;
}

.theme-switch .theme-options button.selected {
  background: var(--zerp-blue-tint);
  color: var(--zerp-blue-on-tint);
}
```

```bash
git rm src/assets/default-styles.css
```

- [ ] **Step 4: Rewrite `scripts/build.mjs`** (full new content):

```js
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

import { generateTokenContrast, generateTokensCss } from "./generate-tokens.mjs";

await rm("dist", { force: true, recursive: true });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { stdio: "inherit" });
await mkdir("dist/assets", { recursive: true });
await cp("src/assets", "dist/assets", { recursive: true });

const tokensCss = await generateTokensCss();
const baseCss = await readFile("dist/assets/base-styles.css", "utf8");
await writeFile("dist/assets/default-styles.css", `${tokensCss}\n\n${baseCss}`);
await rm("dist/assets/base-styles.css");

await mkdir("dist/check", { recursive: true });
await writeFile(
  "dist/check/token-contrast.json",
  JSON.stringify(await generateTokenContrast(), null, 2),
);

execFileSync("pnpm", ["exec", "oxfmt", "--write", "dist"], { stdio: "inherit" });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm build && node --test test/build-output.test.mjs`
Expected: PASS (2 tests). Also open `pnpm demo casino` briefly — deck renders with new palette (old classes unstyled until Task 9; that is expected).

- [ ] **Step 6: Commit**

```bash
pnpm lint && pnpm format
git add src/assets scripts/build.mjs test/build-output.test.mjs
git commit -m "Rewrite base stylesheet on generated design tokens

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Theming — build options, CLI flag, runtime switch

**Files:**
- Modify: `src/presentation.ts`, `src/cli.ts`, `src/server.ts`, `src/assets/default-runtime.js`, `src/index.ts`
- Create: `test/fixtures/clean-deck/slides/00-ok.md`
- Test: `test/presentation.test.mjs`

**Interfaces:**
- Produces: `export type ThemeName = "dark" | "light" | "system"` in `src/presentation.ts`; `BuildOptions.theme?: ThemeName`; `servePresentation(rootDir: string, port: number, options?: { theme?: ThemeName })`; built HTML carries `data-zerp-theme` + `data-zerp-default-theme` on `<html>`, `data-zerp-src="slides/<file>"` on every slide div, and the `#theme-switch` markup. Tasks 7–8 rely on `data-zerp-src`; Task 8 relies on the CLI accepting `--theme`.

- [ ] **Step 1: Create fixture** — `test/fixtures/clean-deck/slides/00-ok.md`:

```markdown
# Hello

A safe slide with plain readable text.
```

- [ ] **Step 2: Write the failing test** — `test/presentation.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPresentationHtml } from "../dist/presentation.js";

const rootDir = "test/fixtures/clean-deck";

test("default theme is system", async () => {
  const html = await buildPresentationHtml({ rootDir });
  assert.match(html, /<html lang="en" data-zerp-theme="system" data-zerp-default-theme="system">/);
});

test("explicit theme is baked into the html element", async () => {
  const html = await buildPresentationHtml({ rootDir, theme: "light" });
  assert.match(html, /data-zerp-theme="light" data-zerp-default-theme="light"/);
});

test("slides carry their source path and fonts include weight 600", async () => {
  const html = await buildPresentationHtml({ rootDir });
  assert.match(html, /<div class="slide" data-zerp-src="slides\/00-ok\.md">/);
  assert.match(html, /Montserrat:wght@400;600;700;900/);
  assert.match(html, /id="theme-switch"/);
  assert.match(html, /data-theme-choice="system"/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm build && node --test test/presentation.test.mjs`
Expected: FAIL on all three (no attrs, no data-zerp-src, old fonts URL).

- [ ] **Step 4: Implement `src/presentation.ts` changes**

Add the type and option:

```ts
export type ThemeName = "dark" | "light" | "system";

export interface BuildOptions {
  rootDir: string;
  title?: string;
  lang?: string;
  outFile?: string;
  theme?: ThemeName;
}
```

Add after `rewriteRelativeUrls`:

```ts
function injectSlideSrc(html: string, relativeSlidePath: string): string {
  const srcPath = path.posix.join("slides", relativeSlidePath.replaceAll(path.sep, "/"));
  return html.replace(/<div\b([^>]*)>/gi, (match, attrs: string) => {
    const classMatch = attrs.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
    if (!classMatch || !/(?:^|\s)slide(?:\s|$)/.test(classMatch[2] ?? "")) {
      return match;
    }
    if (/\bdata-zerp-src\s*=/i.test(attrs)) {
      return match;
    }
    return `<div${attrs} data-zerp-src="${escapeHtml(srcPath)}">`;
  });
}
```

In `buildPresentationHtml`: `const theme = options.theme ?? "system";`, map slide parts through both rewrites:

```ts
return parts.map((html) => injectSlideSrc(rewriteRelativeUrls(html, relativePath), relativePath));
```

Replace the `<html>` line, fonts line, and add the theme switch before the nav line:

```ts
`<html lang="${escapeHtml(lang)}" data-zerp-theme="${theme}" data-zerp-default-theme="${theme}">`,
```

```ts
'    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;900&family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet" />',
```

```ts
'    <div class="theme-switch" id="theme-switch"><button class="theme-trigger" aria-label="Theme">◐</button><div class="theme-options" hidden><button data-theme-choice="light">Light</button><button data-theme-choice="system">Auto</button><button data-theme-choice="dark">Dark</button></div></div>',
```

- [ ] **Step 5: Implement runtime theme manager** — append inside the IIFE of `src/assets/default-runtime.js` (before the final `show(...)` call), plus a `t` handler inside the existing keydown listener:

```js
  const THEME_KEY = "zerp-theme";
  const THEME_ORDER = ["light", "system", "dark"];
  const themeSwitch = document.getElementById("theme-switch");
  const themeOptions = themeSwitch ? themeSwitch.querySelector(".theme-options") : null;

  function syncThemeSwitch(value) {
    if (!themeSwitch) {
      return;
    }
    for (const button of themeSwitch.querySelectorAll("[data-theme-choice]")) {
      button.classList.toggle("selected", button.dataset.themeChoice === value);
    }
  }

  function applyTheme(value) {
    document.documentElement.dataset.zerpTheme = value;
    try {
      localStorage.setItem(THEME_KEY, value);
    } catch {
      /* storage unavailable */
    }
    syncThemeSwitch(value);
  }

  function cycleTheme() {
    const current = document.documentElement.dataset.zerpTheme || "system";
    const index = THEME_ORDER.indexOf(current);
    applyTheme(THEME_ORDER[(index + 1) % THEME_ORDER.length]);
  }

  function initTheme() {
    let stored = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      /* storage unavailable */
    }
    const value = THEME_ORDER.includes(stored)
      ? stored
      : document.documentElement.dataset.zerpDefaultTheme || "system";
    document.documentElement.dataset.zerpTheme = value;
    syncThemeSwitch(value);
  }

  if (themeSwitch && themeOptions) {
    const trigger = themeSwitch.querySelector(".theme-trigger");
    if (trigger) {
      trigger.addEventListener("click", () => {
        themeOptions.hidden = !themeOptions.hidden;
      });
    }
    themeOptions.addEventListener("click", (event) => {
      const choice = event.target.closest("[data-theme-choice]");
      if (choice) {
        applyTheme(choice.dataset.themeChoice);
        themeOptions.hidden = true;
      }
    });
  }

  initTheme();
```

Inside the keydown handler add:

```js
    if (event.key === "t" || event.key === "T") {
      event.preventDefault();
      cycleTheme();
    }
```

- [ ] **Step 6: Thread theme through CLI and server**

`src/server.ts` — new signature and build call:

```ts
import type { ThemeName } from "./presentation.js";

export interface ServeOptions {
  theme?: ThemeName;
}

export async function servePresentation(
  rootDir: string,
  port: number,
  options: ServeOptions = {},
): Promise<void> {
```

```ts
      if (pathname === "/" || pathname === "/index.html") {
        const html = await buildPresentationHtml({
          rootDir: resolvedRoot,
          ...(options.theme !== undefined ? { theme: options.theme } : {}),
        });
```

`src/cli.ts` — switch to `node:util` `parseArgs` (full rewrite lands in Task 8; here only add flag parsing minimally):

```ts
import { parseArgs } from "node:util";

const THEME_NAMES = new Set(["dark", "light", "system"]);

function parseTheme(raw: string | undefined): ThemeName {
  if (raw === undefined) {
    return "system";
  }
  if (!THEME_NAMES.has(raw)) {
    throw new Error(`Invalid theme: ${raw} (expected dark, light, or system)`);
  }
  return raw as ThemeName;
}
```

Replace the `process.argv` destructuring with:

```ts
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      theme: { type: "string" },
      strict: { type: "boolean", default: false },
    },
  });
  const [command, firstArg, secondArg] = positionals;
```

Pass `theme: parseTheme(values.theme)` to `writePresentation`, and `{ theme: parseTheme(values.theme) }` as third arg to `servePresentation`. Import `ThemeName` from `./presentation.js`. Update `printUsage` strings to `zerp serve [deck-dir] [port] [--theme dark|light|system]` and `zerp build [deck-dir] [--theme dark|light|system]`.

`src/index.ts` — add `ThemeName` export:

```ts
export type { BuildOptions, ThemeName } from "./presentation.js";
```

- [ ] **Step 7: Run tests, verify manually, commit**

Run: `pnpm build && node --test test/presentation.test.mjs` → PASS (3 tests).
Manual: `pnpm demo casino`, press `t` twice — background flips dark→light and back; the ◐ button reveals Light/Auto/Dark; reload keeps the chosen theme (localStorage).

```bash
pnpm lint && pnpm format
git add src test/presentation.test.mjs test/fixtures/clean-deck
git commit -m "Add light/dark/system theming with runtime switch

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Checker foundations — color parsing and APCA wrappers

**Files:**
- Create: `src/check/types.ts`, `src/check/vendor.d.ts`, `src/check/color.ts`, `src/check/apca.ts`
- Test: `test/color.test.mjs`, `test/apca.test.mjs`

**Interfaces:**
- Produces (consumed by Tasks 5–8):

```ts
// types.ts
export type CheckTheme = "dark" | "light";
export type Severity = "error" | "warning" | "unverifiable";
export interface Finding {
  severity: Severity;
  theme: CheckTheme;
  slideIndex: number;
  slideSrc: string | null;
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
// color.ts
export interface Rgba { r: number; g: number; b: number; a: number }
export function parseColor(value: string): Rgba | null;
export function blend(fg: Rgba, bg: Rgba): Rgba;
export function toHex(color: Rgba): string;
// apca.ts
export const MIN_WARN_PX = 16;
export const MIN_ERROR_PX = 14;
export function contrastLc(fg: Rgba, bg: Rgba): number;          // signed Lc
export function requiredPx(lc: number, weight: number): number | null; // null = unusable at any size
export function neededLc(px: number, weight: number): number | null;
```

- [ ] **Step 1: Write the failing tests**

`test/color.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { blend, parseColor, toHex } from "../dist/check/color.js";

test("parses hex forms", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#12141c"), { r: 18, g: 20, b: 28, a: 1 });
  assert.equal(parseColor("#12141c80").a.toFixed(2), "0.50");
  assert.equal(parseColor("#12"), null);
});

test("parses rgb()/rgba() and named colors", () => {
  assert.deepEqual(parseColor("rgb(1, 2, 3)"), { r: 1, g: 2, b: 3, a: 1 });
  assert.equal(parseColor("rgba(0, 0, 0, 0.4)").a, 0.4);
  assert.deepEqual(parseColor("rgb(0 0 0 / 50%)").a, 0.5);
  assert.deepEqual(parseColor("white"), { r: 255, g: 255, b: 255, a: 1 });
  assert.equal(parseColor("oklch(0.5 0.1 20)"), null);
});

test("alpha blending and hex round-trip", () => {
  const half = { r: 255, g: 255, b: 255, a: 0.5 };
  const black = { r: 0, g: 0, b: 0, a: 1 };
  assert.deepEqual(blend(half, black), { r: 128, g: 128, b: 128, a: 1 });
  assert.equal(toHex(black), "#000000");
});
```

`test/apca.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { contrastLc, neededLc, requiredPx } from "../dist/check/apca.js";

const WHITE = { r: 255, g: 255, b: 255, a: 1 };
const BLACK = { r: 0, g: 0, b: 0, a: 1 };

test("Lc matches apca-w3 reference values", () => {
  assert.ok(Math.abs(contrastLc(WHITE, BLACK) - -107.88) < 0.1);
  assert.ok(Math.abs(contrastLc(BLACK, WHITE) - 106.04) < 0.1);
});

test("required px from the APCA font lookup table", () => {
  assert.equal(requiredPx(75, 400), 18);
  assert.equal(requiredPx(-75, 400), 18);
  assert.equal(requiredPx(75, 700), 14);
  assert.equal(requiredPx(65, 400), 21.75);
  assert.equal(requiredPx(15, 400), null);
});

test("neededLc finds the minimum passing contrast for a size", () => {
  const lc = neededLc(18, 400);
  assert.ok(lc !== null && lc <= 75 && requiredPx(lc, 400) <= 18);
  assert.equal(neededLc(4, 100), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm build` → tsc fails (`src/check` missing) or module-not-found in tests. Expected FAIL.

- [ ] **Step 3: Implement the four files**

`src/check/types.ts` — exactly the interface block shown above (all exported).

`src/check/vendor.d.ts`:

```ts
declare module "css-tree" {
  export interface CssNode {
    type: string;
    name?: string;
    property?: string;
    value?: CssNode;
    prelude?: CssNode | null;
    block?: { children: { forEach(callback: (node: CssNode) => void): void } } | null;
    children?: { forEach(callback: (node: CssNode) => void): void } | null;
  }
  export function parse(css: string): CssNode;
  export function generate(node: CssNode): string;
  export function walk(
    node: CssNode,
    options:
      | ((node: CssNode) => void)
      | { visit?: string; enter?: (this: { atrule: CssNode | null }, node: CssNode) => void },
  ): void;
}

declare module "apca-w3" {
  export function APCAcontrast(textY: number, bgY: number, places?: number): number | string;
  export function sRGBtoY(rgb: number[]): number;
  export function fontLookupAPCA(lc: number | string, places?: number): Array<number | string>;
}

declare module "linkedom" {
  export function parseHTML(html: string): { document: unknown };
}
```

`src/check/color.ts`:

```ts
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  orange: "#ffa500",
  purple: "#800080",
  gray: "#808080",
  grey: "#808080",
  silver: "#c0c0c0",
  maroon: "#800000",
  olive: "#808000",
  lime: "#00ff00",
  aqua: "#00ffff",
  teal: "#008080",
  navy: "#000080",
  fuchsia: "#ff00ff",
  cyan: "#00ffff",
  gold: "#ffd700",
};

export function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const named = NAMED[v];
  if (named) {
    return parseColor(named);
  }
  const hexMatch = v.match(/^#([0-9a-f]{3,8})$/);
  if (hexMatch) {
    const hex = hexMatch[1] ?? "";
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
        g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
        b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
        a: hex.length === 4 ? Number.parseInt(`${hex[3]}${hex[3]}`, 16) / 255 : 1,
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: Number.parseInt(hex.slice(0, 2), 16),
        g: Number.parseInt(hex.slice(2, 4), 16),
        b: Number.parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const fnMatch = v.match(/^rgba?\(([^)]*)\)$/);
  if (fnMatch) {
    const parts = (fnMatch[1] ?? "").split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const channel = (raw: string): number =>
      raw.endsWith("%")
        ? Math.round((Number.parseFloat(raw) / 100) * 255)
        : Math.round(Number.parseFloat(raw));
    const r = channel(parts[0] ?? "");
    const g = channel(parts[1] ?? "");
    const b = channel(parts[2] ?? "");
    const alphaRaw = parts[3];
    const a =
      alphaRaw === undefined
        ? 1
        : alphaRaw.endsWith("%")
          ? Number.parseFloat(alphaRaw) / 100
          : Number.parseFloat(alphaRaw);
    if ([r, g, b].some((n) => Number.isNaN(n)) || Number.isNaN(a)) {
      return null;
    }
    return { r, g, b, a: Math.min(Math.max(a, 0), 1) };
  }
  return null;
}

export function blend(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a + bg.a * (1 - fg.a);
  if (a === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const mix = (f: number, b: number): number =>
    Math.round((f * fg.a + b * bg.a * (1 - fg.a)) / a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a };
}

export function toHex(color: Rgba): string {
  const part = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}
```

`src/check/apca.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test test/color.test.mjs test/apca.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm format
git add src/check test/color.test.mjs test/apca.test.mjs
git commit -m "Add color parsing and APCA utilities for the checker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: CSS model — rules, specificity, theme variables

**Files:**
- Create: `src/check/css-model.ts`
- Test: `test/css-model.test.mjs`

**Interfaces:**
- Consumes: `CheckTheme` from `./types.js`.
- Produces (consumed by Task 6's resolver and Task 7's checker):

```ts
export interface StyleRule {
  selector: string;
  specificity: readonly [number, number, number];
  order: number;
  declarations: ReadonlyMap<string, string>;
}
export interface StyleSheetInput { css: string; origin: "framework" | "deck" }
export interface CssModel {
  rules: StyleRule[];
  themeVars: Record<CheckTheme, Map<string, string>>;
  skippedSelectors: string[]; // deck-origin unsupported selectors only
}
export function parseStylesheets(sheets: StyleSheetInput[]): CssModel;
```

- Behavior contract: rules inside any at-rule are ignored; `:root[data-zerp-theme="dark"|"light"]` blocks feed only `themeVars` for that theme; custom props on `:root`/`html` feed both maps; selectors containing `[`, `+`, `~`, or `:` (except bare `:root`) are unsupported — skipped, and recorded in `skippedSelectors` only when `origin === "deck"`; comma lists split into independent rules; later `order` wins ties.

- [ ] **Step 1: Write the failing test** — `test/css-model.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseStylesheets } from "../dist/check/css-model.js";

const framework = `
:root[data-zerp-theme="dark"] { color-scheme: dark; --zerp-bg: #12141c; --zerp-text: #f0f3ff; }
:root[data-zerp-theme="light"] { color-scheme: light; --zerp-bg: #f0f3ff; --zerp-text: #2c2e37; }
@media (prefers-color-scheme: dark) { :root:not([data-zerp-theme]) { --zerp-bg: #000000; } }
.slide p, .slide li { font-size: 1.25em; }
.nav button:hover { color: red; }
`;

const deck = `
:root { --brand: #ff0000; }
.hero { color: var(--brand); }
.door:hover { border-color: red; }
`;

test("theme blocks feed var maps and are excluded from rules", () => {
  const model = parseStylesheets([
    { css: framework, origin: "framework" },
    { css: deck, origin: "deck" },
  ]);
  assert.equal(model.themeVars.dark.get("--zerp-bg"), "#12141c");
  assert.equal(model.themeVars.light.get("--zerp-bg"), "#f0f3ff");
  assert.equal(model.themeVars.dark.get("--brand"), "#ff0000");
  assert.equal(model.themeVars.light.get("--brand"), "#ff0000");
  assert.ok(!model.rules.some((r) => r.selector.includes("data-zerp-theme")));
  assert.ok(!model.rules.some((r) => r.selector.includes(":not")), "media content skipped");
});

test("comma selectors split; specificity computed; unsupported deck selectors reported", () => {
  const model = parseStylesheets([
    { css: framework, origin: "framework" },
    { css: deck, origin: "deck" },
  ]);
  const p = model.rules.find((r) => r.selector === ".slide p");
  const li = model.rules.find((r) => r.selector === ".slide li");
  assert.ok(p && li);
  assert.deepEqual([...p.specificity], [0, 1, 1]);
  assert.equal(p.declarations.get("font-size"), "1.25em");
  assert.deepEqual(model.skippedSelectors, [".door:hover"]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm build` → FAIL (module missing).

- [ ] **Step 3: Implement** — `src/check/css-model.ts`:

```ts
import * as csstree from "css-tree";

import type { CheckTheme } from "./types.js";

export interface StyleRule {
  selector: string;
  specificity: readonly [number, number, number];
  order: number;
  declarations: ReadonlyMap<string, string>;
}

export interface StyleSheetInput {
  css: string;
  origin: "framework" | "deck";
}

export interface CssModel {
  rules: StyleRule[];
  themeVars: Record<CheckTheme, Map<string, string>>;
  skippedSelectors: string[];
}

const THEME_BLOCK = /^:root\[data-zerp-theme=(?:"(dark|light)"|(dark|light))\]$/;

function isSupportedSelector(selector: string): boolean {
  if (selector === ":root" || selector === "html") {
    return true;
  }
  return !/[[\]+~:]/.test(selector);
}

function specificityOf(selectorNode: csstree.CssNode): [number, number, number] {
  let ids = 0;
  let classes = 0;
  let types = 0;
  csstree.walk(selectorNode, (node) => {
    if (node.type === "IdSelector") {
      ids += 1;
    } else if (
      node.type === "ClassSelector" ||
      node.type === "AttributeSelector" ||
      node.type === "PseudoClassSelector"
    ) {
      classes += 1;
    } else if (node.type === "TypeSelector" && node.name !== "*") {
      types += 1;
    }
  });
  return [ids, classes, types];
}

export function parseStylesheets(sheets: StyleSheetInput[]): CssModel {
  const rules: StyleRule[] = [];
  const themeVars: Record<CheckTheme, Map<string, string>> = {
    dark: new Map(),
    light: new Map(),
  };
  const skipped = new Set<string>();
  let order = 0;

  for (const sheet of sheets) {
    const ast = csstree.parse(sheet.css);
    csstree.walk(ast, {
      visit: "Rule",
      enter(node) {
        if (this.atrule) {
          return;
        }
        const prelude = node.prelude;
        if (!prelude || prelude.type !== "SelectorList" || !prelude.children) {
          return;
        }
        const declarations = new Map<string, string>();
        node.block?.children.forEach((decl) => {
          if (decl.type === "Declaration" && decl.property && decl.value) {
            const property = decl.property.startsWith("--")
              ? decl.property
              : decl.property.toLowerCase();
            declarations.set(property, csstree.generate(decl.value).trim());
          }
        });
        prelude.children.forEach((selectorNode) => {
          const selector = csstree.generate(selectorNode).trim();
          const themeMatch = selector.match(THEME_BLOCK);
          if (themeMatch) {
            const theme = (themeMatch[1] ?? themeMatch[2]) as CheckTheme;
            for (const [property, value] of declarations) {
              if (property.startsWith("--")) {
                themeVars[theme].set(property, value);
              }
            }
            return;
          }
          if (selector === ":root" || selector === "html") {
            for (const [property, value] of declarations) {
              if (property.startsWith("--")) {
                themeVars.dark.set(property, value);
                themeVars.light.set(property, value);
              }
            }
          }
          if (!isSupportedSelector(selector)) {
            if (sheet.origin === "deck") {
              skipped.add(selector);
            }
            return;
          }
          rules.push({
            selector,
            specificity: specificityOf(selectorNode),
            order: order++,
            declarations,
          });
        });
      },
    });
  }

  return { rules, themeVars, skippedSelectors: [...skipped] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test test/css-model.test.mjs`
Expected: PASS (2 tests). Note `:root`/`html` remain as normal rules too (their non-var declarations participate in the cascade); `html` matches via `documentElement.matches("html")`.

- [ ] **Step 5: Commit**

```bash
pnpm lint && pnpm format
git add src/check/css-model.ts test/css-model.test.mjs
git commit -m "Add CSS model parser for the checker

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

<!-- PLAN CONTINUES: tasks 6-10 -->
