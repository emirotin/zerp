# CLAUDE.md

This repository contains the `zerp` presentation framework.

## Architecture

- `src/index.ts` exposes the framework API.
- `src/cli.ts` provides the publishable CLI.
- `src/presentation.ts` assembles slide files into one HTML document.
- `src/server.ts` serves a deck and static assets from a target directory.
- `src/default-template.ts` holds the default CSS and browser runtime.

## Deck Contract

- A deck is discovered from a directory containing `slides/`.
- `slides/**/*.html` files are ordered lexicographically.
- Non-HTML assets can live anywhere under `slides/`.
- Relative asset references inside slide HTML are rewritten relative to the slide file.

## Development

```bash
pnpm install
pnpm build
pnpm check
```
