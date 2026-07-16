# Composition fidelity

Status: the location-preserving composition pipeline and slide-frame isolation
are implemented. The regression cases live in
`test/composition-quirks.test.mjs`; the browser contract is exercised by
`zerp verify` when Chrome or Chromium is available.

## Why two HTML dependencies?

`htmlparser2` and `linkedom` have deliberately different jobs:

- `htmlparser2` is used by the write-side composition path. It exposes source
  offsets, so zerp can find real slide elements and splice only the generated
  wrapper and tracing attributes into the original bytes.
- `linkedom` remains used by the read-only DOM consumers: `zerp check`,
  `zerp slides`, and title derivation. Those consumers need selectors,
  `textContent`, parent relationships, and DOM matching, not source offsets.

Replacing `linkedom` is a separate refactor and is not a consequence of adding
`htmlparser2`.

## Why composition edits source with offsets

The builder is a concatenator: authored HTML should remain byte-identical
except for the small set of generated changes. A parse→serialize round-trip
would normalize quoting, entities, whitespace, and attribute order, and could
error-correct unusual-but-intentional markup.

One URL rewrite is intentionally still a narrow text pass. Relative `src`,
`href`, and `poster` attributes are rewritten for the single-file build, and
the existing `src = "..."` behavior inside inline scripts is preserved because
interactive slides use it to fetch local assets. Style-block `url(...)`
references remain a documented gap; slide styles should use tokens and asset
URLs in HTML attributes where possible.

## The composition contract

Each real `.slide` element is wrapped in a framework-owned frame:

```html
<div data-zerp-slide data-zerp-slide-active>
  <div
    class="slide"
    data-zerp-src="slides/10-intro.html"
    data-zerp-src-slide="1/2"
    data-zerp-index="3"
  >
    ...authored content...
  </div>
</div>
```

The frame owns visibility. The inner `.slide` owns the authored layout and is
given the full frame width and height by the base styles. The runtime toggles
`data-zerp-slide-active` on frames and retains the `.active` class on the inner
slide for compatibility with slide scripts and existing selectors. The
framework does not use `.slide.active` to control display anymore, so a deck
can safely choose `display: grid`, `display: block`, or another layout on its
slide root.

The `data-zerp-*` frame attributes are reserved framework state. A deck should
style the inner `.slide` and its descendants, not the frame's display rules.
Nested `.slide` roots are rejected during composition because they make the
frame-to-slide mapping ambiguous.

## What the tests protect

- HTML-looking text inside scripts is not mistaken for a slide.
- `>` inside a quoted attribute and unquoted class attributes remain valid and
  retain their authored spelling.
- Script asset URL rewriting continues to work.
- Every real slide has exactly one frame, stable source metadata, and a global
  deck index.
- A custom inner root using `display: grid` does not make inactive slides enter
  layout or hide the active slide.
