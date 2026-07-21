# Migrating a deck from zerp 0.5 to 0.6

Nothing in a deck needs to change. 0.6 is additive: built decks are now
print-ready (one page per slide, chrome hidden, steps in their final state).
Print at a page size equal to the presentation viewport (e.g. 1280×720 CSS px)
with backgrounds enabled.

The one deliberate rendering change is where an _overflowing_ slide clips. The
base `.slide` now uses `justify-content: safe center` instead of `center`, so a
slide whose content exceeds the frame clips at the bottom only, instead of at
both ends (which previously hid the top of the overflow). Slides that fit the
frame are unchanged. The remedy for overflow is the same as before — trim
content or top-align with `.slide.top`, then re-run `zerp check .` and
`zerp verify . --theme both --size 1280x720`.

# Migrating from a pre-frame zerp build

The next build contract wraps every real inner `.slide` in a generated
`<div data-zerp-slide>`. The frame owns visibility; the inner `.slide` remains
the authored full-size layout root and still receives `.active` for existing
slide scripts.

Most decks need no source changes. If a deck copied or overrode framework
visibility rules, remove rules such as `.slide { display: none }` and
`.slide.active { display: flex }`. Custom layout rules such as `.slide.grid-root
{ display: grid }` now belong on the inner root and are safe. Do not style or
author the reserved `data-zerp-slide` / `data-zerp-slide-active` state.

Run both static and browser validation after upgrading:

```bash
zerp check .
zerp verify . --theme both --size 1280x720
```

The browser check requires Chrome or Chromium. `htmlparser2` is a direct
composition dependency; `linkedom` remains because the checker, title
derivation, and `zerp slides` use its DOM APIs.

# Migrating a deck from zerp 0.2.0 to 0.3.0

0.3.0 is additive except for one deliberate behavior change: utility classes now reliably override component defaults (component soft defaults are declared via `:where()`). No markup changes are required, but review these:

1. Utility classes that were silently ignored now apply: `p.xl` / `p.lg` / `p.sm`, `h3.accent` (and other hues), `.value.red`-style colored stats, `.year.xl` in timelines. If a deck carried such classes decoratively, those elements will now render as the classes say. `zerp check` flags any size/contrast fallout — notably `.sm` on a bare paragraph (16px × 0.9 lands below the floor; keep `.sm` for inline spans).
2. Inside `.card`, `.key-thought`, and `.steps` cells, `h3` now defaults to text color (card title) instead of muted. Add `.muted` back where the old look was intended.
3. Inline styles that only worked around the old specificity (colors on stat values, border-colors on cards/key-thoughts, `font-size: 1em` demotions) can be replaced with `.value.<hue>`, `.edge-<hue>`, and `.sub`. Old inline styles keep working.
4. Reveal scripts that only show/hide/highlight things per step can be deleted in favor of `data-step` / `data-until-step` / `.swap` (see llms.txt "Declarative step reveals"). `slide-next`/`slide-prev` events still fire, so existing scripts keep working unchanged.
5. Verify with `zerp check .` and review both themes.

# Migrating a deck from zerp 0.1.x to 0.2.0

zerp 0.2.0 replaces the hardcoded GitHub-dark palette with Harmony-based design tokens, adds a light theme, and removes legacy class names. Old decks keep working on 0.1.x; migrate when you upgrade. These instructions are written so an LLM assistant can execute them.

## 1. Replace removed classes

| 0.1.x                                                           | 0.2.0                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `.two-col`                                                      | `.cols-2`                                                              |
| `.big-number`                                                   | `.stat` with `.value` + `.label` children (row wrapped in `.stat-row`) |
| `.quote` div                                                    | `<blockquote>` element                                                 |
| `.accent-green` `.accent-orange` `.accent-purple` `.accent-red` | `.green` `.orange` `.purple` `.red`                                    |

`.accent`, `.caption`, `.timeline`, `.key-thought`, `.interactive-badge`, `.block-label`, `.img-row`, `.grid-demo` are unchanged.

## 2. Replace hardcoded colors with tokens

| Hex                                         | Token                                                                |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `#0d1117`                                   | `var(--zerp-bg)`                                                     |
| `#161b22`                                   | `var(--zerp-surface)` (also: replace ad-hoc panel divs with `.card`) |
| `#30363d`                                   | `var(--zerp-border)`                                                 |
| `#e6edf3`, `#c9d1d9`                        | `var(--zerp-text)`                                                   |
| `#8b949e`                                   | `var(--zerp-muted)`                                                  |
| `#484f58`                                   | `var(--zerp-muted)` for text, `var(--zerp-faint)` for decoration     |
| `#58a6ff`                                   | `var(--zerp-accent)`                                                 |
| `#3fb950`                                   | `var(--zerp-green)`                                                  |
| `#f0883e`                                   | `var(--zerp-orange)`                                                 |
| `#bc8cff`                                   | `var(--zerp-purple)`                                                 |
| `#f85149`                                   | `var(--zerp-red)`                                                    |
| `#238636`                                   | `var(--zerp-green-solid)` with `var(--zerp-on-solid)` text           |
| dark tinted rows like `#0e2a1a` / `#2a1a1a` | `.tint-green` / `.tint-red` on the row                               |

## 3. Behavior changes

- Default theme is now `system` (was: always dark). Bake the old behavior with `zerp build --theme dark`.
- Colored text classes are now bold.
- A theme switch (◐ / `t` key) appears next to the navigation.

## 4. Verify

```bash
zerp check .
```

Fix every error/warning (mostly: text under 16px, muted text that is now too small, leftover hexes), then review both themes (`t`).
