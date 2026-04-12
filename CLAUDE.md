# CLAUDE.md

This repository contains the `zerp` presentation framework.

## Architecture

- `src/index.ts` exposes the framework API.
- `src/cli.ts` provides the publishable CLI.
- `src/presentation.ts` assembles slide files into one HTML document.
- `src/server.ts` serves a deck and static assets from a target directory.
- `src/assets/default-styles.css` contains the default presentation styles.
- `src/assets/default-runtime.js` contains the browser navigation/runtime logic.
- `scripts/build.mjs` builds TypeScript output into `dist/`, copies assets, and formats generated files.
- `dist/` is tracked and represents the publishable package contents.

## Deck Contract

- A deck is discovered from a directory containing `slides/`.
- `slides/**/*.html` files are ordered lexicographically.
- Non-HTML assets can live anywhere under `slides/`.
- Relative asset references inside slide HTML are rewritten relative to the deck root, so slide-local paths continue to work after assembly.
- Generated `index.html` output is not source-of-truth for example decks.

## Tooling

- Node and pnpm are pinned in `package.json` via Volta metadata and `packageManager`.
- `oxlint` and `oxfmt` are the standard lint/format tools.
- `husky` runs `lint-staged`, rebuilds `dist/`, and stages regenerated output on every commit.
- `.zed/settings.json` and `.zed/format.sh` wire Zed to `oxfmt`.

## Development

```bash
pnpm install
pnpm build
pnpm check
pnpm lint
pnpm format:check
```
