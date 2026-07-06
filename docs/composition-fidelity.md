# Composition fidelity: why the build pipeline edits HTML with regexes

Status: analysis recorded 2026-07-07. No migration scheduled — the known bugs are pinned in `test/composition-quirks.test.mjs`.

## The question

`linkedom` and `css-tree` are production dependencies (the checker parses the composed document and models its CSS; `zerp slides` parses too). Yet the composition path — `rewriteRelativeUrls()` and the slide-annotation pass in `src/presentation.ts` — manipulates authored HTML with regexes. Why?

## Why it is this way

1. **History.** Composition is 0.1-era; the parsers arrived in 0.2.0 for the _read-only_ checker. The write path was never revisited.

2. **Byte fidelity is the design goal.** The builder is a concatenator: authored HTML ships byte-identical, plus a handful of injected attributes. A parse→serialize round-trip normalizes quoting, entities, whitespace, and attribute order, and error-corrects unusual-but-intentional markup. The deck contract ("raw HTML passthrough", hand-authored slides, diffable output) treats fidelity as a feature.

3. **One regex behavior is load-bearing by accident.** The URL-rewrite regex matches `src = "..."` _inside inline `<script>` bodies_ and rewrites script-referenced asset paths (`./images/x.png` → `slides/images/x.png`). Built decks are single files at the deck root, so script-fetched assets genuinely need this rewrite. A naive DOM-based rewriter would skip script text and silently break offline demos.

## Known bugs (all pinned in `test/composition-quirks.test.mjs`)

The probe deck is generated at runtime inside the test — its deliberately unusual markup (unquoted attributes, `>` in an attribute value) would be normalized by the formatter if it lived on disk.

- **Script strings are annotated.** A JS string containing `<div class="slide">` gets the `data-zerp-*` attributes injected _into the string_, corrupting the author's code — and it is _counted_, so `data-zerp-src-slide` totals and `data-zerp-index` drift from what the runtime counter shows (the runtime counts DOM nodes; the regex counts text).
- **`>` inside an attribute value derails annotation.** `<div class="slide" title="a > b">`: the `[^>]*` attrs capture stops at the first `>`, so the injected attributes land inside the `title` value and the tag is mangled.
- **Unquoted class attributes are invisible to the regex.** `<div class=slide>` is a slide to `querySelectorAll(".slide")` (runtime, checker, `zerp slides`) but not to the annotation regex — the two notions of "slide" can disagree.
- **Documented gap, not a bug:** `url(...)` references inside `<style>` blocks are not rewritten, while URL _attributes_ are. Slide styles are expected to use tokens, not images.

None of these currently affect the example decks or known real decks (`zerp check` clean, counts correct), but the first two sit directly under the slide-numbering features.

## Recommended fix shape (when it matters)

**Not** parse→serialize — that fixes matching correctness but destroys byte fidelity and drops the script-src rewrite.

Instead: **location-preserving parse + offset surgery.**

- Parse with a parser that exposes source offsets (`htmlparser2` `startIndex`/`endIndex`, or parse5 `sourceCodeLocation`; linkedom does not expose offsets).
- Use the real tree to _find_ slide-div open tags and URL attributes; apply edits by splicing the original string at exact offsets. Authored bytes stay untouched everywhere else; script bodies are excluded from annotation by construction.
- Make the script-internal URL rewrite an explicit, narrow pass over script text (or an authoring rule), instead of an accident of the attribute regex.
- Guardrail: a byte-diff regression harness that builds the example decks (and a large real deck) before/after the refactor; the only expected diffs are the deliberate fixes above.

Signatures (`rewriteRelativeUrls`, the annotation pass, `composeSlidesHtml`) can stay unchanged; this is contained to `src/presentation.ts` plus updated pins in `test/composition-quirks.test.mjs`.
