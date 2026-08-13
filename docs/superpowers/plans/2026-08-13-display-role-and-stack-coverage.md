# Display Font Role and Stack-Aware Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third configurable font role (`display`) that defaults to body, and replace `zerp check`'s union-based glyph coverage with a check that resolves the font stack each character actually renders through.

**Architecture:** Part 1 threads a third role through the existing two-role pipeline: `deck-config.ts` validates it, `fonts.ts` plans it (falling back to the *resolved body plan*), `familyTokenCss` emits `--zerp-font-display`, and `base-styles.css` applies it to `h1` via a zero-specificity `:where()` rule so deck authors can opt out. Part 2 adds `font-family` to the existing `StyleResolver` cascade, then adds a new `src/check/font-stack.ts` that resolves a character against an ordered stack using the real cmaps `coverage.ts` already reads; `coverage.ts` changes from a set-in/set-out function to a DOM walk driven by the resolver.

**Tech Stack:** TypeScript (ESM, `dist/` build via `scripts/build.mjs`), `node:test` with `node:assert/strict`, linkedom (DOM), css-tree (CSS parsing), fontsource woff2 subsets, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-08-13-display-font-role-and-stack-coverage-design.md`

## Global Constraints

- Target version **0.11.0**. Breaking changes are acceptable and expected (the config surface and the coverage finding shape both change).
- Branch: `feat/display-role-and-stack-coverage`. Do not merge or publish.
- **Tests run against `dist/`, not `src/`.** Every test imports from `../dist/…`. Run `pnpm build` before `node --test`, or just use `pnpm test`, which builds first.
- Never hand-edit `dist/`, `examples/**/index.html`, or `docs/style-system.pdf`. Regenerate them.
- `src/assets/base-styles.css` must use **token references only** — no raw colors.
- A deck that configures no fonts must produce a **byte-identical** document to 0.10. This is asserted in Task 3 and must not regress.
- `test/fixtures/kitchen-sink` and `examples/casino` must pass `node dist/cli.js check <deck>` cleanly in both themes before handoff (Task 11).
- Fixtures use only `@fontsource/montserrat` and `@fontsource/roboto-mono`, already in `dependencies`. **Do not add dependencies.**
- Follow existing comment style: comments explain *why*, not *what*. Match the density of surrounding code.
- Commit after every task. Pre-commit runs Husky → `lint-staged` + a build check.

---

### Task 1: The `display` role in deck config

**Files:**
- Modify: `src/deck-config.ts:23-30` (`DeckConfig`), `:30` (`FONT_ROLES`)
- Test: `test/deck-fonts.test.mjs:72-84`

**Interfaces:**
- Consumes: nothing.
- Produces: `DeckConfig.fonts.display?: DeckFontConfig`; `FONT_ROLES = ["body", "display", "mono"]`. Task 2 reads `config.fonts?.display`.

- [ ] **Step 1: Write the failing test**

In `test/deck-fonts.test.mjs`, extend the existing `"config mistakes are named, not ignored"` case list — replace the `heading` line and add display cases:

```js
    [{ fonts: { display: { fontsourcePackage: "@fontsource/inter" } } }, /family must be/],
    [{ fonts: { display: { family: "Inter", weight: ["400"] } } }, /unknown key "weight"/],
    [{ fonts: { heading: { family: "Inter" } } }, /unknown key "heading"/],
```

Then add a new test after it:

```js
test("display is a role of its own", async () => {
  const dir = await writeTempDeck({
    fonts: { display: { family: "Roboto Mono", weights: ["400"] } },
  });
  assert.deepEqual(await readDeckConfig(dir), {
    fonts: { display: { family: "Roboto Mono", weights: ["400"] } },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/deck-fonts.test.mjs`
Expected: FAIL — `unknown key "display" in fonts (expected body, mono)`.

- [ ] **Step 3: Write minimal implementation**

In `src/deck-config.ts`, add to `DeckConfig`:

```ts
export interface DeckConfig {
  fonts?: {
    body?: DeckFontConfig;
    display?: DeckFontConfig;
    mono?: DeckFontConfig;
  };
}
```

And widen the role list:

```ts
const FONT_ROLES = ["body", "display", "mono"];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/deck-fonts.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/deck-config.ts test/deck-fonts.test.mjs
git commit -m "Accept a display font role in deck config"
```

---

### Task 2: Plan and token the display family

**Files:**
- Modify: `src/fonts.ts:181-189` (`FamilyPlan`), `:195-209` (`familyPlan`), `:293-296` (`planFamilies`), `:336-349` (`familyTokenCss`)
- Test: `test/deck-fonts.test.mjs`

**Interfaces:**
- Consumes: `DeckConfig.fonts.display` (Task 1).
- Produces: `FamilyPlan.role` widens to `"body" | "display" | "mono"`; `familyTokenCss` emits `--zerp-font-display`. Task 3's CSS and Task 8's coverage both depend on the token name.

**Key design point:** `display` unset falls back to the **resolved body plan** (family, package *and* weights), not to the `BODY` constant. So `planFamilies` must resolve body first and pass it in, rather than mapping three roles independently.

- [ ] **Step 1: Write the failing test**

Add to `test/deck-fonts.test.mjs`:

```js
test("display defaults to whatever body resolved to", async () => {
  // custom-font-deck sets body to Roboto Mono and says nothing about display.
  const { faces, tokens } = await fontCss("test/fixtures/custom-font-deck", latin);
  assert.match(tokens, /--zerp-font-display: "Roboto Mono", "Zerp Symbols", sans-serif;/);
  // Inheriting body's plan wholesale means no second family and no extra file.
  assert.equal(new Set(subsetsOf(faces)).size, subsetsOf(faces).length);
  assert.ok(subsetsOf(faces).every((subset) => !subset.startsWith("montserrat")));
});

test("a configured display family is independent of body", async () => {
  const dir = await writeTempDeck({
    fonts: { display: { family: "Roboto Mono", weights: ["400", "700"] } },
  });
  const { faces, tokens } = await fontCss(dir, latin);
  assert.match(tokens, /--zerp-font-display: "Roboto Mono", "Zerp Symbols", sans-serif;/);
  assert.match(tokens, /--zerp-font-body: "Montserrat", "Zerp Symbols", sans-serif;/);
  assert.ok(subsetsOf(faces).some((subset) => subset.startsWith("montserrat-latin")), "body");
  assert.ok(subsetsOf(faces).some((subset) => subset.startsWith("roboto-mono-latin")), "display");
});

test("an unresolvable display package names the display role", async () => {
  const dir = await writeTempDeck({ fonts: { display: { family: "Not Installed" } } });
  await assert.rejects(
    fontCss(dir, latin),
    /Cannot resolve "@fontsource\/not-installed" for the display font/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/deck-fonts.test.mjs`
Expected: FAIL — no `--zerp-font-display` in the emitted tokens.

- [ ] **Step 3: Write minimal implementation**

In `src/fonts.ts`, widen the role type:

```ts
type FontRole = "body" | "display" | "mono";

interface FamilyPlan {
  role: FontRole;
  /** The family name the emitted stacks will use. */
  family: string;
  pkg: string;
  weights: string[];
  /** True when the deck asked for this family rather than taking the default. */
  configured: boolean;
}
```

Replace `familyPlan` so the fallback is a plan rather than a constant:

```ts
// The fallback is a resolved plan, not a constant, because `display` inherits
// the family the DECK chose for body — a deck that sets body to Inter and says
// nothing about display gets Inter headings, not Montserrat ones.
function familyPlan(
  role: FontRole,
  config: DeckFontConfig | undefined,
  fallback: Omit<FamilyPlan, "role" | "configured">,
): FamilyPlan {
  if (!config) {
    return { role, ...fallback, configured: false };
  }
  return {
    role,
    family: config.family,
    pkg: config.fontsourcePackage ?? `@fontsource/${slugify(config.family)}`,
    // Missing weights are simply not emitted: the browser synthesizes what it
    // needs and zerp's own type scale only asks for what the defaults ship.
    weights: config.weights ?? fallback.weights,
    configured: true,
  };
}
```

Replace `planFamilies`:

```ts
async function planFamilies(rootDir: string): Promise<FamilyPlan[]> {
  const config = await readDeckConfig(rootDir);
  // Body first: display falls back to it, so it has to exist to be inherited.
  const body = familyPlan("body", config.fonts?.body, BODY);
  return [
    body,
    familyPlan("display", config.fonts?.display, body),
    familyPlan("mono", config.fonts?.mono, MONO),
  ];
}
```

Extend `familyTokenCss`:

```ts
function familyTokenCss(plans: FamilyPlan[]): string {
  if (!plans.some((plan) => plan.configured)) {
    return "";
  }
  const familyOf = (role: FontRole, fallback: string): string =>
    plans.find((plan) => plan.role === role)?.family ?? fallback;
  const body = familyOf("body", BODY.family);
  const display = familyOf("display", BODY.family);
  const mono = familyOf("mono", MONO.family);
  const symbols = `"${SYMBOL_FACE.family}"`;
  return `:root {
  --zerp-font-body: "${body}", ${symbols}, sans-serif;
  --zerp-font-display: "${display}", ${symbols}, sans-serif;
  --zerp-font-marker: ${symbols}, "${body}", sans-serif;
  --zerp-font-mono: "${mono}", ${symbols}, monospace;
  --zerp-font-nav: "${mono}", monospace;
}`;
}
```

Note `familyPlan`'s third argument accepts `BODY` and `MONO` as-is: both are `{ family, pkg, weights }`, which matches `Omit<FamilyPlan, "role" | "configured">`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/deck-fonts.test.mjs test/fonts.test.mjs`
Expected: PASS, including the pre-existing tests — `custom-font-deck` must still inline each woff2 once.

- [ ] **Step 5: Commit**

```bash
git add src/fonts.ts test/deck-fonts.test.mjs
git commit -m "Plan and emit a display family that inherits body"
```

---

### Task 3: Apply the display face to `h1`

**Files:**
- Modify: `src/assets/base-styles.css:26-29` (`:root` tokens), and a new rule near `:157`
- Modify: `test/build-output.test.mjs:63-70`
- Regenerate: `test/fixtures/clean-deck/index.html`

**Interfaces:**
- Consumes: `--zerp-font-display` (Task 2).
- Produces: `:where(.slide h1) { font-family: var(--zerp-font-display) }` — Task 8's fixtures rely on `h1` resolving through the display stack.

**Key design point:** `:where()` gives the rule zero specificity so an author can undo it with a plain `h1 { … }`. Verified: linkedom's `matches()` supports `:where`, and `css-model.ts:31,38` already strips `:where(...)` for both support-testing and specificity.

- [ ] **Step 1: Write the failing test**

In `test/build-output.test.mjs`, add alongside the existing token assertions:

```js
  assert.match(css, /--zerp-font-display: "Montserrat", "Zerp Symbols", sans-serif;/);
  assert.match(css, /:where\(\.slide h1\) \{\s*font-family: var\(--zerp-font-display\)/);
```

And add a new test asserting the byte-identical invariant:

```js
test("a deck that configures no fonts is unchanged by the display role", async () => {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/kitchen-sink" });
  assert.ok(!html.includes("font-tokens"), "no token block, so no per-deck override");
  // The default h1 stack and the default body stack name the same family, so
  // adding the role cannot change a default deck's rendering.
  assert.match(html, /--zerp-font-display: "Montserrat", "Zerp Symbols", sans-serif;/);
});
```

(If `buildPresentationHtml` is not already imported in this file, add
`import { buildPresentationHtml } from "../dist/presentation.js";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/build-output.test.mjs`
Expected: FAIL — no `--zerp-font-display` in the built stylesheet.

- [ ] **Step 3: Write minimal implementation**

In `src/assets/base-styles.css`, add to the `:root` block after `--zerp-font-body` (keep the existing explanatory comment above it intact):

```css
  --zerp-font-display: "Montserrat", "Zerp Symbols", sans-serif;
```

Then add immediately above the existing `.slide h1` rule at `:157`:

```css
/* Headings are display type, and a deck may set a face for them alone. Zero
   specificity via :where() so `h1 { font-family: var(--zerp-font-body) }` in a
   deck's own stylesheet is enough to opt out — with `.slide h1` an author would
   have to match the framework's own selector to decline the feature. Opting
   other elements in works either way: a rule naming h2 directly beats the
   family h2 inherits from .slide. */
:where(.slide h1) {
  font-family: var(--zerp-font-display);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/build-output.test.mjs`
Expected: PASS.

- [ ] **Step 5: Regenerate the clean-deck fixture**

`test/fixtures/clean-deck/index.html` is generated output containing the full stylesheet. Regenerate it:

```bash
node dist/cli.js build test/fixtures/clean-deck
```

Then run `node --test test/` and confirm nothing else drifted. If `examples/**/index.html` are tracked build outputs that also embed the stylesheet, leave them for Task 11.

- [ ] **Step 6: Commit**

```bash
git add src/assets/base-styles.css test/build-output.test.mjs test/fixtures/clean-deck/index.html
git commit -m "Set h1 in the display face at zero specificity"
```

---

### Task 4: Display-role fixtures and end-to-end assertions

**Files:**
- Create: `test/fixtures/display-font-deck/package.json`, `test/fixtures/display-font-deck/slides/01-intro.html`
- Create: `test/fixtures/display-fallback-deck/package.json`, `test/fixtures/display-fallback-deck/slides/01-intro.html`
- Test: `test/deck-fonts.test.mjs`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: two fixtures. Task 11 screenshots `display-font-deck`.

- [ ] **Step 1: Create the fixtures**

`test/fixtures/display-font-deck/package.json`:

```json
{
  "name": "display-font-deck",
  "private": true,
  "zerp": {
    "fonts": {
      "display": { "family": "Roboto Mono", "weights": ["400", "700"] }
    }
  }
}
```

`test/fixtures/display-font-deck/slides/01-intro.html`:

```html
<div class="slide title">
  <h1>Display face</h1>
  <h3>body face</h3>
  <p>Prose stays in the body family.</p>
</div>
```

`test/fixtures/display-fallback-deck/package.json`:

```json
{
  "name": "display-fallback-deck",
  "private": true,
  "zerp": {
    "fonts": {
      "body": { "family": "Roboto Mono" }
    }
  }
}
```

`test/fixtures/display-fallback-deck/slides/01-intro.html`:

```html
<div class="slide">
  <h1>Inherited</h1>
  <p>Display was never configured, so it follows body.</p>
</div>
```

- [ ] **Step 2: Write the test**

Add to `test/deck-fonts.test.mjs`:

```js
test("a configured display family reaches the built document", async () => {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/display-font-deck" });
  assert.match(html, /--zerp-font-display: "Roboto Mono", "Zerp Symbols", sans-serif;/);
  assert.match(html, /--zerp-font-body: "Montserrat", "Zerp Symbols", sans-serif;/);
});

test("an unconfigured display role emits body's family, not zerp's", async () => {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/display-fallback-deck" });
  assert.match(html, /--zerp-font-display: "Roboto Mono", "Zerp Symbols", sans-serif;/);
});
```

- [ ] **Step 3: Run the tests**

Run: `pnpm build && node --test test/deck-fonts.test.mjs`
Expected: PASS.

- [ ] **Step 4: Check both fixtures build and pass the current check**

```bash
node dist/cli.js check test/fixtures/display-font-deck
node dist/cli.js check test/fixtures/display-fallback-deck
```

Expected: clean. If `examples.test.mjs` or `cli.test.mjs` enumerate fixture directories, they may need the new decks added — run `node --test test/` and fix any enumeration.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/display-font-deck test/fixtures/display-fallback-deck test/deck-fonts.test.mjs
git commit -m "Add display-role fixtures"
```

---

### Task 5: Resolve `font-family` through the cascade

**Files:**
- Modify: `src/check/cascade.ts:5-10` (`ComputedText`), `:188-221` (`computedFor`)
- Test: `test/cascade.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `ComputedText.fontFamily: string` — the **unresolved** declaration value (e.g. `var(--zerp-font-display)`). Callers expand it with `resolver.resolveVars(...)`, matching how `color` is handled at `checker.ts:278`. Task 8 consumes this.

- [ ] **Step 1: Write the failing test**

Add to `test/cascade.test.mjs`, following that file's existing setup idiom for building a `CssModel` and a DOM (reuse whatever helper it already defines; if it builds a model inline via `parseStylesheets`, do the same):

```js
test("font-family is inherited like color", () => {
  const model = parseStylesheets([
    {
      css: `:root { --zerp-font-body: "Montserrat", sans-serif; --zerp-font-display: "Bebas", sans-serif; }
            .slide { font-family: var(--zerp-font-body); }
            :where(.slide h1) { font-family: var(--zerp-font-display); }`,
      origin: "framework",
    },
  ]);
  const { document } = parseHTML(
    "<body><div class=slide><h1>T</h1><p>body <em>emphasis</em></p></div></body>",
  );
  const resolver = new StyleResolver(model, model.themeVars.dark);
  const h1 = document.querySelector("h1");
  const em = document.querySelector("em");
  assert.equal(
    resolver.resolveVars(resolver.computedFor(h1).fontFamily),
    '"Bebas", sans-serif',
  );
  // Inherited through <p> from .slide, two levels up.
  assert.equal(
    resolver.resolveVars(resolver.computedFor(em).fontFamily),
    '"Montserrat", sans-serif',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/cascade.test.mjs`
Expected: FAIL — `fontFamily` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/check/cascade.ts`, add to `ComputedText`:

```ts
export interface ComputedText {
  color: string;
  /** Unresolved declaration value; expand with resolveVars before parsing. */
  fontFamily: string;
  fontSizePx: number;
  fontWeight: number;
  opacity: number;
}
```

In `computedFor`, add to the root defaults object:

```ts
          fontFamily: this.vars.get("--zerp-font-body") ?? "sans-serif",
```

and, next to the `color` handling:

```ts
    const familyRaw = own.get("font-family");
    const fontFamily =
      !familyRaw || familyRaw === "inherit" ? parentComputed.fontFamily : familyRaw;
```

then include `fontFamily` in the `computed` object literal.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/cascade.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/check/cascade.ts test/cascade.test.mjs
git commit -m "Compute font-family in the check cascade"
```

---

### Task 6: Resolve a character against a font stack

**Files:**
- Create: `src/check/font-stack.ts`
- Test: `test/font-stack.test.mjs`

**Interfaces:**
- Consumes: `FontFaceInfo` and `rangesContain` from `src/fonts.ts`.
- Produces:
  - `parseFontStack(value: string): string[]` — ordered family names, quotes stripped, truncated at the first generic family.
  - `class StackResolver` with `constructor(faces: readonly FontFaceInfo[], cmaps: ReadonlyMap<string, ReadonlySet<number>>)` and `resolves(stack: readonly string[], codepoint: number): boolean`.
  Task 8 consumes both.

**Key design point:** generic families terminate the stack — reaching `sans-serif` means the browser falls back to the viewing machine, which is exactly the failure being reported. Weight is ignored: fontsource subsets share a cmap across weights, so family-level resolution is sufficient.

- [ ] **Step 1: Write the failing test**

Create `test/font-stack.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseFontStack, StackResolver } from "../dist/check/font-stack.js";

const cp = (character) => character.codePointAt(0);

test("a stack is its named families, in order, up to the first generic", () => {
  assert.deepEqual(parseFontStack('"Bebas Neue", "Zerp Symbols", sans-serif'), [
    "Bebas Neue",
    "Zerp Symbols",
  ]);
  assert.deepEqual(parseFontStack("Inter, monospace, Ignored"), ["Inter"]);
  assert.deepEqual(parseFontStack("  'Roboto Mono'  "), ["Roboto Mono"]);
  assert.deepEqual(parseFontStack("sans-serif"), []);
});

const faces = [
  { family: "Alpha", subset: "latin", file: "alpha.woff2", ranges: [{ first: 0x41, last: 0x5a }] },
  { family: "Beta", subset: "greek", file: "beta.woff2", ranges: [{ first: 0x391, last: 0x3c9 }] },
];
const cmaps = new Map([
  ["alpha.woff2", new Set([cp("A"), cp("B")])],
  ["beta.woff2", new Set([cp("Δ")])],
]);

test("a character resolves against the first family that can draw it", () => {
  const resolver = new StackResolver(faces, cmaps);
  assert.ok(resolver.resolves(["Alpha"], cp("A")));
  assert.ok(!resolver.resolves(["Alpha"], cp("Δ")), "Alpha has no greek");
  assert.ok(resolver.resolves(["Alpha", "Beta"], cp("Δ")), "Beta later in the stack does");
  assert.ok(!resolver.resolves([], cp("A")), "an exhausted stack resolves nothing");
});

test("family matching ignores case, as font-family does", () => {
  const resolver = new StackResolver(faces, cmaps);
  assert.ok(resolver.resolves(["alpha"], cp("A")));
});

test("a codepoint outside the declared range does not resolve, cmap or not", () => {
  // 'B' is in Alpha's cmap and inside its range; 0x2192 is in neither. A face
  // whose file carries a glyph the @font-face range excludes is never consulted
  // for it by the browser, so it must not count here either.
  const clipped = [{ ...faces[0], ranges: [{ first: 0x41, last: 0x41 }] }];
  const resolver = new StackResolver(clipped, cmaps);
  assert.ok(resolver.resolves(["Alpha"], cp("A")));
  assert.ok(!resolver.resolves(["Alpha"], cp("B")), "in the file, outside the range");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/font-stack.test.mjs`
Expected: FAIL — cannot resolve `../dist/check/font-stack.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/check/font-stack.ts`:

```ts
import { type FontFaceInfo, rangesContain } from "../fonts.js";

/**
 * Which face a font stack actually reaches for.
 *
 * The union model this replaces asked "can any bundled face draw this
 * character"; the browser asks "can the first family in *this element's* stack
 * draw it, and if not the second, and so on". The two agree only while every
 * element resolves through the same family, which stopped being true when
 * headings gained a face of their own.
 */

// A generic family is the end of the line: the browser satisfies it from the
// viewing machine, which is the fallback the whole check exists to warn about.
const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);

/** Family names a `font-family` value lists, up to the first generic family. */
export function parseFontStack(value: string): string[] {
  const families: string[] = [];
  for (const part of value.split(",")) {
    const family = part.trim().replace(/^["']|["']$/g, "").trim();
    if (!family) {
      continue;
    }
    if (GENERIC.has(family.toLowerCase())) {
      break;
    }
    families.push(family);
  }
  return families;
}

/** Resolves characters against bundled faces, keyed by family name. */
export class StackResolver {
  private readonly byFamily = new Map<string, FontFaceInfo[]>();
  private readonly cmaps: ReadonlyMap<string, ReadonlySet<number>>;
  private readonly cache = new Map<string, boolean>();

  constructor(
    faces: readonly FontFaceInfo[],
    cmaps: ReadonlyMap<string, ReadonlySet<number>>,
  ) {
    this.cmaps = cmaps;
    for (const face of faces) {
      const key = face.family.toLowerCase();
      const list = this.byFamily.get(key);
      if (list) {
        list.push(face);
      } else {
        this.byFamily.set(key, [face]);
      }
    }
  }

  /**
   * Whether a family can draw a codepoint: some face of it must claim the
   * codepoint in its `unicode-range` AND carry it in its cmap. Weight is not
   * consulted — fontsource subsets share a cmap across weights, so any weight
   * answering for the family answers for all of them.
   */
  private familyDraws(family: string, codepoint: number): boolean {
    for (const face of this.byFamily.get(family.toLowerCase()) ?? []) {
      if (rangesContain(face.ranges, codepoint) && this.cmaps.get(face.file)?.has(codepoint)) {
        return true;
      }
    }
    return false;
  }

  /** Whether any family in the stack draws the codepoint. */
  resolves(stack: readonly string[], codepoint: number): boolean {
    const key = `${stack.join(",")} ${codepoint}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    let found = false;
    for (const family of stack) {
      if (this.familyDraws(family, codepoint)) {
        found = true;
        break;
      }
    }
    this.cache.set(key, found);
    return found;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm build && node --test test/font-stack.test.mjs`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add src/check/font-stack.ts test/font-stack.test.mjs
git commit -m "Resolve a character against an ordered font stack"
```

---

### Task 7: Keep pseudo-element rules in the CSS model

**Files:**
- Modify: `src/check/css-model.ts:5-21` (`StyleRule`, `CssModel`), `:25-33` (`isSupportedSelector`), `:112-123` (rule push)
- Test: `test/css-model.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `StyleRule.pseudoElement: string | null` and `StyleRule.selector` holding the **originating** selector with the pseudo-element stripped. Task 8 filters `model.rules` for `pseudoElement !== null` to find `content:` declarations.

**Why this task exists:** `isSupportedSelector` rejects any selector containing `:` once `:where(...)` is stripped, so `.slide ul li::before` never enters `model.rules` at all. zerp's own `→` markers are drawn by exactly such rules (`base-styles.css:205-212`, `:461`), so without this the new coverage check cannot see them.

- [ ] **Step 1: Write the failing test**

Add to `test/css-model.test.mjs`:

```js
test("a ::before rule is kept, keyed to the element it originates from", () => {
  const model = parseStylesheets([
    { css: '.slide ul li::before { content: "→ "; font-family: var(--zerp-font-marker); }', origin: "framework" },
  ]);
  const rule = model.rules.find((candidate) => candidate.pseudoElement === "::before");
  assert.ok(rule, "the rule survives parsing");
  assert.equal(rule.selector, ".slide ul li", "matchable against a real element");
  assert.equal(rule.declarations.get("content"), '"→ "');
});

test("a pseudo-element rule does not style the originating element", () => {
  const model = parseStylesheets([
    { css: "p::before { color: red; } p { color: blue; }", origin: "framework" },
  ]);
  const own = model.rules.filter((rule) => rule.selector === "p" && rule.pseudoElement === null);
  assert.equal(own.length, 1);
  assert.equal(own[0].declarations.get("color"), "blue");
});

test("an unsupported selector is still skipped", () => {
  const model = parseStylesheets([{ css: "a:hover + b { color: red; }", origin: "deck" }]);
  assert.deepEqual(model.skippedSelectors, ["a:hover + b"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/css-model.test.mjs`
Expected: FAIL — `pseudoElement` undefined and the `::before` rule absent.

- [ ] **Step 3: Write minimal implementation**

In `src/check/css-model.ts`, extend the rule shape:

```ts
export interface StyleRule {
  /** The originating element's selector, pseudo-element stripped. */
  selector: string;
  /** "::before"/"::after" when the rule targets a pseudo-element, else null. */
  pseudoElement: string | null;
  specificity: readonly [number, number, number];
  order: number;
  declarations: ReadonlyMap<string, string>;
}
```

Add a splitter above `isSupportedSelector`:

```ts
// Only the two pseudo-elements that can carry `content:`. They are split off
// rather than dropped because zerp draws its own markers with them, and a
// marker's glyph coverage is as real as any other character's. The originating
// selector is what a DOM element can be matched against.
const PSEUDO_ELEMENT = /(::?(?:before|after))\s*$/i;

function splitPseudoElement(selector: string): { origin: string; pseudo: string | null } {
  const match = selector.match(PSEUDO_ELEMENT);
  if (!match) {
    return { origin: selector, pseudo: null };
  }
  return {
    origin: selector.slice(0, match.index).trim(),
    // Normalize the legacy one-colon form so consumers compare one spelling.
    pseudo: `::${match[1].replace(/^:+/, "").toLowerCase()}`,
  };
}
```

In the `prelude.children.forEach` body, split before the support test and carry the result through. The theme-block and `:root` handling stays keyed on the raw `selector`; only the rule push changes:

```ts
          const { origin, pseudo } = splitPseudoElement(selector);
          if (!isSupportedSelector(origin)) {
            if (sheet.origin === "deck") {
              skipped.add(selector);
            }
            return;
          }
          rules.push({
            selector: origin,
            pseudoElement: pseudo,
            specificity: specificityOf(origin),
            order: order++,
            declarations,
          });
```

Then in `src/check/cascade.ts`, `ownDeclarations` must ignore pseudo-element rules — a `::before` rule styles the pseudo-element, not the element:

```ts
    for (const rule of this.model.rules) {
      if (rule.pseudoElement !== null) {
        continue;
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test test/css-model.test.mjs test/cascade.test.mjs test/checker.test.mjs`
Expected: PASS. The `cascade`/`checker` runs guard against the new rules leaking into element styling — if a contrast expectation shifts, the `pseudoElement !== null` skip is missing or misplaced.

- [ ] **Step 5: Commit**

```bash
git add src/check/css-model.ts src/check/cascade.ts test/css-model.test.mjs
git commit -m "Keep ::before/::after rules in the CSS model"
```

---

### Task 8: Stack-aware coverage

**Files:**
- Rewrite: `src/check/coverage.ts`
- Create: `test/fixtures/stack-coverage-deck/slides/01-greek.html`
- Create: `test/fixtures/stack-override-deck/slides/00-styles.html`, `test/fixtures/stack-override-deck/slides/01-override.html`
- Modify: `test/coverage.test.mjs`

**Interfaces:**
- Consumes: `ComputedText.fontFamily` (Task 5), `parseFontStack`/`StackResolver` (Task 6), `StyleRule.pseudoElement` (Task 7).
- Produces:
  ```ts
  export interface UncoveredText {
    /** Zero-based index into the slide list. */
    slideIndex: number;
    /** The stack the characters resolved through, as authored. */
    stack: string[];
    /** Label of the element the text sits in, e.g. `<h1>`. */
    element: string;
    /** Uncovered codepoints, ascending. */
    codepoints: number[];
  }
  export function uncoveredInSlides(input: UncoveredInput): Promise<UncoveredText[]>
  ```
  Task 9 consumes `uncoveredInSlides`.

**Key design point:** the Greek fixture needs **no font config**. Montserrat ships no Greek subset and Roboto Mono does, so a Greek character in an `h1` (body/display → Montserrat) is uncovered while the same character in `<code>` (→ Roboto Mono) is covered. The union model calls both covered — this fixture is the regression proof and reproduces on 0.10.

- [ ] **Step 1: Create the fixtures**

`test/fixtures/stack-coverage-deck/slides/01-greek.html`:

```html
<div class="slide">
  <h1>Δέλτα</h1>
  <p>Prose is latin only.</p>
  <p>Inline <code>Δέλτα</code> is monospace.</p>
</div>
```

`test/fixtures/stack-override-deck/slides/00-styles.html`:

```html
<style>
  .slide h2 {
    font-family: var(--zerp-font-mono);
  }
</style>
```

`test/fixtures/stack-override-deck/slides/01-override.html`:

```html
<div class="slide">
  <h2>Ærø</h2>
  <p>Ærø</p>
</div>
```

Note: `Æ` and `ø` are latin-1; both families cover them, so this fixture asserts the *override is seen and still resolves*. The genuinely-uncovered assertion lives in `stack-coverage-deck`. If a character covered by exactly one of the two families is needed later, prefer Greek — it is the only clean split between them.

- [ ] **Step 2: Write the failing test**

Rewrite `test/coverage.test.mjs`. Keep `coveredCodepoints`'s existing tests only if that export survives; the new tests are:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

import { uncoveredInSlides } from "../dist/check/coverage.js";

const cp = (character) => character.codePointAt(0);

test("a character the element's own stack cannot draw is reported", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-coverage-deck" });
  const heading = found.find((entry) => entry.element.startsWith("<h1"));
  assert.ok(heading, "the h1 resolves through the display stack, which is Montserrat");
  assert.ok(heading.codepoints.includes(cp("Δ")));
  assert.match(heading.stack.join(","), /Montserrat/);
  // The same character in <code> resolves through Roboto Mono, which has greek.
  assert.ok(!found.some((entry) => entry.element.startsWith("<code")));
});

test("the union model's blind spot is the point of the change", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-coverage-deck" });
  // Greek IS bundled — Roboto Mono pulls it in. A union over every face would
  // therefore call the heading covered. Per-stack does not.
  assert.ok(found.length > 0, "still reported despite the subset being present");
});

test("an author's font-family override is followed", async () => {
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/stack-override-deck" });
  assert.deepEqual(found, [], "latin-1 resolves in both families");
});

test("a default deck is clean", async () => {
  assert.deepEqual(await uncoveredInSlides({ rootDir: "test/fixtures/clean-deck" }), []);
});

test("chrome is never judged", async () => {
  // ← is the nav button's label and no bundled face covers it. It is zerp's
  // own, and it is not slide content.
  const found = await uncoveredInSlides({ rootDir: "test/fixtures/clean-deck" });
  assert.ok(!found.some((entry) => entry.codepoints.includes(cp("←"))));
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm build && node --test test/coverage.test.mjs`
Expected: FAIL — `uncoveredInSlides` is not exported.

- [ ] **Step 4: Write the implementation**

Rewrite `src/check/coverage.ts`. It now builds the document itself so it can walk it, mirroring what `checker.ts` does; `checker.ts` will pass its already-parsed pieces in Task 9 to avoid parsing twice.

```ts
import { readFile } from "node:fs/promises";

import { parseHTML } from "linkedom";

import { type FontFaceInfo, selectedFaces } from "../fonts.js";
import { buildPresentationHtml, deckCodepoints } from "../presentation.js";
import { StyleResolver } from "./cascade.js";
import { parseFontStack, StackResolver } from "./font-stack.js";
import { parseStylesheets, type CssModel, type StyleSheetInput } from "./css-model.js";
import type { DomElement } from "./types.js";
import { woff2Codepoints } from "../woff2.js";

/**
 * Slide characters the deck cannot draw *through the stack they render in*.
 *
 * The check this replaces unioned every bundled face and asked whether any of
 * them carried the character. That was honest while every element resolved
 * through one family; with a display role and with author overrides it is not,
 * and the failure it misses is the silent one — a character drawn by whatever
 * the viewing machine falls back to, differently on every OS, and re-resolved
 * again when the deck is exported.
 *
 * Selection is untouched: the build still inlines subsets chosen by the FULL
 * document. Only judging is per-stack, and only slide content is judged.
 */

// Pictographs are exempt. No text font carries them: every platform draws them
// from its own colour emoji font by design, which is also what an export
// pipeline does, so "uncovered" would be true, universal, and useless. Flag
// sequences are regional indicators rather than pictographs, hence both.
const EXEMPT = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const NON_RENDERING = /[\s\p{Cc}\p{Cf}]/u;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);

const cmapCache = new Map<string, Promise<Set<number>>>();

function cmapOf(file: string): Promise<Set<number>> {
  const cached = cmapCache.get(file);
  if (cached) {
    return cached;
  }
  const codepoints = readFile(file).then(woff2Codepoints);
  cmapCache.set(file, codepoints);
  return codepoints;
}

export interface UncoveredText {
  slideIndex: number;
  stack: string[];
  element: string;
  codepoints: number[];
}

export interface UncoveredInput {
  rootDir: string;
  /** Reuse the caller's parse when there is one; otherwise it is built here. */
  document?: { querySelectorAll(selector: string): { length: number; [i: number]: unknown } };
  model?: CssModel;
}

function elementLabel(el: DomElement): string {
  const cls = el.getAttribute("class");
  return `<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ""}>`;
}

async function loadStackResolver(
  rootDir: string,
  faces: readonly FontFaceInfo[],
): Promise<StackResolver> {
  const cmaps = new Map<string, ReadonlySet<number>>();
  for (const face of faces) {
    cmaps.set(face.file, await cmapOf(face.file));
  }
  return new StackResolver(faces, cmaps);
}

export async function uncoveredInSlides(input: UncoveredInput): Promise<UncoveredText[]> {
  let { document, model } = input;
  if (!document || !model) {
    const html = await buildPresentationHtml({ rootDir: input.rootDir });
    const parsed = parseHTML(html) as unknown as { document: NonNullable<typeof document> };
    document = parsed.document;
    const styleNodes = document.querySelectorAll("style");
    const sheets: StyleSheetInput[] = [];
    for (let i = 0; i < styleNodes.length; i++) {
      const node = styleNodes[i] as DomElement;
      sheets.push({
        css: node.textContent ?? "",
        origin: node.getAttribute("data-zerp") ? "framework" : "deck",
      });
    }
    model = parseStylesheets(sheets);
  }

  const codepoints = await deckCodepoints(input.rootDir);
  const faces = await selectedFaces(input.rootDir, codepoints.full);
  const stacks = await loadStackResolver(input.rootDir, faces);
  // font-family does not vary by theme, so one resolver answers for both.
  const resolver = new StyleResolver(model, model.themeVars.dark);

  const found: UncoveredText[] = [];
  const slideNodes = document.querySelectorAll(".slide");

  const judge = (el: DomElement, text: string, slideIndex: number): void => {
    const stack = parseFontStack(resolver.resolveVars(resolver.computedFor(el).fontFamily));
    const missing = new Set<number>();
    for (const character of text) {
      if (NON_RENDERING.test(character) || EXEMPT.test(character)) {
        continue;
      }
      const codepoint = character.codePointAt(0);
      if (codepoint !== undefined && !stacks.resolves(stack, codepoint)) {
        missing.add(codepoint);
      }
    }
    if (missing.size > 0) {
      found.push({
        slideIndex,
        stack,
        element: elementLabel(el),
        codepoints: [...missing].sort((left, right) => left - right),
      });
    }
  };

  const walk = (el: DomElement, slideIndex: number): void => {
    if (SKIP_TAGS.has(el.tagName) || el.getAttribute("aria-hidden") === "true") {
      return;
    }
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (!child) {
        continue;
      }
      if (child.nodeType === 3) {
        const text = child.textContent ?? "";
        if (/\S/.test(text)) {
          judge(el, text, slideIndex);
        }
      } else if (child.nodeType === 1) {
        walk(child as DomElement, slideIndex);
      }
    }
  };

  for (let i = 0; i < slideNodes.length; i++) {
    walk(slideNodes[i] as DomElement, i);
  }

  // `content:` literals have no DOM node, so they are judged from the rules
  // that declare them: match the originating selector, then resolve the stack
  // the rule itself sets (zerp's markers name --zerp-font-marker precisely so
  // `→` resolves) or the element's own if it sets none.
  for (const rule of model.rules) {
    if (rule.pseudoElement === null) {
      continue;
    }
    const literal = rule.declarations.get("content");
    if (!literal || !/["']/.test(literal)) {
      continue;
    }
    const text = literal.replace(/^["']|["']$/g, "");
    const own = rule.declarations.get("font-family");
    for (let i = 0; i < slideNodes.length; i++) {
      const slide = slideNodes[i] as DomElement;
      let matched: DomElement | null = null;
      const find = (el: DomElement): void => {
        if (matched) {
          return;
        }
        try {
          if (el.matches(rule.selector)) {
            matched = el;
            return;
          }
        } catch {
          return;
        }
        for (let j = 0; j < el.childNodes.length; j++) {
          const child = el.childNodes[j];
          if (child && child.nodeType === 1) {
            find(child as DomElement);
          }
        }
      };
      find(slide);
      if (!matched) {
        continue;
      }
      const raw = own ?? resolver.computedFor(matched).fontFamily;
      const stack = parseFontStack(resolver.resolveVars(raw));
      const missing = new Set<number>();
      for (const character of text) {
        if (NON_RENDERING.test(character) || EXEMPT.test(character)) {
          continue;
        }
        const codepoint = character.codePointAt(0);
        if (codepoint !== undefined && !stacks.resolves(stack, codepoint)) {
          missing.add(codepoint);
        }
      }
      if (missing.size > 0) {
        found.push({
          slideIndex: i,
          stack,
          element: `${elementLabel(matched)}${rule.pseudoElement}`,
          codepoints: [...missing].sort((left, right) => left - right),
        });
      }
    }
  }

  return found;
}
```

Delete `coveredCodepoints` and `uncoveredCodepoints` only after Task 9 stops importing them; for this task, leave them in place so the build stays green.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm build && node --test test/coverage.test.mjs`
Expected: PASS. If the `<code>` assertion fails, check that `base-styles.css` sets `--zerp-font-mono` on `code` (it does, `:239`) and that the Greek subset was actually selected — `node -e` a call to `selectedFaces` and look for `roboto-mono-greek`.

- [ ] **Step 6: Commit**

```bash
git add src/check/coverage.ts test/coverage.test.mjs test/fixtures/stack-coverage-deck test/fixtures/stack-override-deck
git commit -m "Judge glyph coverage against the stack each character renders in"
```

---

### Task 9: Report stack-aware findings

**Files:**
- Modify: `src/check/checker.ts:9` (import), `:206-233` (the coverage finding)
- Modify: `src/check/coverage.ts` (delete the superseded exports)
- Test: `test/checker.test.mjs`

**Interfaces:**
- Consumes: `uncoveredInSlides`, `UncoveredText` (Task 8).
- Produces: `Finding`s with real `slideIndex` attribution. No `types.ts` change — the existing `Finding` shape carries it.

- [ ] **Step 1: Write the failing test**

Add to `test/checker.test.mjs`:

```js
test("an uncovered character names its slide, its element and its stack", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/stack-coverage-deck" });
  const finding = report.findings.find((entry) => entry.message.includes("no glyph"));
  assert.ok(finding);
  assert.equal(finding.severity, "warning");
  assert.equal(finding.slideIndex, 1, "attributed to the slide, not the deck");
  assert.match(finding.message, /Montserrat/, "the stack that failed");
  assert.match(finding.snippet, /Δ/);
});

test("a clean deck reports no coverage findings", async () => {
  const report = await checkPresentation({ rootDir: "test/fixtures/clean-deck" });
  assert.equal(report.findings.filter((entry) => entry.message.includes("no glyph")).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && node --test test/checker.test.mjs`
Expected: FAIL — `slideIndex` is 0 and the message names no stack.

- [ ] **Step 3: Write the implementation**

In `src/check/checker.ts`, replace the import at `:9`:

```ts
import { uncoveredInSlides } from "./coverage.js";
```

and replace the whole coverage block at `:206-233`:

```ts
  // Glyph coverage: a character the stack it renders in cannot draw is not a
  // styling mistake, it is a promise the deck cannot keep. It renders from
  // whatever the viewing machine falls back to, and an export re-resolves it on
  // the reader's machine. Theme-independent, so it is reported once against the
  // first requested theme rather than duplicated into every theme's group.
  if (structuralTheme) {
    const uncovered = await uncoveredInSlides({ rootDir: options.rootDir, document, model });
    for (const entry of uncovered) {
      const shown = entry.codepoints.slice(0, MAX_LISTED_CODEPOINTS);
      const points = shown.map((code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`);
      const rest = entry.codepoints.length - shown.length;
      const suffix = rest > 0 ? `, +${rest} more` : "";
      const slide = slideNodes[entry.slideIndex] as DomElement | undefined;
      const count = entry.codepoints.length;
      findings.push({
        severity: "warning",
        theme: structuralTheme,
        slideIndex: entry.slideIndex + 1,
        slideSrc: slide?.getAttribute("data-zerp-src") ?? null,
        slideSrcSlide: slide?.getAttribute("data-zerp-src-slide") ?? null,
        snippet: shown.map((code) => String.fromCodePoint(code)).join(" "),
        message: `${count} character${count === 1 ? "" : "s"} (${points.join(", ")}${suffix}) in ${entry.element} ${count === 1 ? "has" : "have"} no glyph in ${entry.stack.join(", ") || "the fallback stack"} — ${count === 1 ? "it renders" : "each renders"} via system fallback, which looks different on every machine and in exports`,
        suggestion: "use characters the stack's families cover, or set a family that covers them",
      });
    }
  }
```

Then delete `coveredCodepoints` and `uncoveredCodepoints` from `src/check/coverage.ts`, along with the now-unused `DeckCodepoints` import. Check for other importers first:

```bash
grep -rn "uncoveredCodepoints\|coveredCodepoints" src/ test/ scripts/
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm build && node --test test/`
Expected: PASS across the whole suite. `uncovered-glyph-deck`'s existing expectations in `checker.test.mjs` will need their message text updated to the new wording — that fixture stays, since a character no family covers is still uncovered under the new model.

- [ ] **Step 5: Commit**

```bash
git add src/check/checker.ts src/check/coverage.ts test/checker.test.mjs
git commit -m "Report uncovered characters with slide, element and stack"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md:159-190`
- Modify: `llms.txt:270-300`
- Modify: `docs/style-system.html` (type section)
- Modify: `CHANGELOG.md`
- Regenerate: `docs/style-system.pdf`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code-facing.

- [ ] **Step 1: Update README.md**

In the deck-configuration section, add `display` to the example and document the fallback rules:

```json
  "zerp": {
    "fonts": {
      "display": { "family": "Bebas Neue", "weights": ["400"] },
      "body": { "family": "Inter" },
      "mono": { "family": "JetBrains Mono" }
    }
  }
```

Add bullets:

```markdown
- `display` sets the face for `h1`. Unset, it follows `body` — family, package
  and weights — so a deck that names only `body` gets that family everywhere.
- `mono` unset stays Roboto Mono; it never follows `body`, because the nav,
  code, tables and labels need real monospace metrics.
- The display face applies to `h1` only. Move others onto it from your own
  stylesheet — `h2 { font-family: var(--zerp-font-display) }` — or off it with
  `h1 { font-family: var(--zerp-font-body) }`; zerp's rule carries zero
  specificity so a plain element selector wins.
```

Change "the four stacks" to "the five stacks" in the final bullet.

- [ ] **Step 2: Update llms.txt**

Two edits. In the fonts section, mirror the README bullets above (three roles, the `display` → `body` fallback, the `h1`-only scope, the override idiom).

In the coverage section, replace the union-model description. The current text says a character has "no glyph in any bundled font"; that is no longer what is checked. Replace with:

```markdown
`zerp check` reports characters your slides use that **the font stack they
render in** cannot draw, as one `⚠` per element, naming the slide, the element
and the stack. It reads the actual `cmap` of each bundled woff2, so it knows,
for example, that `※` sits inside Montserrat's declared latin range and is
still not in the file.

This is per-stack, not per-deck: Greek is available to Roboto Mono and not to
Montserrat, so `Δ` in a `<code>` block is fine while the same character in an
`<h1>` is not. Bundling a subset for one role does not cover another role.
```

Keep the existing bullets about what is and is not covered, and the emoji exemption.

- [ ] **Step 3: Update the style-system guide and reprint**

Add the display role to `docs/style-system.html`'s type section: the three roles, the `h1` default, and the override idiom. Then:

```bash
pnpm build:docs
```

Read `docs/style-system.pdf` and confirm the type section renders correctly and the footer stamps the new version.

- [ ] **Step 4: Update CHANGELOG.md**

Add a `0.11.0` entry following the file's existing format, covering: the `display` role and its fallback; the `h1` default and how to override it; stack-aware coverage and the new finding shape; and the compatibility note that a deck using `display` will not build on 0.10.

- [ ] **Step 5: Commit**

```bash
git add README.md llms.txt docs/style-system.html docs/style-system.pdf CHANGELOG.md
git commit -m "Document the display role and stack-aware coverage"
```

---

### Task 11: Full verification, fixture tuning, version bump

**Files:**
- Modify: `package.json` (version)
- Modify (as needed): `test/fixtures/kitchen-sink/slides/**`, `examples/casino/slides/**`
- Regenerate (as needed): `examples/**/index.html`

**Interfaces:**
- Consumes: everything above.
- Produces: a green tree.

- [ ] **Step 1: Run the full suite**

```bash
pnpm check
pnpm lint
pnpm format:check
pnpm test
```

Expected: all green. Fix anything that fails before continuing.

- [ ] **Step 2: Check the required fixtures in both themes**

```bash
node dist/cli.js check test/fixtures/kitchen-sink
node dist/cli.js check examples/casino
```

Expected: clean. **This is where the plan's main unknown lives.** Per-stack coverage is strictly stricter than the union it replaces, so characters that passed before may now be reported — most likely a symbol in a heading that Montserrat lacks. Tuning the slides is in scope: prefer changing the character to one the stack covers, per `llms.txt`'s existing guidance, over widening a font stack. If a finding is a false positive, it is a bug in Task 6 or 8 — fix the code, not the fixture.

- [ ] **Step 3: Verify geometry and the browser contract**

```bash
node dist/cli.js verify examples/casino --theme both --size 1280x720
pnpm test:browser
```

Expected: pass. If `examples/**/index.html` are tracked build outputs, regenerate them with `node dist/cli.js build examples/<deck>` — never by hand.

- [ ] **Step 4: Look at the display role**

```bash
pnpm shot test/fixtures/display-font-deck --slide 1 --theme both --scale 2
```

Read the PNGs in `shots/`. Confirm the `h1` renders in Roboto Mono and the `<p>` does not. Per AGENTS.md: measure, then look — do not judge this from memory.

- [ ] **Step 5: Bump the version**

Set `"version": "0.11.0"` in `package.json`. Do not tag, publish, or merge.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Release prep: 0.11.0"
```

---

## Notes for the executor

- **`pnpm test` builds first.** A test importing `../dist/…` that fails with "not exported" usually means a stale build, not a missing implementation.
- **Task 7 is load-bearing for Task 8.** If `::before` rules are not in `model.rules`, the `content:` half of coverage silently checks nothing and its tests pass vacuously. Assert the rule is found before assuming coverage works.
- **The `:where()` choice in Task 3 is deliberate.** Do not "fix" it to `.slide h1` — zero specificity is the feature. `test/build-output.test.mjs` asserts the exact selector.
- **Do not change `src/fonts.ts`'s selection logic in Part 2.** Selection stays union-over-full-document; only judging is per-stack. Narrowing selection to match would break decks whose scripts render characters that appear only in string literals.
