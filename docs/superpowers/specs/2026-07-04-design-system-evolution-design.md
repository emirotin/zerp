# zerp design-system evolution — design spec

Date: 2026-07-04
Status: approved pending final user review
Target version: 0.2.0 (breaking; no compatibility layer)

## Context

Analysis of three real decks (prime_ai — built on zerp 0.1.2; vrbas26_ai and vrbas26_casino — pre-zerp ancestors of the framework CSS) shows the current defaults are too thin: decks accumulated 200+ lines of custom CSS and 90–400 inline `style=""` attributes each, repeating the same patterns (cards, flex-centering, styled tables, stat rows, comparisons, tinted highlights). Colors are hardcoded GitHub-dark hexes. Two default tokens invite contrast failures (`--zerp-faint` ≈ APCA Lc 20 used for 0.8em text; `--zerp-muted` borderline on panels). Existing decks read well only because the author manually iterated on font sizes and contrast.

## Goals

1. Replace hardcoded colors with a concise, expressive palette derived from Evil Martians' **Harmony** (OKLCH; uniform APCA contrast per step across hues).
2. Ship a **light theme** alongside dark, mechanically derived via Harmony step mirroring.
3. Make built-in CSS rich enough that an LLM authoring a deck needs custom CSS only in rare cases; foundational classes must be few, well-named, and fully documented in llms.txt.
4. Make first-shot output readable: safe size/contrast defaults, a built-in **APCA checker** (`zerp check`) the model can run, and llms.txt instructions that enforce the loop.

## Non-goals

- No font changes (Montserrat + Roboto Mono stay; proven Cyrillic support).
- No compatibility aliases for 0.1.x class/variable names. Old decks keep using old zerp versions. A migration guide for LLMs is a nice-to-have deliverable, not code.
- No headless-browser rendering in the checker (static analysis only).
- No changes to the deck contract (slides/ discovery, ordering, Markdown splitting, URL rewriting).

## Decisions log (from brainstorming)

- Theme selection: CLI flag sets deck default; absent flag → `system`; 3-position UI switch (hideable behind tiny trigger); last choice in localStorage.
- Checker: purpose-built static analyzer, zero heavy deps, checks both themes each run.
- Accents: 7 hues — blue, green, orange, purple, red, amber, teal — as role tokens, not raw scales.
- CSS architecture: semantic-first element defaults + ~15 archetype components + bounded micro-utilities.
- Compatibility: none. v0.2.0 is a clean break.

---

## 1. Color tokens

### Source and generation

- `@evilmartians/harmony` (MIT) added as **devDependency**.
- New generator step in `scripts/build.mjs` (or a small `scripts/generate-tokens.mjs` it calls): reads Harmony's base JSON export, emits the token CSS blocks, concatenates them with the hand-authored base stylesheet into `dist/assets/default-styles.css`. The hand-authored source (`src/assets/base-styles.css`, renamed from `default-styles.css`) contains no raw color values — only `var(--zerp-*)` references.
- The generator also emits `dist/check/token-contrast.json`: precomputed APCA Lc for every token pair used by the checker's suggestion engine.

### Neutrals (Harmony `gray`, hue 275)

| Token            | Dark     | Light    | Role                                                                                                                       |
| ---------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| `--zerp-bg`      | gray-950 | gray-100 | page background                                                                                                            |
| `--zerp-surface` | gray-900 | gray-50  | cards, panels, code blocks                                                                                                 |
| `--zerp-border`  | gray-800 | gray-300 | borders, dividers, rules                                                                                                   |
| `--zerp-text`    | gray-100 | gray-900 | body text (Lc ≈ 100)                                                                                                       |
| `--zerp-muted`   | gray-300 | gray-700 | secondary text (Lc ≈ 77 — passes APCA at 16px/400)                                                                         |
| `--zerp-faint`   | gray-600 | gray-400 | decorative only: arrows, tick marks, disabled glyphs. **Never text.** Documented in llms.txt and enforced by `zerp check`. |

Rationale for muted at Lc ≈ 77 rather than 65: `fontLookupAPCA` requires roughly ≥19px at weight 400 for Lc 65, which would fail 16–18px captions/labels; Lc 77 passes from ~15px up, keeping secondary text safe at every size the framework ships.

### Accent hues

Seven hues: `blue`, `green`, `orange`, `purple`, `red`, `amber`, `teal`. Per hue, three roles:

| Token                | Dark     | Light    | Use                                                                                           |
| -------------------- | -------- | -------- | --------------------------------------------------------------------------------------------- |
| `--zerp-<hue>`       | step 400 | step 600 | colored text on the page/surface background (Lc ≈ 65; intended for body-size and larger text) |
| `--zerp-<hue>-solid` | step 600 | step 600 | filled backgrounds: badges, progress fills, filled cells                                      |
| `--zerp-<hue>-tint`  | step 900 | step 100 | subtle colored wash: highlight cards, table rows, pills                                       |

Shared: `--zerp-on-solid` (near-white; gray-50) — text on any `-solid` background. Solid 600 + white text yields |Lc| ≈ 60+, valid for the bold/large text badges use.

### Semantic aliases

`--zerp-accent` → blue, `--zerp-ok` → green, `--zerp-warn` → amber, `--zerp-danger` → red. Components reference semantic tokens where meaning exists (e.g. `.key-thought` border = accent), hue tokens where color is categorical.

Total public tokens: 6 neutrals + 7×3 hue roles + 1 on-solid + 4 semantic aliases = **32**. Small enough to list exhaustively in llms.txt.

## 2. Theming mechanics

- Generated CSS defines: `:root[data-zerp-theme="dark"] { … }`, `:root[data-zerp-theme="light"] { … }`, and duplicates gated by `@media (prefers-color-scheme: …)` for `:root[data-zerp-theme="system"]` (and `:root` without the attribute, as a no-JS fallback). Duplication is free — it's generated.
- `color-scheme: dark` / `light` set in each block so native UI matches.
- Build: `zerp build|serve [--theme dark|light|system]`. The flag bakes `data-zerp-theme="<default>"` into the generated `<html>` element plus a `data-zerp-default-theme` attribute the runtime reads. No flag → `system`.
- Runtime resolution at load: `localStorage["zerp-theme"]` (if valid) → `data-zerp-default-theme` → `system`.
- UI: a small ◐ button rendered near the existing nav controls (same de-emphasized chrome styling). Click expands a 3-position segmented switch — Light / System / Dark; selection collapses it, sets the attribute, persists to localStorage. Keyboard `t` cycles through the three positions. `system` live-follows OS changes via `matchMedia` listener.
- Runtime chrome (nav, counter, progress, theme switch) restyled with tokens and compliant sizes (nav/counter: 1em Roboto Mono, muted).

## 3. Foundational CSS

Principle: bare Markdown output must look finished with zero classes; the observed slide archetypes must each have a one-class (or one-recipe) answer; utilities cover layout glue only.

### 3.1 Element defaults (new or upgraded)

- Headings/paragraph/list scale: keep current proven sizes (h1 3.2em/900, h2 2.2em/700, h3 1.4em/700 muted, p/li 1.25em). `li::before` arrow stays.
- `<ol>`: styled numbered list — big Roboto Mono accent numbers via CSS counters, subtle divider between items (generalizes prime_ai's takeaway-list). `<ul>` keeps arrows.
- `<table>`: padded cells (10px 16px), header row 700 with border-bottom, subtle row borders, centered by default within slide flow; numeric tables opt into `.mono`. Row/cell highlighting via `.tint-<hue>` on `<tr>`/`<td>`.
- `<blockquote>`: absorbs the current `.quote` look (accent left border, surface bg, italic). `.quote` class removed; Markdown `>` quotes get it free.
- `<code>` inline: Roboto Mono, surface bg, padding, radius. `<pre>`: surface bg, border, radius, padding, left-aligned, scrolls if oversized.
- `<figure>` / `<figcaption>`: centered image + caption (caption = 1.125em muted, replaces `.caption` semantics; `.caption` class kept as the same style for non-figure use).
- `<img>` bare: `max-width: 100%; max-height: 60vh; border-radius: 10px;` block-centered when direct child of slide/figure.
- `<a>`: accent color, underline on hover. `<hr>`: border-color divider. `<kbd>`: mono, surface, border, radius. `<strong>`: weight 700 (no color change).

### 3.2 Components (~15)

| Class                                      | Purpose / notes                                                                                                                                                                                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.card`                                    | surface bg + border + radius 14px + padding. THE most-repeated deck pattern. Composable with `.tint-<hue>` (tinted bg, hue-text border).                                                                                                                                                                    |
| `.cols-2` `.cols-3` `.cols-4`              | equal-column grid, 32px gap, `align-items: center`. Replaces `.two-col` (removed).                                                                                                                                                                                                                          |
| `.stat`                                    | centered stat unit: child `.value` (3em, mono, 900, accent by default) + `.label` (muted).                                                                                                                                                                                                                  |
| `.stat-row`                                | flex row of `.stat`s, centered, generous gap. Replaces ad-hoc big-number wrappers. `.big-number` class removed.                                                                                                                                                                                             |
| `.compare`                                 | 1fr auto 1fr grid; two children + CSS-generated centered divider from `data-vs` attribute (default "vs"), faint, bold.                                                                                                                                                                                      |
| `.flow`                                    | horizontal process row; arrow separators CSS-generated between children (`> * + *::before`), faint.                                                                                                                                                                                                         |
| `.steps`                                   | auto-numbered grid of cards (CSS counters render 01/02/03 in mono accent); children are plain divs with h3 + p.                                                                                                                                                                                             |
| `.timeline` / `.item` / `.year` / `.label` | kept; year 1.3em mono accent 700, label raised to 1em muted.                                                                                                                                                                                                                                                |
| `.key-thought`                             | kept: surface bg, 2px accent border, radius, centered 1.4em/700 text.                                                                                                                                                                                                                                       |
| `.pill`                                    | inline badge: tint bg + hue text + radius 999 + 700 weight. Hue selected by combining with `.tint-<hue>`; when combined with `.ok`/`.warn`/`.danger`/`.accent`, `.pill` maps the semantic class to the corresponding tint+text pair (overriding the plain text-color meaning those classes have elsewhere). |
| `.interactive-badge`                       | kept as named component (tied to the interaction model docs); restyled as a green pill.                                                                                                                                                                                                                     |
| `.block-label`                             | kept: absolute top-left section label; 1em / 700 / uppercase / letter-spacing / **muted** (was 0.8em faint — both fixed).                                                                                                                                                                                   |
| `.img-row`                                 | kept: flex row of images with surface padding + radius.                                                                                                                                                                                                                                                     |
| `.grid-demo` / `.cell` / `.cell.filled`    | kept (niche interactive visual, used by real decks).                                                                                                                                                                                                                                                        |
| `.slide.top`                               | opt-out of vertical centering (justify-content: flex-start) for content-heavy slides.                                                                                                                                                                                                                       |

### 3.3 Micro-utilities (bounded set)

- Layout: `.center` (text-align center + centered flex column for blocks), `.row` (flex, centered, 24px gap, wrap), `.stack` (column flex, 16px gap), `.spread` (row, space-between), `.grow`.
- Size: `.lg` (1.25×), `.xl` (1.6×), `.sm` (0.9× — the only sanctioned shrink; floors documented).
- Color text classes: `.blue .green .orange .purple .red .amber .teal` + semantic `.accent .ok .warn .danger` + `.muted`.
- Background: `.tint-<hue>` (7) — works on `.card`, `tr`, `td`, `.pill`, generic divs.
- Type: `.mono`.

Everything ships in one stylesheet; total surface stays small enough for exhaustive llms.txt listing.

### 3.4 Size-safety defaults

- Nothing the framework ships computes below 16px at the 16px root (block-label/nav/counter raised to 1em; caption 1.125em; timeline label 1em).
- Checker floors (§4): warn below 16px computed, error below 14px.

## 4. `zerp check` — static APCA analyzer

### CLI

- `zerp check [deck-dir]` — full report, both themes. Exit 0 (clean or warnings only), 1 (errors). `--strict` promotes warnings to errors.
- `zerp build` and `zerp serve` print a one-block summary (violation counts per theme + first few items) after each build; never change exit behavior of `build` itself.

### Pipeline

1. Build the deck HTML in memory via the existing `buildPresentationHtml` (slides get `data-zerp-src="<relative source path>"` on each `.slide` — added unconditionally; harmless in production output).
2. Parse with `linkedom`.
3. Collect CSS: framework stylesheet + deck `<style>` blocks, parsed with `css-tree`. Supported selector subset: type, class, id, descendant, child, compound, comma lists, plus the attribute/pseudo bits the framework itself uses. Rules with unsupported selectors (e.g. `:hover`) are recorded and reported once as "skipped rules", not silently dropped.
4. For every text node: resolve effective style via cascade (origin order + specificity + inline styles), inheritance for color/font properties, `var()` substitution per theme, font-size resolution through the em chain from the 16px root (rem, %, px, em; vh/vw/vmin resolved against a 1920×1080 reference viewport and flagged as approximate).
5. Effective background: walk ancestors to the nearest opaque background, alpha-compositing translucent layers onto the theme bg. Background images/gradients → the node is reported as **unverifiable** (manual check), not passed or failed.
6. Compute Lc with `apca-w3` (`calcAPCA`); required minimum size via `fontLookupAPCA(Lc)` at the node's weight (no sub-fluent/spot-text discounts — projection context). Violation if computed px < required px.
7. Absolute floors regardless of contrast: warn < 16px, error < 14px computed size.
8. Repeat for the second theme (token re-resolution only; DOM and cascade are reused).

### Report format

Grouped by slide index + source file, one line per finding:

```
slide 12 (slides/40-stats.html) [dark]
  ✗ "Source: Bloomberg" — 14px/400, Lc 43 (text #8b949e on #161b22): needs ≥27px at this contrast, or Lc ≥ 75 at this size
    suggestion: var(--zerp-muted) passes at ≥15px; or use .caption
  ⚠ "fine print…" — 15px/400: below 16px floor
  ? "Hero title" — over background image: unverifiable, check manually
```

Suggestions come from the generated `token-contrast.json` (nearest passing token for the node's background and size).

### Dependencies

`linkedom`, `css-tree`, `apca-w3` become runtime dependencies (all pure JS, small). This is the accepted cost against the previous single-dependency footprint.

### Testing

Introduce `node:test` (zero new deps) with:

- unit tests: cascade/specificity resolution, em-chain font sizes, var() theme resolution, ancestor background compositing, Lc math against known APCA reference pairs, floor logic;
- integration fixture: `examples/casino` must check **clean in both themes** — doubles as the migration proof;
- a deliberately-broken fixture deck asserting each violation class is caught (small text, faint text, hardcoded low-contrast hex, text over image → unverifiable).

## 5. llms.txt and docs

Rewrite llms.txt around first-shot correctness:

1. Deck contract (kept, condensed).
2. **Design system**: the 32 tokens with when-to-use semantics; "pick color by meaning; never hardcode hex/rgb; `--zerp-faint` is never for text".
3. **Type rules**: base sizes; "never set text below 1em; `.sm` is the only sanctioned shrink; prefer trimming content over shrinking text".
4. **Class catalog**: every component/utility with a one-line snippet.
5. **Archetype recipes**: the observed slide types (title, section divider, bullets, two-col, image row, timeline, quote, stat row, comparison, card grid, table, steps, takeaways, interactive reveal, closing) each mapped to concrete Markdown/HTML using only built-ins.
6. **Theming**: decks are theme-neutral by construction; verify both with `t`; `zerp build --theme` for the deck default.
7. **Validation loop**: "after authoring or editing slides, run `zerp check` and fix every error and warning; treat 'unverifiable' items as manual review".
8. Interaction model + interactive slide rules (kept).
9. Custom CSS policy: last resort; must use tokens; must re-run `zerp check`.

README, CLAUDE.md, AGENTS.md updated to match (architecture: token generation, checker module, new CLI surface). CHANGELOG entry for 0.2.0 noting the clean break and the default-theme change (always-dark → system).

Nice-to-have deliverable: `MIGRATION.md` — LLM-oriented mapping table (old class/var → new) so a model can port a 0.1.x deck on request.

## 6. Implementation impact map

| Area                                                   | Change                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `src/assets/default-styles.css`                        | becomes hand-authored `base-styles.css` (no raw colors)                                                               |
| `scripts/build.mjs` (+ new generator)                  | generate token CSS + `token-contrast.json` from `@evilmartians/harmony`; concat into `dist/assets/default-styles.css` |
| `src/assets/default-runtime.js`                        | theme manager (resolution order, localStorage, matchMedia), ◐ switch UI, `t` key                                      |
| `src/presentation.ts`                                  | `--theme` option → `data-zerp-theme`/`data-zerp-default-theme` on `<html>`; `data-zerp-src` on slides                 |
| `src/cli.ts`                                           | `--theme` flag parsing for build/serve; new `check` command with `--strict`                                           |
| `src/server.ts`                                        | pass theme through; print check summary per rebuild                                                                   |
| `src/check/` (new)                                     | cascade engine, background resolver, APCA evaluation, report formatting                                               |
| `src/index.ts`                                         | export `checkPresentation` alongside build/write                                                                      |
| `examples/casino`                                      | migrated to new classes/tokens; check-clean fixture                                                                   |
| `package.json`                                         | v0.2.0; deps + `@evilmartians/harmony` devDep; `test` script                                                          |
| `llms.txt`, README, CLAUDE.md, AGENTS.md, MIGRATION.md | per §5                                                                                                                |

## 7. Risks and mitigations

- **Static cascade fidelity**: mitigated by the constrained CSS surface the redesign itself creates, "skipped rules" transparency, and the unverifiable category instead of false verdicts.
- **Harmony gray is cool-tinted (275°)** vs the current warmer GitHub gray: accepted visual refresh; examples migration will validate the aesthetic.
- **Solid-600 + white badges in light theme** sit on light backgrounds — border from the hue text role added if contrast against bg proves weak in the examples pass.
- **W3 license of apca-w3**: permitted use for web content; zerp is web tooling. Acceptable.
