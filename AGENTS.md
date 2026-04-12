# AGENTS.md

## Repository Purpose

`zerp` is the reusable presentation framework extracted from slide decks. The framework owns assembly, default styles, runtime navigation, serving, and build output. Presentations should be able to live as a `slides/` folder plus package-level dependency wiring outside this repo.

## Working Rules

- Keep the authored deck contract minimal: `slides/**/*.html` plus optional assets under `slides/`.
- Prefer zero-config behavior over introducing per-deck files.
- Preserve support for inline interactive slide scripts.
- Keep the package ready for both local `file:` installs and registry publishing.
- Default styles should stay useful out of the box, but generic enough for reuse.

## Commands

```bash
pnpm install
pnpm build
pnpm check
node dist/cli.js serve examples/casino
```
