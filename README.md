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
pnpm zerp serve .
```

Or from a registry:

```bash
pnpm add -D zerp
pnpm zerp build .
```

Commands:

```bash
pnpm zerp serve .        # serve a deck from ./slides on http://localhost:8000
pnpm zerp serve . 3000   # custom port
pnpm zerp build .        # write ./index.html
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
