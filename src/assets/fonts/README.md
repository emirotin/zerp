# Zerp Symbols

`zerp-symbols.woff2` is an 812-byte font face carrying exactly one glyph:
U+2192 RIGHTWARDS ARROW (→).

## Why it exists

zerp draws two markers with a right arrow — the `ul` bullet
(`.slide ul li::before`) and the `.flow` connector (`.flow > * + *::before`) —
and decks are free to type one in body text. Neither bundled family covers it.
The Montserrat and Roboto Mono subsets zerp inlines are the fontsource
`latin`, `latin-ext`, `cyrillic` and `cyrillic-ext` slices; Montserrat's
carries ↑ (U+2191), ↓ (U+2193) and • (U+2022) but no →, and Roboto Mono's
carries no arrows at all. Every → was therefore drawn by whatever the viewing
machine happened to fall back to: a different shape, weight and sidebearing on
every OS, and worse once a deck leaves the browser, where an exported text run
carries one font face and a character that face does not cover is re-resolved
by the reader's machine.

This face closes that gap without adding a real font to the payload. Its
`@font-face` declares `unicode-range: U+2192`, so the browser only ever
downloads and consults it for the arrow — listing it in a font stack is inert
for every other character.

## Source

| | |
| --- | --- |
| Font | Noto Sans Symbols |
| Version | 2.003 (`Version 2.003`, name ID 5) |
| Upstream | <https://github.com/google/fonts/tree/main/ofl/notosanssymbols> |
| Source file | <https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssymbols/NotoSansSymbols%5Bwght%5D.ttf> |
| License | SIL Open Font License 1.1 — full text in `OFL.txt` |

Noto Sans Symbols is the first family in the Noto symbol set that actually
contains U+2192: Noto Sans Symbols **2** (2.008) does not map any of
U+2190–U+219F, which is worth knowing before reaching for the other one.

## Regenerating

The upstream file is a variable font with a `wght` axis (100–900, default
400), so it is instanced before subsetting to keep the result a plain static
face:

```sh
curl -O 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssymbols/NotoSansSymbols%5Bwght%5D.ttf'
fonttools varLib.instancer 'NotoSansSymbols[wght].ttf' wght=400 -o nss-400.ttf
pyftsubset nss-400.ttf --unicodes=U+2192 --flavor=woff2 --output-file=zerp-symbols.woff2
python rename.py
```

`OFL.txt` is copied verbatim from the same upstream directory.

### rename.py

The OFL treats a subset as a Modified Version, so the face is renamed rather
than shipped under the upstream family name. Noto Sans Symbols does not
declare a Reserved Font Name, but renaming is the correct thing to do
regardless and it keeps the CSS family unambiguous. The copyright notice
(name ID 0) is preserved, and the license notice and URL (name IDs 13 and 14)
are embedded so the artifact carries its own terms:

```python
from fontTools.ttLib import TTFont

font = TTFont("zerp-symbols.woff2")
name = font["name"]
name.names = [r for r in name.names if r.nameID < 256]
for name_id, value in {
    1: "Zerp Symbols",
    3: "2.003;Zerp;ZerpSymbols-Regular",
    4: "Zerp Symbols Regular",
    6: "ZerpSymbols-Regular",
    10: "Single-glyph (U+2192) subset of Noto Sans Symbols 2.003, renamed per OFL.",
    13: "This Font Software is licensed under the SIL Open Font License, Version 1.1.",
    14: "https://scripts.sil.org/OFL",
}.items():
    name.setName(value, name_id, 3, 1, 0x409)
font.flavor = "woff2"
font.save("zerp-symbols.woff2")
```

The filter drops the leftover `wght` axis name record (ID 260) that instancing
leaves behind after `fvar` is gone.

## Wiring

`src/fonts.ts` inlines this file as a base64 data URL alongside the fontsource
faces, so a built deck stays a single offline file. `src/assets/base-styles.css`
puts `"Zerp Symbols"` first on the two marker pseudo-elements — that is what
makes an exporter emit the marker's text run with this face — and appends it to
the general Montserrat and Roboto Mono stacks so an author-typed → is covered
too.

`.nav button` is the one stack left out on purpose. Those buttons are ← and →,
and no bundled subset covers either, so both currently come from the same
system fallback and match. Resolving only → would pair a long thin arrow with a
short heavy one. Nav chrome is not exported and does not print, so it has
nothing to gain from a deterministic glyph. Widening the subset to U+2190 would
be the other way to settle it.
