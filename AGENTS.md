# AGENTS.md

## Repository Purpose

`zerp` is the reusable presentation framework extracted from slide decks. The framework owns assembly, default styles, runtime navigation, serving, build output, and package metadata. Presentations should be able to live as a `slides/` folder plus package-level dependency wiring outside this repo. Slides can be authored in HTML, Markdown, or a mix of both.

## Working Rules

- Keep the authored deck contract minimal: `slides/**/*.html` and `slides/**/*.md` plus optional assets under `slides/`.
- Prefer zero-config behavior over introducing per-deck files.
- Preserve support for inline interactive slide scripts (works in both HTML and Markdown slides via raw HTML passthrough).
- Markdown slides use `---` on its own line as the slide separator. Each chunk is auto-wrapped in `<div class="slide">`.
- Keep the package ready for both local `file:` installs and registry publishing.
- Default styles are token-based: hand-authored rules live in `src/assets/base-styles.css` (no raw colors); theme tokens are generated from `@evilmartians/harmony` at build time.
- Any styling change must keep `pnpm test` green — the kitchen-sink and casino fixtures must pass `zerp check` in both themes.
- `dist/` is gitignored. Source edits belong under `src/` and `scripts/`; `dist/` is built on demand and included in the npm package via `prepublishOnly`.
- The default browser runtime and CSS live in `src/assets/` and are inlined by `src/presentation.ts` during `serve` and `build`.
- Markdown rendering lives in `src/markdown.ts` and uses `marked` (a production dependency).
- `examples/**/index.html` is generated and should not be edited by hand.
- Pre-commit runs a build check to catch compile errors early.

## Commands

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm exec zerp serve examples/casino
pnpm exec zerp check examples/casino
```
