# Changelog

## 0.3.2

- Slide numbering is first-class: "slide N" means the 1-based deck position everywhere — runtime counter, URL hash, `zerp check`, and the new tooling below. File prefixes only order files.
- Source-tracing attributes on every composed slide div: `data-zerp-src` (source file, as before), plus new `data-zerp-src-slide` ("i/n" ordinal within the file) and `data-zerp-index` (deck position).
- New `zerp slides [deck-dir] [--json]` command and `listDeckSlides()` / `formatSlideList()` API: the position → source file / in-file ordinal / title mapping, for humans and agents.
- `zerp check` findings in multi-slide files point at the exact block: `slide 30 (slides/28-attention.html · 2/2 in file)`.
- Runtime: press `s` to toggle a source badge with the active slide's deck position and source file.
- Library: `composeSlidesHtml()` exported (annotated slides HTML without the page shell).

## 0.3.1

- Tables inside a `.row` are laid out by the row's gap — their auto-centering margins no longer swallow the row's free space and fling them apart.
- Decorative glyphs marked `aria-hidden="true"` are skipped by `zerp check` (documented; screen readers ignore them too). Recommended pattern for step markers: absolutely positioned, shown via the parent's `.revealed`, so they never skew centered content or shift layout.
- Casino specimen: the birthday slide no longer spoils its own vote (odds and live-test prompt are step reveals; the percentages are now the stat values); biased-wheel anomaly markers are paired ▲/▼ triangles, out of flow so the frequency column stays aligned, and the reveal no longer jiggles the slide.

## 0.3.0

- Utility classes now reliably override component defaults: component "soft defaults" (colors and sizes meant to be overridable) are declared via `:where()`, so `h3.accent`, `p.xl`, `.value.red`, `.year.xl` apply as written. Decks that carried previously-ignored utility classes will now render them — the intent taking effect. Inside `.card`/`.key-thought`/`.steps` cells an `h3` defaults to text color (card title), not muted.
- Declarative step reveals: `data-step="N"` / `data-until-step="N"` + optional `.swap`; the runtime keeps a per-slide step counter on ↓/↑, reserves space so stepping never reflows a centered slide, and still dispatches `slide-next`/`slide-prev` for scripted slides.
- New primitives validated across three real decks: `.sub` (detail line), `.narrow` (width-capped centered block), `.edge-<hue>` + `.edge-ok/.edge-warn/.edge-danger/.edge-accent` (border emphasis for surface components), `.concept` (icon + label definition header), `.slide.title` (title recipe with `.meta`), `.step-hint` (stepped-slide affordance line), `figure` entries inside `.img-row`, spaced `.key-thought` lines.
- `zerp check` understands `:where()` selectors (zero specificity contribution).
- Casino example rewritten on the new primitives: inline styles down ~2.7×, and five reveal scripts (Monty Hall, dice grid, expected value, frequency table, team answer) replaced with declarative markup the checker can see.
- Shot harness: Chrome is killed as soon as the PNG is stable — headless Chrome can hang on shutdown for minutes — and stale temp files from killed runs are swept.

## 0.2.0

Breaking — clean redesign of the styling layer; see MIGRATION.md.

- Design tokens generated from @evilmartians/harmony (OKLCH-designed, APCA-uniform palette); dark AND light themes in every build.
- Theme selection: `--theme dark|light|system` flag (default `system`), ◐ runtime switch + `t` key, persisted in localStorage.
- Richer defaults: styled tables, blockquotes, ordered lists, figures, code blocks; new components (.card, .cols-N, .stat/.stat-row, .compare, .flow, .steps, .pill) and bounded utilities.
- `zerp check`: built-in static APCA contrast + font-size checker covering both themes, including surface-blend detection; summary printed by build/serve; `--strict` promotes warnings.
- Bundled fonts: Montserrat + Roboto Mono (latin/cyrillic + ext) inlined as woff2 data URLs — built decks are single-file and fully offline, no Google Fonts requests.
- Removed: `.two-col`, `.big-number`, `.quote`, `.accent-<hue>` classes; hardcoded palette; always-dark default.

## 0.1.2

Initial public line: HTML/Markdown decks, lexicographic ordering, asset URL rewriting, default dark styles, navigation runtime, serve/build CLI.
