# Display font role and stack-aware glyph coverage

Target version: 0.11.0. Branch: `feat/display-role-and-stack-coverage`.
Breaking changes are acceptable.

Two changes ship together. The first adds a third configurable font role. The
second replaces `zerp check`'s union-based glyph coverage with one that resolves
the font stack each character actually renders through. They are separable, but
the first is what makes the second worth doing: once headings can resolve
through a different family than body text, the union model starts passing decks
that render fallback glyphs.

---

## Part 1 — The `display` font role

### Purpose

A deck can currently name two families: `body` and `mono`. The classic deck
pairing is three — a display face for titles, a text face for prose, mono for
code and data. There is no way to express that today, and no way to fake it: the
framework inlines the woff2 subsets it selects, so a deck-side `@font-face`
would either point at an external URL (breaking the single-file offline
guarantee) or require hand-pasted base64.

### Configuration

`src/deck-config.ts` gains `display` alongside `body` and `mono`: same three
keys (`family`, `fontsourcePackage`, `weights`), same validation, same error
wording with the role name substituted.

```json
{
  "dependencies": {
    "@fontsource/bebas-neue": "^5",
    "@fontsource/inter": "^5",
    "@fontsource/jetbrains-mono": "^5"
  },
  "zerp": {
    "fonts": {
      "display": { "family": "Bebas Neue", "weights": ["400"] },
      "body": { "family": "Inter" },
      "mono": { "family": "JetBrains Mono" }
    }
  }
}
```

`FONT_ROLES` becomes `["body", "display", "mono"]`. Because `checkKeys` rejects
unknown keys, a deck using `display` will not build on zerp 0.10 — acceptable
for 0.11, and it fails loudly with a message naming the key.

### Fallback semantics

- `display` unset falls back to the **resolved body plan** — family,
  `fontsourcePackage` and `weights` — not to the `BODY` constant. A deck that
  sets `body` to Inter and says nothing about `display` gets Inter headings.
- `mono` unset falls back to the `MONO` constant (Roboto Mono), unchanged. It
  does **not** fall back to body: `--zerp-font-nav` and every code, table and
  label rule need real monospace metrics.

This makes `planFamilies` order-dependent — body resolves first and is passed in
as display's fallback — rather than mapping three roles independently.

### Token and CSS

`familyTokenCss` emits a fifth token:

```css
--zerp-font-display: "<display>", "Zerp Symbols", sans-serif;
```

`Zerp Symbols` is named for the same reason body names it: `→` is not in
Montserrat's latin subset, and `<h2>Growth → 2027</h2>` under a display-only
stack would otherwise draw an OS-dependent arrow.

`src/assets/base-styles.css` defines the default in `:root` next to the existing
four, so `var(--zerp-font-display)` resolves in every deck whether configured or
not, and applies it:

```css
:where(.slide h1) {
  font-family: var(--zerp-font-display);
}
```

`:where()` is deliberate, following the existing soft-defaults convention at
`base-styles.css:177-179`. It gives the rule **zero specificity** so a deck
author can undo it with a plain `h1 { font-family: var(--zerp-font-body) }` in
`slides/00-styles.html`. With the natural `.slide h1 { … }` an author would have
to match `.slide h1` to opt out, which makes the feature awkward to decline.
Opting *in* elsewhere (`h2 { font-family: var(--zerp-font-display) }`) works
either way, since a rule targeting `h2` directly beats the value it inherits
from `.slide`.

Scope is `h1` only. `.slide.title h1` needs no separate rule — it is already
inside `.slide h1`. `h2`, `h3`, `.stat .value` and card titles stay on body;
authors move them per deck. `h3` in particular doubles as a muted subtitle and
as a card title at 1.4em, where a true display face reads as weak or cramped.

### Invariants

- A deck that configures no fonts produces a **byte-identical** document.
  `familyTokenCss` already returns `""` unless some role is `configured`, and
  the new `:root` default plus the `:where` rule resolve to the same Montserrat
  stack `.slide` already inherited.
- `display` identical to `body` costs **zero extra bytes**: `selectFaceBlocks`
  dedups by woff2 path.
- Subset selection is unchanged — still driven by the full-document codepoint
  set, now across three plans instead of two.

---

## Part 2 — Stack-aware glyph coverage

### The problem

`coveredCodepoints` (`src/check/coverage.ts:44`) unions every bundled face: a
character is covered if *any* face can draw it. The existing comment concedes
this ("which face a given font stack would actually reach for is a harder
question and deliberately not asked here"), and today the concession is nearly
free, because headings and body text resolve to the same family.

Part 1 makes it cost something. Concretely, with Montserrat as body and Roboto
Mono as display — Montserrat ships no Greek subset, Roboto Mono does — a Greek
`<h1>` passes `check` clean and then renders from the system fallback. The same
hole already exists today for any author CSS that moves text onto the mono
stack.

### Approach

Resolve, per character, the stack it actually renders through, then walk that
stack for a face that can draw it. Two prerequisites already exist:

- `StyleResolver` (`src/check/cascade.ts:109`) is a real cascade engine —
  selector matching, specificity plus source-order sorting, inline `style`
  merging, `var()` expansion, memoized parent walking for inherited properties.
- `walkText(el, (text, parentEl) => …)` (`checker.ts:86`) already yields every
  text run with its parent element, and is already used for the contrast pass.

**Selection in `src/fonts.ts` does not change.** It keeps using the full-document
union to decide what ships; only judging becomes stack-aware.

### Components

1. **`ComputedText.fontFamily`** (`cascade.ts`). An inherited string property,
   handled exactly like `color` at `cascade.ts:212-213`: own declaration if
   present, else the parent's. `resolveVars` already expands
   `var(--zerp-font-display)`.

2. **Stack parsing.** Split the resolved value on top-level commas, strip quotes
   and whitespace, keep order. Generic families (`sans-serif`, `monospace`,
   `serif`, `system-ui`, …) terminate the stack: reaching one means the
   character falls to the viewing machine.

3. **Family index.** Build `Map<familyName, FontFaceInfo[]>` from `selectedFaces`
   (lowercased keys — `font-family` matching is case-insensitive).
   `FontFaceInfo` already carries `family`, `ranges` and `file`, and `cmapOf`
   already reads real cmaps.

4. **Character resolution.** For a character and a stack: for each named family
   in order, if any of its faces has the codepoint in both its declared
   `unicode-range` and its real cmap, the character resolves — stop. If the
   stack is exhausted, the character is uncovered *for that stack*.
   Weight is ignored: fontsource subsets share a cmap across weights, so
   family-level resolution is sufficient for coverage.

5. **The walk.** For each slide, `walkText` yields (text, parent); compute the
   parent's stack once per element, then test each character. Runs **once**, not
   per theme — `font-family` does not vary by theme. Cache by
   (stack, codepoint); decks repeat both heavily.

6. **Pseudo-element `content`.** `collectCssContent` (`codepoints.ts:136`)
   already extracts `content:` literals for *selection*, but a literal has no
   DOM node, so the walk above cannot judge it. Handle it from the CSS model
   instead: for each rule declaring `content`, strip the pseudo-element from the
   selector, match elements against the remainder, and resolve the stack for the
   originating element — honouring a `font-family` set in the same rule. This
   matters because zerp's own markers depend on it: `.slide ul li::before` and
   `.flow > * + *::before` set `--zerp-font-marker` precisely so `→` resolves.
   If a rule's selector cannot be matched, skip it rather than guess.

### Reporting

The current finding is one deck-wide warning listing codepoints
(`checker.ts:212-233`). Stack-aware coverage knows more, and the report should
say it:

> ⚠ `ж` in `<h1>` resolves to no bundled face (stack: Bebas Neue, Zerp Symbols,
> sans-serif) — renders via system fallback

Grouping: one finding per (slide, stack, character-set) rather than one per
character, reusing `MAX_LISTED_CODEPOINTS` truncation. Severity stays `warning`.
Slide attribution replaces today's `slideIndex: 0`, so a reader can find the
text. Still reported against the first requested theme only, since the result is
theme-independent.

### Scope boundaries

Judged: slide content only. Framework chrome stays zerp's own business, per the
existing `slideContent` / `full` split (`codepoints.ts:5-16`).

Known blind spots, unchanged by this work and to be stated in `llms.txt`:

- Text a slide script generates at runtime — linkedom does not execute scripts.
- Text inside `<svg>`, which already has its own dedicated warning
  (`checker.ts:172-204`).
- `font-family` set by a runtime script rather than a stylesheet.

### Expected fallout

Per-stack is strictly stricter than union, so decks that pass today may fail.
`kitchen-sink` and `casino` must stay clean (AGENTS.md), and tuning them is in
scope for the final checks. This is the main schedule risk: the work is unknown
until the check runs.

---

## Test fixtures

New fixtures, each minimal and single-purpose. All reuse `@fontsource/montserrat`
and `@fontsource/roboto-mono`, already in `dependencies` — cross-assigning roles
gives two genuinely different families with different subset coverage, so **no
new dependencies are needed**.

| Fixture | Configures | Asserts |
|---|---|---|
| `display-font-deck` | `display: Roboto Mono`, body default | Display token emitted; `h1` resolves to Roboto Mono; body unaffected |
| `display-fallback-deck` | `body: Roboto Mono` only | `--zerp-font-display` mirrors body; no extra faces inlined |
| `stack-coverage-deck` | nothing — defaults suffice | Greek `<h1>` is **uncovered** (Montserrat ships no Greek) while the same character in `<code>` is covered by Roboto Mono — the case the union model gets wrong. Demonstrable on 0.10, so it doubles as the regression proof |
| `stack-override-deck` | no font config | Author CSS in `00-styles.html` moves `h2` onto the mono stack; a character only body ships becomes uncovered |

Existing fixtures keep their current expectations: `custom-font-deck`,
`missing-font-deck` and `uncovered-glyph-deck` all still assert what they assert
today, which is the regression net for Part 1's byte-identical claim.

Test files touched: `deck-fonts.test.mjs`, `fonts.test.mjs`, `coverage.test.mjs`,
`checker.test.mjs`, `cascade.test.mjs`, `build-output.test.mjs`, and the
regenerated `test/fixtures/clean-deck/index.html`.

---

## Documentation

Kept current as part of this change, not after it:

- `README.md:159-190` — the three-role config block and the fallback rules.
- `llms.txt:270-300` — the role list, the display role's effect on headings, the
  author-override idiom, and a rewrite of the coverage section: it currently
  describes union semantics ("no glyph in any bundled font"), which stops being
  true.
- `docs/style-system.html` — the display role in the type section, then
  `pnpm build:docs` to reprint the PDF, and read it.
- `AGENTS.md` — only if the check's invocation or fixture rules change.
- `CHANGELOG.md` — 0.11.0 entry covering both parts and the config-compatibility
  break.

---

## Verification

- `pnpm check`, `pnpm lint`, `pnpm format:check`
- `pnpm test` — unit and CLI
- `node dist/cli.js check test/fixtures/kitchen-sink` — clean, both themes
- `node dist/cli.js check examples/casino` — clean, both themes
- `node dist/cli.js verify examples/casino --theme both --size 1280x720`
- `pnpm test:browser`
- `pnpm shot` on `display-font-deck` at `--scale 2` — read the PNG and confirm
  the h1 renders in the display face and body prose does not
- `pnpm build:docs` — read the regenerated PDF

## Out of scope

- Per-role `weights` defaults. The display role inherits body's five.
- More than three roles, or arbitrary named roles.
- Fonts outside the Google Fonts / fontsource directory. This stays a swap, not
  a font pipeline.
- Applying the display face beyond `h1` by default.
- Resolving *which weight* a face would match; coverage is family-level.
