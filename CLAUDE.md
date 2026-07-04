# CLAUDE.md

This repository contains the `zerp` presentation framework.

## Architecture

- `src/index.ts` exposes the framework API.
- `src/cli.ts` provides the publishable CLI.
- `src/presentation.ts` assembles slide files into one HTML document.
- `src/markdown.ts` splits Markdown files on `---` separators, renders them via `marked`, and wraps each chunk in `<div class="slide">`.
- `src/server.ts` serves a deck and static assets from a target directory.
- `src/assets/base-styles.css` contains the hand-authored presentation styles (token references only).
- `scripts/generate-tokens.mjs` derives theme tokens and the token-contrast table from `@evilmartians/harmony`; the build concatenates tokens + base styles into `dist/assets/default-styles.css`.
- `src/check/` implements `zerp check`: a static APCA contrast/font-size analyzer (linkedom + css-tree + apca-w3) that runs against both themes.
- `src/assets/default-runtime.js` contains the browser navigation/runtime logic and theme switch.
- `scripts/build.mjs` builds TypeScript output into `dist/`, copies assets, and formats generated files.
- `dist/` is gitignored. It is built on demand and included in the npm package via `prepublishOnly`.
- The runtime provides a light/dark/system theme switch persisted in localStorage; `zerp build|serve --theme` sets the deck default.

## Deck Contract

- A deck is discovered from a directory containing `slides/`.
- `slides/**/*.html` and `slides/**/*.md` files are ordered lexicographically.
- Markdown files are split on `---` lines into individual slides, each auto-wrapped in `<div class="slide">`. Raw HTML passes through, enabling embedded scripts and custom layout.
- Non-HTML assets can live anywhere under `slides/`.
- Relative asset references inside slide HTML (and Markdown-rendered HTML) are rewritten relative to the deck root, so slide-local paths continue to work after assembly.
- Generated `index.html` output is not source-of-truth for example decks.

## Tooling

- Node and pnpm are pinned in `package.json` via Volta metadata and `packageManager`.
- `oxlint` and `oxfmt` are the standard lint/format tools.
- `husky` runs `lint-staged` and a build check on every commit.
- `.zed/settings.json` and `.zed/format.sh` wire Zed to `oxfmt`.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
pnpm format:check
```
