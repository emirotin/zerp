# Browser-backed `check`, merged with `verify`

Target: 0.12.0. Breaking. Branch to be taken from the 0.11 line.

`zerp check` currently audits a deck with a hand-written partial CSS cascade
(~550 lines across `src/check/cascade.ts` and `src/check/css-model.ts`), while
`zerp verify` audits the same deck in real headless Chrome. This replaces the
static cascade with the browser and merges the two commands into one.

---

## Why

The static cascade is the least trustworthy code in the repo, and its gaps all
fail toward a clean report:

- **At-rules are skipped wholesale** — `if (this.atrule) return` means every
  rule inside any `@media`, `@supports` or `@layer` is invisible, including the
  `@media screen` block in `base-styles.css`.
- **`!important` is unmodelled.** Specificity alone decides.
- **The selector grammar is narrow.** `isSupportedSelector` rejects anything
  containing `[`, `]`, `+`, `~` or `:`, so attribute selectors, combinators and
  pseudo-classes are dropped. `examples/casino` reports **10 skipped
  selectors** today — those elements are simply not audited.
- Five separate defects were found in this subsystem during the 0.11 work
  alone: pseudo-element rules dropped before they could be audited; a
  `::before` rule leaking into its originating element's computed style; a bare
  `::before` collapsing to an unmatchable empty selector; `var()` resolved from
  a flat map rather than the cascade; and `:root` rules shadowing
  theme-specific values.

The justification for a browser-free auditor does not hold: **this repo has no
CI.** No `.github/workflows`, no other CI config; the pre-commit hook runs
`lint-staged` and `pnpm build` only. Every gate is run locally, on a machine
that already has Chrome for `verify`, `shot` and `build:docs`.

The speed argument is weaker than assumed. Measured on `examples/casino`
(33 slides):

| command                        | wall clock |
| ------------------------------ | ---------- |
| `check` (static, both themes)  | 0.74s      |
| `verify` (Chrome, both themes) | 3.68s      |

Chrome costs ~3s, and merging means one page load serves both audits.

## Why merge the commands

The split is an artifact of implementation, not of meaning: `verify` needed a
browser and `check` did not. Both take a deck, traverse every slide and every
element, and report per-slide findings. They differ only in which assertions
they run.

Once `check` runs at a real viewport its answers become viewport-dependent —
em chains, `@media` blocks, laid-out sizes. A `check` that passes while
`verify` reports the slide overflows is reporting contrast on a layout that is
already broken. They are two halves of one question: _is this deck sound at
this size, in this theme?_

Keeping them split costs two browser launches and two page loads per theme —
four for `--theme both` — to traverse the same DOM twice.

---

## Command surface

`zerp verify` is **removed**. `zerp check` absorbs its flags:

```
zerp check <deck> [--theme dark|light|both] [--size WxH]
                  [--only <categories>] [--safe-margin N]
                  [--timeout MS] [--browser-endpoint URL] [--json] [--strict]
```

- `--size` defaults to `1920x1080` (as `verify` does after 0.11).
- `--only` takes a comma-separated category list; absent means all.
- `--safe-margin`, `--timeout`, `--browser-endpoint`, `--json` carry over from
  `verify` unchanged.
- `--strict` keeps its current meaning for `check` severities.

### Finding categories

Every finding gains a `category`. The set is closed:

| category    | source                                          | severity        |
| ----------- | ----------------------------------------------- | --------------- |
| `contrast`  | APCA against the composited backdrop            | error           |
| `type-size` | font-size floors                                | error / warning |
| `surface`   | surface blends into its backdrop                | warning         |
| `glyph`     | text rendered by a non-bundled font             | warning         |
| `svg-text`  | `<text>` inside inline `<svg>`                  | warning         |
| `frame`     | frame count, active/visible state, active class | error           |
| `overflow`  | body height exceeds the viewport                | error           |
| `safe-zone` | element intrudes into the print-safe inset      | error           |
| `console`   | browser console or page errors                  | error           |

The first five come from today's `check`; the last four from today's `verify`.
`verify`'s current all-or-nothing failure list becomes findings at `error`
severity, so `formatReport` renders everything through one path.

`skippedSelectors` disappears from the report — nothing is skipped any more.

---

## Architecture

The controlling idea is a hard split between **probe** and **judge**, which is
what keeps the test suite fast and the judging logic unit-testable without a
browser.

### Probe (in-page, requires Chrome)

One `page.evaluate` per (theme, viewport) returns a plain serialisable
`DeckProbe`. It runs after `document.fonts.ready` so font-dependent layout is
settled — as `verify` already does.

For every slide, and for every element within it that the existing walk
would visit, the probe records:

- the element's tag, class attribute and a text snippet;
- `getComputedStyle` values: `color`, `backgroundColor`, `backgroundImage`,
  `fontSize`, `fontWeight`, `opacity`, `boxShadow`, `borderWidth`,
  `borderColor`;
- the ancestor chain's background values, so compositing can be done outside
  the page;
- geometry: bounding rects, body height, frame counts, active/visible state.

Console and page errors are collected on the page object, not in the evaluate.

Computed values arrive already resolved: no specificity, no inheritance walk,
no unit conversion, no `var()` substitution, no `@media` blindness, no
`!important` blindness.

### Glyph coverage (CDP, not `getComputedStyle`)

**`document.fonts.check()` is unusable and must not be used.** Verified against
a real build: it returns `true` for `'16px "Montserrat"'` with `Δ` (Montserrat
ships no Greek), for CJK, and for a font family that does not exist at all. It
answers "are the fonts that would be used already loaded", and fallback fonts
are always loaded.

Instead, use the Chrome DevTools Protocol:

```
CSS.getPlatformFontsForNode  ->  fonts: [{ familyName, glyphCount, isCustomFont }]
```

Verified against `test/fixtures/stack-coverage-deck`:

```
h1   (Greek, Montserrat stack):  Helvetica x5   isCustomFont: false
code (Greek, Roboto Mono):       Roboto Mono x5 isCustomFont: true
p    (latin prose):              Montserrat …   isCustomFont: true
```

Since zerp inlines **every** font it ships as `@font-face`, the rule is: **any
font with `isCustomFont: false` drawing glyphs in slide content means the deck
fell back.**

This is the renderer's own verdict, and it resolves problems the cmap approach
could only trade off:

- `font-family: Georgia, serif` is currently a forced choice between flagging
  every character (false positive) and flagging nothing (the `knows()`
  silence). Here Georgia is a system font, so it is a fallback, and it is
  reported. Correct, with no special case.
- A custom property declared outside `:root` no longer matters — nothing
  resolves `var()`.
- `unicode-range` over-claiming versus real cmap contents is the renderer's
  problem, already solved.

**Emoji exemption.** Emoji render from the platform's colour emoji font, which
is a system font, so the naive rule would flag them. The existing pictograph
exemption moves here: count the exempt characters (`\p{Extended_Pictographic}`,
`\p{Regional_Indicator}`) in the node's text and subtract them from the system
font's `glyphCount`. A finding is raised only when the remainder is positive.
Where a node's system-font glyph count is fully accounted for by exempt
characters, it is clean.

**Granularity.** This reports per node, not per codepoint: "this `<h1>`
rendered 5 glyphs in Helvetica" rather than "U+0394 is uncovered". This is a
deliberate trade — more actionable for an author, less precise. The message
must name the element, the fallback family and the glyph count, and the
existing text snippet carries enough context to find the characters.

### Judge (pure, no browser)

A pure function `judge(probe, options): Finding[]`. It keeps, essentially
unchanged:

- `src/check/apca.ts` — contrast maths and the size/weight thresholds.
- `src/check/color.ts` — parsing and alpha blending. Computed values arrive as
  `rgb()`/`rgba()`, so parsing gets simpler, not harder.
- background compositing over the ancestor chain, now over exact values.
- the surface-blend rule, the type-size floors, the report formatting.

Because `judge` is pure over a serialisable `DeckProbe`, its tests need no
browser: they run against recorded probe fixtures. Only the probe itself needs
an integration test with Chrome.

### Browser resolution and the no-Chrome error

**Already implemented; no work required.** `resolveBrowserExecutable`
(`src/verify.ts:250`) resolves in exactly the required order — `CHROME_BIN`
override, then playwright-core's managed chromium
(`chromium.executablePath()`), then a list of common system locations probed
with `--version` — and throws:

> No Chrome/Chromium found. Run `zerp install-browser` or set CHROME_BIN to a
> browser binary.

`zerp install-browser` is implemented (`src/cli.ts:248`) and backed by
`playwright-core`'s bundled `cli.js`. The only change is that `check` now
reaches this path too, so its failure mode without Chrome is this error rather
than a silent static fallback. There is no fallback by decision.

---

## What gets deleted

- `src/check/cascade.ts` — `StyleResolver` in full: `ownDeclarations`,
  `computedFor`, `backgroundFor`, `surfaceInfo`, `resolveVars`, `lookupVar`,
  `parseSize`, `parseWeight`, and the hardcoded `VIEWPORT`/`ROOT_PX`.
- `src/check/css-model.ts` — `specificityOf`, `isSupportedSelector`,
  `splitPseudoElement`, the rule model and `skippedSelectors`. Theme-var
  harvesting goes with it; themes are applied by setting the attribute in the
  page.
- `src/check/font-stack.ts` — `parseFontStack`, `StackResolver`, `knows()`.
- `src/check/coverage.ts` — the DOM walk, cmap intersection and `content:`
  handling.
- `src/woff2.ts` — verified: its only consumers are `src/check/coverage.ts` and
  its own `test/woff2.test.mjs`, so it dies with the coverage cmap reader.
- `selectedFaces` from `src/fonts.ts` — verified: consumed only by
  `src/check/coverage.ts` and `test/fonts.test.mjs`. `fonts.ts` uses
  `selectFaceBlocks` internally and keeps it; only the exported wrapper goes.

Measured, that is **1,203 lines deleted outright**:

| file                      | lines |
| ------------------------- | ----- |
| `src/check/cascade.ts`    | 382   |
| `src/check/coverage.ts`   | 327   |
| `src/woff2.ts`            | 215   |
| `src/check/css-model.ts`  | 165   |
| `src/check/font-stack.ts` | 114   |

plus `test/woff2.test.mjs` and the `selectedFaces` cases in
`test/fonts.test.mjs`. `src/verify.ts` (586 lines) is not deleted — its probe
and browser plumbing are folded into the shared probe, and its command entry
point goes.

With those lines goes every gap listed under **Why**.

## What stays

- `src/codepoints.ts` — **build-time** subset selection, which has no browser.
  Untouched.
- `src/fonts.ts` font planning and inlining — untouched.
- `apca.ts`, `color.ts`, `report.ts` — the judging and reporting layer.
- `resolveBrowserExecutable`, `installBrowser`, the browser-endpoint plumbing.

---

## Testing

The current suite is 155 tests, of which 13 are browser-gated. Moving `check`
into the browser threatens to make most audit tests require Chrome. The
probe/judge split is what prevents that:

- **Judge tests (no browser, fast).** Recorded `DeckProbe` fixtures per
  scenario — a low-contrast pair, a small type size, a blending surface, a
  fallback font, an overflowing slide. These replace today's `cascade`,
  `css-model`, `coverage` and `checker` unit tests and keep the same expected
  findings, so they remain the regression net across the migration.
- **Probe tests (browser, integration).** One per category, asserting the probe
  reports the right raw facts for a fixture deck. These join the existing
  browser-gated suite.
- **End-to-end.** `test/fixtures/kitchen-sink` and `examples/casino` must
  report clean in both themes, as today.

**Expect new findings.** The browser sees what the static cascade could not:
casino's 10 skipped selectors become audited, `@media` blocks become visible,
and `!important` starts counting. Any finding this surfaces is real by
construction — the static engine was wrong, not the deck. Triaging and fixing
those decks is in scope, and the count is unknown until it runs. This is the
migration's main risk.

Probe fixtures must be regenerated from a real browser rather than
hand-written, and the generator script should be committed so they can be
refreshed.

---

## Migration for deck authors

- `zerp verify` no longer exists; `zerp check` covers it.
- `zerp check` now requires Chrome/Chromium and errors with an install hint
  without it. `playwright-core` is already a runtime dependency, but it does
  not bundle a browser.
- Findings gain a `category`; `--only` narrows.
- `skippedSelectors` is gone from the report and from `--json`.
- Glyph findings name an element and a fallback font family rather than listing
  codepoints.

`README.md`, `llms.txt`, `AGENTS.md`, `MIGRATION.md`, `CHANGELOG.md` and
`docs/style-system.html` all reference the two-command split and must be
updated in the same change.

## Out of scope

- Any browser other than Chrome/Chromium. CDP is Chrome-specific and
  `getPlatformFontsForNode` has no cross-browser equivalent.
- A no-browser fallback engine.
- Per-codepoint glyph reporting.
- Changing APCA thresholds, the type-size floors, or the surface-blend
  heuristic — this moves where facts come from, not what counts as a defect.
