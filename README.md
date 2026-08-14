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
pnpm exec zerp check                      # browser-backed contrast, font-size, glyph, frame/layout report (both themes, 1920x1080; --theme dark|light|both, --size WxH, --only category,..., --json for tooling)
pnpm exec zerp slides                     # deck position → source file mapping (--json for tooling)
```

## Browsers

`zerp check` opens each theme in a real headless browser and needs a Chromium-class one. It never bundles one — it resolves an external browser in this order:

1. **`CHROME_BIN`** — if set, it is used verbatim. Point it at any Chrome/Chromium binary; a wrapper script that execs one with extra flags works too.
2. **The playwright-managed Chromium** — run `zerp install-browser` once to download it; nothing else needs configuring afterward.
3. **A system Chrome/Chromium** — Google Chrome or Chromium found on the usual macOS app paths or on `PATH` (`google-chrome`, `chromium`, `chromium-browser`).

If none is found, `zerp check` says so and points here (and `zerp build`'s post-build check summary prints a one-line notice and continues rather than failing). On a machine with no system Chrome, install one once:

```bash
pnpm exec zerp install-browser   # download the managed Chromium
# — or —
export CHROME_BIN="/path/to/chrome"
```

The browser stays external and optional: the package itself is browser-free, so installs are light and offline-friendly.

### Reusing a running browser

By default each `zerp check` launches a browser and closes it again. A host that checks decks repeatedly — CI, a service, a watch loop — can keep one browser warm instead and point check at it with `--browser-endpoint url` (or `ZERP_BROWSER_ENDPOINT`):

```bash
# CDP: any Chrome started with --remote-debugging-port
pnpm exec zerp check --browser-endpoint http://127.0.0.1:9222
# playwright protocol: an endpoint from chromium.launchServer()
pnpm exec zerp check --browser-endpoint ws://127.0.0.1:5000/<guid>
```

Prefer `http(s)://` (CDP) when the host runs its own playwright build: it is the browser's own protocol, so the two sides need no common version. `ws(s)://` speaks the playwright protocol, which is version-locked between client and server.

A supplied browser belongs to whoever started it: check creates its own context, closes that context, and disconnects — it never closes the browser. No local browser is needed or looked for in this mode. The host must keep its event loop responsive while check runs; a host that blocks it (a synchronous child-process call, say) can stall the very browser it is lending out.

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
- Run `zerp check` after authoring, and after any layout change: it opens each theme in headless Chrome/Chromium (resolved as described under [Browsers](#browsers) — run `zerp install-browser` once if you have no system Chrome) and reports, per slide, APCA contrast, font-size floors, surface-blend, glyph/font-fallback coverage, SVG text sealed off from judging, and — the layout side, folded in from the former `zerp verify` — that exactly one full-size slide frame is active and visible without page overflow, plus any browser console errors. Overflow is relative to the checked viewport (`--size WxH`, default 1920x1080) — check a deck at its actual target screen size; the summary and `--json`'s `viewport` field record exactly what was checked. `zerp check` requires a browser; without one it names the problem (no browser found, or `CHROME_BIN` pointing somewhere invalid) and points at `zerp install-browser`.
- Every finding carries a `category` — one of `contrast`, `type-size`, `surface`, `glyph`, `svg-text`, `frame`, `overflow`, `safe-zone`, `console` — printed at the front of its report line. `--only category,category` narrows a run to a comma-separated subset; an unknown category is rejected with the full list.
- Fonts are inlined per deck: a build carries the Montserrat and Roboto Mono subsets whose `unicode-range` the deck's own text actually touches (Latin always), plus a one-glyph face for `→`. A latin deck therefore ships no Cyrillic, and a deck that types `№` ships the subset that covers it.
- `zerp check`'s glyph finding names, per element, that its text was rendered by a font the deck does not bundle, along with the fallback family — for example, an element set in a stack zerp did not subset for the characters it contains. The renderer itself is the source of truth: zerp inlines every font it ships as an `@font-face`, so Chrome's own answer to "what font actually painted this glyph" (`isCustomFont: false`) is what gets reported, not a static coverage table. Attribution is per element, not per codepoint or count — where a parent's fallback glyphs are a subset of a descendant's in the same family, the finding lands on the descendant; the slide is still flagged, only the element pointer is coarser. Emoji are exempt — every platform draws those from its own colour emoji font. `llms.txt` documents the full set of edge cases (ZWJ sequences, generated content, `<svg>` text).
- `zerp check --safe-margin px` additionally requires every top-level element of each slide to stay at least that many px inside all page edges — a print-safe inset for decks headed to PDF. Mark intentionally full-bleed elements with `data-zerp-bleed` to exempt them. Off by default; choose a margin below the slide padding so ordinary content never trips it.
- `zerp check --timeout ms` (or `ZERP_VERIFY_TIMEOUT_MS`) sets the budget for the whole browser session — launch, navigation, font activation and the probe. The default is 20000ms, which suits a developer machine; raise it on a small or loaded host, or for a deck carrying heavy imagery. A session that runs out of budget produces no report at all, so if you automate `zerp check`, give it a budget that matches the host it runs on and treat the timeout as a failed check rather than a passed one.
- The package ships a designer-facing style guide as `docs/style-system.pdf` (resolvable as `@emirotin/zerp/docs/style-system.pdf`): the layers, the type pair, the token table in both themes, the utilities, and every component, with all examples rendered by the framework's own stylesheet. It is reprinted from the current stylesheet for every release, so it describes the version you installed.
- "Slide N" means the 1-based deck position (what the on-screen counter shows) — file prefixes only order files. `zerp slides` prints the position → file mapping; pressing `s` in a running deck shows the active slide's source.

## Printing and PDF export

A built deck is print-ready as-is. Printing (browser print dialog, or a headless
print backend) produces **one page per slide** in deck order: presentation chrome
(nav, counter, progress bar, theme toggle, source badge) is hidden, and steps are
rendered in their final state — every `data-step` reveal shown, every
`data-until-step` element gone.

Print with a **page size equal to the presentation viewport** and backgrounds
enabled. One slide fills exactly one page at any page size, in either theme.
Content that overflows a slide is clipped at the bottom of the page rather than
spilling onto a second page, so keep slides within the frame (the same as on
screen — `zerp check` catches overflow).

Example: render a deck to PDF at 1920×1080 with Playwright:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    page.goto("file:///abs/path/to/index.html")
    page.pdf(path="deck.pdf", width="1920px", height="1080px", print_background=True)
    browser.close()
```

The explicit `width`/`height` already describe the page — do **not** also pass
`landscape=True`, because Chromium swaps the two dimensions when `landscape` is
set and you get a portrait page.

## Deck configuration (optional)

A deck needs no configuration: a directory with `slides/` is a deck. The one
thing it cannot express otherwise is which typefaces it is set in, so an
optional `zerp` key in the deck's own `package.json` can name them:

```json
{
  "dependencies": {
    "@fontsource/bebas-neue": "^5",
    "@fontsource/inter": "^5",
    "@fontsource/jetbrains-mono": "^5"
  },
  "zerp": {
    "fonts": {
      "display": { "family": "Bebas Neue", "weights": ["400"] },
      "body": { "family": "Inter" },
      "mono": { "family": "JetBrains Mono" }
    }
  }
}
```

- `family` is the name the font declares — the same one you would write in
  `font-family`. zerp checks it against the package and says so if they differ.
- `fontsourcePackage` is optional; it defaults to `@fontsource/<family>`
  slugified (`"JetBrains Mono"` → `@fontsource/jetbrains-mono`).
- **The deck installs the package itself.** zerp resolves it from the deck's
  `node_modules` (falling back to its own), so `pnpm add @fontsource/inter`
  before building. A package that cannot be resolved is a build error naming
  the package and the install command.
- `weights` is optional and defaults to what zerp's own styles ask for: body
  `400 600 700 900 400-italic`, mono `400 700` (fontsource file stems). Weights
  a family does not ship are simply not emitted — browsers synthesize.
- `display` sets the face for `h1`. Unset, it follows `body` — family, package
  and weights — so a deck that names only `body` gets that family everywhere.
- `mono` unset stays Roboto Mono; it never follows `body`, because the nav,
  code, tables and labels need real monospace metrics.
- The display face applies to `h1` only. Move others onto it from your own
  stylesheet — `h2 { font-family: var(--zerp-font-display) }` — or off it with
  `h1 { font-family: var(--zerp-font-body) }`; zerp's rule carries zero
  specificity so a plain element selector wins.
- Subsets are still chosen by the deck's text, so a CJK family is carried a few
  ranges at a time rather than all of it.
- Everything else is unchanged: the `→` face is always bundled, and each family
  keeps its role in the five stacks zerp draws with.

## Library API

```ts
import { buildPresentationHtml, writePresentation } from "@emirotin/zerp";
```

## Example

This repository includes a migrated example deck at `examples/casino/`. Its authored source is only `examples/casino/slides/`.
