# AGENTS.md

## Scope

This file guides agents modifying the `zerp` framework repository itself: its source, build, CLI, tests, fixtures, examples, package metadata, and documentation. It is not the downstream slide-authoring manual; the published `llms.txt` is the downstream authority.

## Agent Workflow

- Start with `git status --short` and inspect the relevant files and diffs. Preserve unrelated or concurrent work.
- Framework source edits belong under `src/` and `scripts/`; tests belong under `test/`; authored example-deck edits belong under `examples/**/slides/`.
- Never hand-edit `dist/` or `examples/**/index.html`; regenerate build output with the repository scripts or CLI when needed.
- Prefer the pinned Node/pnpm toolchain and existing package scripts, fixtures, generators, and test helpers over ad-hoc replacements.
- Keep changes narrow and update tests or fixtures when framework behavior changes. If the consumer contract changes, update `README.md` and `llms.txt` as part of the same change.
- Do not commit, publish, or release changes unless the task explicitly requests it.

## Repository Purpose

`zerp` is the reusable presentation framework extracted from slide decks. The framework owns assembly, default styles, runtime navigation, serving, build output, and package metadata. Presentations should be able to live as a `slides/` folder plus package-level dependency wiring outside this repo. Slides can be authored in HTML, Markdown, or a mix of both.

## Architecture

- `src/index.ts` exposes the framework API.
- `src/cli.ts` provides the publishable CLI.
- `src/presentation.ts` assembles slide files into one HTML document.
- Composition wraps each real inner `.slide` in a framework-owned `[data-zerp-slide]` frame; the frame controls visibility and the inner root controls layout.
- `src/markdown.ts` splits Markdown files on `---` separators, renders them via `marked`, and wraps each chunk in `<div class="slide">`.
- `src/server.ts` serves a deck and static assets from a target directory.
- `src/assets/base-styles.css` contains the hand-authored presentation styles and uses token references only.
- `scripts/generate-tokens.mjs` derives theme tokens and the token-contrast table from `@evilmartians/harmony`; the build concatenates tokens and base styles into `dist/assets/default-styles.css`.
- `src/fonts.ts` inlines Montserrat and Roboto Mono woff2 subsets from `@fontsource/*` as base64 `@font-face` declarations, so built decks are single-file and fully offline.
- `src/check/` implements `zerp check`, a static APCA contrast and font-size analyzer using `linkedom`, `css-tree`, and `apca-w3`; it runs against both themes.
- `src/verify.ts` implements `zerp verify`, a headless-browser contract check for frame visibility, viewport geometry, overflow, and browser errors.
- `src/assets/default-runtime.js` contains the browser navigation/runtime logic and theme switch.
- `scripts/build.mjs` builds TypeScript output into `dist/`, copies assets, and formats generated files.
- The runtime provides a light/dark/system theme switch persisted in `localStorage`; `zerp build|serve --theme` sets the deck default.

## Deck Contract

- A deck is discovered from a directory containing `slides/`.
- The authored deck contract is intentionally minimal: `slides/**/*.html` and `slides/**/*.md`, plus optional non-HTML assets anywhere under `slides/`.
- HTML and Markdown slide files are ordered lexicographically.
- Markdown slides use `---` on its own line as the slide separator. Each chunk is rendered via `marked` and auto-wrapped in `<div class="slide">`.
- Raw HTML passes through Markdown rendering, preserving embedded scripts and custom layout.
- Relative asset references inside slide HTML and Markdown-rendered HTML are rewritten relative to the deck root, so slide-local paths continue to work after assembly.
- Generated `index.html` output is not source-of-truth for example decks and should not be edited by hand.
- Prefer zero-config behavior over introducing per-deck files.

## Working Rules

- Preserve support for inline interactive slide scripts in both HTML and Markdown slides.
- Keep the package ready for both local `file:` installs and registry publishing.
- Default styles are token-based: hand-authored rules live in `src/assets/base-styles.css` and must not use raw colors; theme tokens are generated from `@evilmartians/harmony` at build time.
- The default browser runtime and CSS live in `src/assets/` and are inlined by `src/presentation.ts` during `serve` and `build`.
- Framework source edits belong under `src/` and `scripts/`; tests belong under `test/`; example source edits belong under `examples/**/slides/`. `dist/` is gitignored, built on demand, and included in the npm package via `prepublishOnly`.
- Any styling change must keep `pnpm test` green. The kitchen-sink and casino fixtures must pass `zerp check` in both themes.
- Run `zerp check` after every styling change; the kitchen-sink fixture (`test/fixtures/kitchen-sink`) must stay clean.
- Pre-commit uses Husky to run `lint-staged` and a build check on every commit.

## Tooling

- Node and pnpm are pinned in `package.json` via Volta metadata and `packageManager`.
- `oxlint` and `oxfmt` are the standard lint and format tools.
- `.zed/settings.json` and `.zed/format.sh` wire Zed to `oxfmt`.

## Framework and Fixture Verification

Use the smallest relevant check while iterating, then run the complete checks required by the change before handoff. Never judge visual changes from memory or full-slide thumbnails — measure, then look:

- `pnpm check` runs the TypeScript type check.
- `pnpm build` creates `dist/`, including the framework-local CLI. Use `node dist/cli.js ...` for CLI checks in this repository.
- `pnpm test` builds the package and runs the unit/CLI tests.
- `pnpm lint` and `pnpm format:check` validate source and generated-file conventions.
- `pnpm test:browser` runs browser regression tests and requires Chrome or Chromium.
- `node dist/cli.js check <deck>` checks APCA text contrast, font-size floors, and surface-blend detection for both themes.
- `node dist/cli.js verify <deck> --theme both --size 1280x720` uses headless Chrome to check that each slide has exactly one active, visible, full-size frame, and checks viewport geometry, overflow, and browser errors. Chrome or Chromium is required.
- `pnpm shot <deck> --slide N --theme dark|light|both` captures headless-Chrome screenshots into `shots/`; read the PNGs. Use `--focus ".selector"` to outline an element in magenta, `--scale 2` for close inspection of small elements, and `--setup "js"` to drive interactive state such as stepping reveals or opening the theme popover.

## Commands

```bash
pnpm install
pnpm check
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm test:browser
node dist/cli.js check test/fixtures/kitchen-sink
node dist/cli.js check examples/casino
node dist/cli.js verify examples/casino --theme both --size 1280x720
node dist/cli.js serve examples/casino
```
