# zerp

`zerp` is a zero-config presentation framework. Slides can be authored in HTML, Markdown, or a mix of both.

Each presentation can be authored as just a `slides/` folder:

```text
my-deck/
  slides/
    00-title.html
    10-intro.md
    20-content.md
    images/
      cover.jpg
```

`zerp` finds `slides/**/*.html` and `slides/**/*.md`, sorts them by filename, rewrites relative asset URLs so slide-local assets keep working, injects default styles/runtime, and serves or builds a single-page deck. Fonts are bundled into the output, so a built deck is one self-contained file that presents fully offline.

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
pnpm add -D @emirotin/zerp
pnpm exec zerp build .
```

Commands:

```bash
pnpm exec zerp serve                      # serve the current deck on http://localhost:8000 (live-reloads on save)
pnpm exec zerp serve . 3000 --theme dark  # explicit deck dir, port, default theme
pnpm exec zerp build --theme light        # write ./index.html (light default)
pnpm exec zerp check                      # APCA contrast + font-size report (both themes; --theme dark|light|both, --json for tooling)
pnpm exec zerp slides                     # deck position → source file mapping (--json for tooling)
pnpm exec zerp verify                     # headless-browser frame/layout check (both themes, 1280x720; --json for tooling)
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
pnpm test:browser # opt-in headless-browser regression test (requires Chrome/Chromium)
```

`husky` runs `lint-staged` and a build check before each commit. `dist/` is not checked into git; it is built on demand and included in the npm package via `prepublishOnly`.

## Authoring

- Put all authored content in `slides/`.
- Use filename prefixes for ordering, for example `00-`, `10-`, `20-`.
- Store deck assets under `slides/` too. Relative links like `src="./images/foo.jpg"` are rewritten automatically.
- Each `.html` file can contain one or more `<div class="slide">` blocks.
- `.md` files are also supported. Each Markdown file is automatically wrapped in `<div class="slide">` at build time — no manual wrapper needed. Use `---` on its own line to separate multiple slides within a single `.md` file.
- Raw HTML inside Markdown files passes through unchanged, so you can embed interactive `<script>` blocks, custom `<div>` layouts, or `<style>` elements alongside Markdown content.
- At build time, every real `.slide` is placed inside a framework-owned `<div data-zerp-slide>`. The frame controls visibility; the inner `.slide` is the full-size layout surface, so custom roots may use `display: grid` or another layout safely. Do not style the reserved frame attributes.
- The framework default CSS and browser runtime are stored as separate source assets and inlined into generated HTML during `serve` and `build`.
- Colors come from design tokens (`var(--zerp-*)`) generated from the Harmony palette; decks render in dark and light themes. Do not hardcode colors.
- The page title comes from the first slide's top heading (override via the `title` build option; folder name as fallback).
- Run `zerp check` after authoring: it reports APCA contrast and font-size violations per slide, for both themes.
- Run `zerp verify` after layout or framework changes: it opens each theme in headless Chrome/Chromium and checks that exactly one full-size slide frame is active and visible without page overflow. Overflow is relative to the checked viewport (`--size WxH`, default 1280x720) — verify a deck at its actual target screen size; the summary and `--json`'s `viewport` field record exactly what was checked.
- "Slide N" means the 1-based deck position (what the on-screen counter shows) — file prefixes only order files. `zerp slides` prints the position → file mapping; pressing `s` in a running deck shows the active slide's source.

## Printing and PDF export

A built deck is print-ready as-is. Printing (browser print dialog, or a headless
print backend) produces **one page per slide** in deck order: presentation chrome
(nav, counter, progress bar, theme switch, source badge) is hidden, and steps are
rendered in their final state — every `data-step` reveal shown, every
`data-until-step` element gone.

Print with a **page size equal to the presentation viewport** and backgrounds
enabled. One slide fills exactly one page at any page size, in either theme.
Content that overflows a slide is clipped at the bottom of the page rather than
spilling onto a second page, so keep slides within the frame (the same as on
screen — `zerp check`/`zerp verify` catch overflow).

Example: render a deck to PDF at 1280×720 with Playwright:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 720})
    page.goto("file:///abs/path/to/index.html")
    page.pdf(path="deck.pdf", width="1280px", height="720px", print_background=True)
    browser.close()
```

The explicit `width`/`height` already describe the page — do **not** also pass
`landscape=True`, because Chromium swaps the two dimensions when `landscape` is
set and you get a portrait page.

## Library API

```ts
import { buildPresentationHtml, writePresentation } from "@emirotin/zerp";
```

## Example

This repository includes a migrated example deck at `examples/casino/`. Its authored source is only `examples/casino/slides/`.
