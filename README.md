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

## Authoring

- Put all authored content in `slides/`.
- Use filename prefixes for ordering, for example `00-`, `10-`, `20-`.
- Store deck assets under `slides/` too. Relative links like `src="./images/foo.jpg"` are rewritten automatically.
- Each `.html` file can contain one or more `<div class="slide">` blocks.

## Library API

```ts
import { buildPresentationHtml, writePresentation } from "zerp";
```

## Example

This repository includes a migrated example deck at `examples/casino/`. Its authored source is only `examples/casino/slides/`.
