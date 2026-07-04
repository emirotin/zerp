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
