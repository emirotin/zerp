# zerp

`zerp` is a zero-config HTML presentation framework.

Each presentation can be authored as just a `slides/` folder:

```text
my-deck/
  slides/
    00-title.html
    10-intro.html
    images/
      cover.jpg
```

`zerp` finds `slides/**/*.html`, sorts them by filename, rewrites relative asset URLs so slide-local assets keep working, injects default styles/runtime, and serves or builds a single-page deck.

## Maintainer Policy

I use `zerp` myself and find it useful, which is why I am making it public as free open-source software.

That does not mean I am available for general collaboration. Issues and pull requests are intentionally disabled. I do not have the capacity to debug other people's problems for free, and I do not want to spend time triaging low-signal or AI-generated contributions.

If you want to use the project as-is, please do. If you need a fix, a feature, or help integrating it into your workflow, contact me directly for paid support.

## Usage

Install from a local checkout:

```bash
pnpm add -D file:../zerp
pnpm exec zerp serve .
```

Or from a registry:

```bash
pnpm add -D zerp
pnpm exec zerp build .
```

Commands:

```bash
pnpm exec zerp serve          # serve the current deck on http://localhost:8000
pnpm exec zerp serve 3000     # current deck, custom port
pnpm exec zerp serve . 3000   # explicit deck dir
pnpm exec zerp build          # write ./index.html for the current deck
```

## Tooling

This repo pins Node and pnpm via Volta metadata in `package.json`:

```bash
volta pin node@24.14.1 pnpm@10.33.0
```

Quality commands:

```bash
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
```

`husky` runs `lint-staged`, rebuilds `dist/`, and stages the rebuilt package output before each commit.

## Authoring

- Put all authored content in `slides/`.
- Use filename prefixes for ordering, for example `00-`, `10-`, `20-`.
- Store deck assets under `slides/` too. Relative links like `src="./images/foo.jpg"` are rewritten automatically.
- Each `.html` file can contain one or more `<div class="slide">` blocks.
- The framework default CSS and browser runtime are stored as separate source assets and inlined into generated HTML during `serve` and `build`.

## Library API

```ts
import { buildPresentationHtml, writePresentation } from "zerp";
```

## Example

This repository includes a migrated example deck at `examples/casino/`. Its authored source is only `examples/casino/slides/`.
