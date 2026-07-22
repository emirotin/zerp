# Changelog

## 0.7.0

- **`zerp verify` now drives the browser through `playwright-core`.** The hand-rolled DevTools-protocol client — Chrome over `--remote-debugging-pipe`, a bespoke CDP message pump, and device-metrics calibration — is replaced by `playwright-core`, a battle-tested browser driver. `playwright-core` bundles no browsers of its own, so the framework keeps its "bring your own browser" property: browsers stay external and optional, and the new dependency is pure JavaScript. The verify contract is unchanged — the same `VerifyReport` shape and failure strings, the same font-aware probe (it still measures after `document.fonts.ready` plus a paint settle and reports `fontsActive`), the same injected browser-error collector, the same exact-viewport measurement, temp-file handling, and 20s timeout.
- **New `zerp install-browser` command** downloads a managed Chromium for verification, for environments without a system Chrome. It hands off to `playwright-core`'s own installer (its package `bin`) and streams the download progress through, propagating the exit code.
- **`zerp verify` browser resolution order:** `CHROME_BIN` (used verbatim, so wrapper scripts keep working) → the `zerp install-browser` managed Chromium → a system Chrome/Chromium. When none is installed, verify explains how to get one.

## 0.6.1

- **`zerp verify` now measures slides with the real fonts.** The probe previously ran synchronously during page parse, before the inlined `@font-face` fonts activated, so every slide was measured with fallback metrics — font-dependent overflow (typically a few extra wrapped lines) passed verification and only showed up as clipped content when presenting or printing. The probe now waits for `document.fonts.ready` plus a paint settle before measuring, and reports `fontsActive` in the results so the wait is observable.
- `zerp verify` drives Chrome over a live DevTools-protocol session (`--remote-debugging-pipe`, still zero dependencies) instead of one-shot `--dump-dom`. The dump serialized the DOM around the load event, which is fundamentally incompatible with waiting on fonts (async results race the dump; `--timeout` never fires with `--user-data-dir`; `--virtual-time-budget` is ignored by new headless). The live session evaluates the probe after load with `awaitPromise`, sets the layout viewport exactly via device-metrics emulation (retiring the `--window-size` calibration pass), runs faster (~1.2s), and also works with Chrome-for-Testing builds, whose `--dump-dom` is broken.
- The temp `.zerp-verify-*.html` written into the deck directory during verification is now the plain built presentation (no injected probe markup); it is still removed afterwards (and `.gitignore`d against crashes).
- `zerp verify` states the checked viewport: the summary marks the default size explicitly (`1280×720 (default size)`), failing runs print how to re-verify at a deck's actual target screen (`--size WxH`), and `--json` reports carry a `viewport: { width, height, defaulted }` field. Overflow is only meaningful relative to a viewport — a larger-screen deck overflowing the default is a size mismatch, not a deck bug. `zerp check` stays size-independent (static analysis, no layout).

## 0.6.0

- Built decks are print-ready: a `@media print` block paginates one slide per page in deck order. Presentation chrome (nav, counter, progress, theme switch, source badge) is hidden, steps print in their final state (`data-step` shown, `data-until-step` gone), and backgrounds print (`print-color-adjust: exact`). In Chromium's print context each frame's inherited `100vh` resolves to one page, so pagination is size- and theme-agnostic — print at a page size equal to the presentation viewport (e.g. 1280×720 CSS px → 960×540 pt). The declarative step-hiding rules are scoped to `@media screen` so they do not fight the printed final state; `zerp check` is unaffected (it already skips at-rule contents).
- The base `.slide` aligns content with `justify-content: safe center` instead of `center`. Behavior change under overflow: an overflowing slide now spills below the frame and clips bottom-only, where before it clipped at both ends and hid the top of the overflow. Non-overflowing slides are unchanged, and engines without `safe` support fall back to plain `center`.
- `zerp check` gains `--json` (prints the report as JSON instead of the grouped text) and `--theme dark|light|both` (default both). `CheckReport` now carries a `themes` field naming the checked scope; `--strict` still composes with `--json`, and invalid themes are rejected with a clear error like `zerp verify`.
- `zerp verify` per-slide results carry `src` and `srcSlide` (the active slide's source file and in-file ordinal), included in `--json`. Human-readable per-slide failures are prefixed with the source file, e.g. `slide 3 (slides/10-intro.html): body height is 812px`, mirroring `zerp check`'s file attribution.

## 0.5.1

- Clarified the maintainer/downstream instruction boundary: `AGENTS.md` is framework-only, while the published `llms.txt` is a self-contained guide to the public deck interface.
- Downstream instructions now support local `zerp` execution through pnpm, npm, Yarn, or Bun; removed the obsolete local-path installation guidance and repository-maintainer commands.
- Package tarballs no longer include maintainer-only `AGENTS.md` or `CLAUDE.md`.

## 0.5.0

- Composition now discovers real slide elements with `htmlparser2` source offsets and wraps each one in a framework-owned `[data-zerp-slide]` frame. Authored `.slide` bytes and inline-script asset rewriting remain intact; script-looking markup is no longer annotated, and nested slide roots fail clearly.
- Slide visibility is controlled by the frame's `data-zerp-slide-active` attribute. The inner `.slide` is a full-size layout surface, so custom `display: grid`/`block`/`flex` roots cannot make inactive slides enter page flow or hide the active slide.
- Added `zerp verify [deck-dir] [--theme dark|light|both] [--size WxH] [--json]` for headless-browser frame, viewport, overflow, and browser-error checks.

## 0.4.0

- `zerp serve` live-reloads the browser on any change under `slides/` (sources and assets) — dependency-free SSE push with an mtime watcher. The page returns to the same slide via the URL hash and replays the steps of every slide you had stepped through; scripted slides re-run their `slide-next` sequences, so demos stay in sync. Built decks contain no reload client.
- The reload client also refreshes on SSE reconnect, so a restarted server — e.g. after a framework rebuild — is picked up automatically.
- `pnpm demo` is now a thin wrapper over the real `zerp serve`: it watches `src/`, rebuilds `dist/`, and respawns the server. One live-reload implementation instead of two, and the demo loop gets step preservation for free.
- The page `<title>` is derived from the first slide's highest-level heading (h1 before h2, regardless of document order); style- or script-only leading files are skipped. The `title` build option overrides; the deck folder name remains the fallback.
- Internal: the regex-based composition pipeline's quirks are pinned in tests and analyzed in `docs/composition-fidelity.md`; static string assembly moved from array joins to template literals (byte-identical output).

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
