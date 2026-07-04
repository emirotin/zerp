# Changelog

## 0.2.0

Breaking — clean redesign of the styling layer; see MIGRATION.md.

- Design tokens generated from @evilmartians/harmony (OKLCH-designed, APCA-uniform palette); dark AND light themes in every build.
- Theme selection: `--theme dark|light|system` flag (default `system`), ◐ runtime switch + `t` key, persisted in localStorage.
- Richer defaults: styled tables, blockquotes, ordered lists, figures, code blocks; new components (.card, .cols-N, .stat/.stat-row, .compare, .flow, .steps, .pill) and bounded utilities.
- `zerp check`: built-in static APCA contrast + font-size checker covering both themes; summary printed by build/serve; `--strict` promotes warnings.
- Removed: `.two-col`, `.big-number`, `.quote`, `.accent-<hue>` classes; hardcoded palette; always-dark default.

## 0.1.2

Initial public line: HTML/Markdown decks, lexicographic ordering, asset URL rewriting, default dark styles, navigation runtime, serve/build CLI.
