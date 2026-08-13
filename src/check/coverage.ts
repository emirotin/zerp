import { readFile } from "node:fs/promises";

import { parseHTML } from "linkedom";

import { type FontFaceInfo, selectedFaces } from "../fonts.js";
import { buildPresentationHtml, deckCodepoints } from "../presentation.js";
import { woff2Codepoints } from "../woff2.js";
import { StyleResolver } from "./cascade.js";
import { parseStylesheets, type CssModel, type StyleSheetInput } from "./css-model.js";
import { parseFontStack, StackResolver } from "./font-stack.js";
import type { DomElement } from "./types.js";

/**
 * Slide characters the deck cannot draw *through the stack they render in*.
 *
 * The check this replaces unioned every bundled face and asked whether any of
 * them carried the character. That was honest while every element resolved
 * through one family; with a display role and with author overrides it is not,
 * and the failure it misses is the silent one — a character drawn by whatever
 * the viewing machine falls back to, differently on every OS, and re-resolved
 * again when the deck is exported.
 *
 * Selection is untouched: the build still inlines subsets chosen by the FULL
 * document. Only judging is per-stack, and only slide content is judged.
 */

// Pictographs are exempt. No text font carries them: every platform draws them
// from its own colour emoji font by design, which is also what an export
// pipeline does, so "uncovered" would be true, universal, and useless. Flag
// sequences are regional indicators rather than pictographs, hence both.
const EXEMPT = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u;
const NON_RENDERING = /[\s\p{Cc}\p{Cf}]/u;
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT", "TITLE"]);

const cmapCache = new Map<string, Promise<Set<number>>>();

function cmapOf(file: string): Promise<Set<number>> {
  const cached = cmapCache.get(file);
  if (cached) {
    return cached;
  }
  const codepoints = readFile(file).then(woff2Codepoints);
  cmapCache.set(file, codepoints);
  return codepoints;
}

export interface UncoveredText {
  /** Zero-based index into the slide list. */
  slideIndex: number;
  /** The stack the characters resolved through, as authored. */
  stack: string[];
  /** Label of the element the text sits in, e.g. `<h1>`. */
  element: string;
  /** Uncovered codepoints, ascending. */
  codepoints: number[];
}

/** The slice of a parsed document {@link uncoveredInSlides} needs to walk. */
export interface DomQueryable {
  querySelectorAll(selector: string): { length: number; [i: number]: unknown };
}

export interface UncoveredInput {
  rootDir: string;
  /** Reuse the caller's parse when there is one; otherwise it is built here. */
  document?: DomQueryable;
  model?: CssModel;
}

// Matches checker.ts's own elementLabel: a long class list inlines into the
// finding's message body, where the rest of the report already clamps it.
function elementLabel(el: DomElement): string {
  const cls = el.getAttribute("class");
  const label = `<${el.tagName.toLowerCase()}${cls ? ` class="${cls}"` : ""}>`;
  return label.length > 40 ? `${label.slice(0, 37)}…>` : label;
}

async function loadStackResolver(faces: readonly FontFaceInfo[]): Promise<StackResolver> {
  const cmaps = new Map<string, ReadonlySet<number>>();
  for (const face of faces) {
    cmaps.set(face.file, await cmapOf(face.file));
  }
  return new StackResolver(faces, cmaps);
}

// Quoted literals and attr() references are the two ways a content: value
// contributes actual text; counter(), url(), open-quote and the like are not
// text this scan can resolve at all, so a rule using them is left unjudged.
const CONTENT_TOKEN = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|attr\(\s*([\w-]+)\s*\)/g;

/**
 * The text a `content:` declaration renders, resolved against `el` for any
 * `attr()` reference it makes. `.compare[data-vs]::after { content:
 * attr(data-vs) }` is a shipped framework feature whose label is arbitrary
 * author text — the same characters the old union-model check judged (it read
 * them from `DeckCodepoints.slideContent`, which `codepoints.ts` populates
 * from exactly these attribute values), so this reads them the same way
 * rather than losing them going per-stack.
 *
 * Mixed literals like `content: "(" attr(x) ")"` are handled too, since
 * csstree.generate emits tokens back-to-back with nothing between them: the
 * whole declaration must parse as a run of quoted strings and attr() calls,
 * or this returns null and the rule is left unjudged, same as an unsupported
 * function always was.
 */
function resolveContentText(literal: string, el: DomElement): string | null {
  let result = "";
  let consumed = 0;
  CONTENT_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONTENT_TOKEN.exec(literal)) !== null) {
    if (match.index !== consumed) {
      return null;
    }
    if (match[1] !== undefined) {
      result += match[1].replace(/\\(.)/g, "$1");
    } else if (match[2] !== undefined) {
      result += match[2].replace(/\\(.)/g, "$1");
    } else if (match[3] !== undefined) {
      result += el.getAttribute(match[3]) ?? "";
    }
    consumed = CONTENT_TOKEN.lastIndex;
  }
  return consumed === literal.length && consumed > 0 ? result : null;
}

/** Uncovered codepoints in `text`, ascending; empty when the stack draws all of it. */
function judgeText(text: string, stack: readonly string[], stacks: StackResolver): number[] {
  const missing = new Set<number>();
  for (const character of text) {
    if (NON_RENDERING.test(character) || EXEMPT.test(character)) {
      continue;
    }
    const codepoint = character.codePointAt(0);
    if (codepoint !== undefined && !stacks.resolves(stack, codepoint)) {
      missing.add(codepoint);
    }
  }
  return [...missing].sort((left, right) => left - right);
}

/**
 * Slide characters the deck cannot draw through the stack the element they
 * sit in actually resolves — see the module doc for why this replaces the
 * union model. `document`/`model` let a caller that already parsed the built
 * HTML (checker.ts) pass its pieces through rather than parsing twice.
 */
export async function uncoveredInSlides(input: UncoveredInput): Promise<UncoveredText[]> {
  let document = input.document;
  let model = input.model;
  if (!document || !model) {
    const html = await buildPresentationHtml({ rootDir: input.rootDir });
    document = parseHTML(html).document as unknown as DomQueryable;
    const styleNodes = document.querySelectorAll("style");
    const sheets: StyleSheetInput[] = [];
    for (let i = 0; i < styleNodes.length; i++) {
      const node = styleNodes[i] as DomElement;
      sheets.push({
        css: node.textContent ?? "",
        origin: node.getAttribute("data-zerp") ? "framework" : "deck",
      });
    }
    model = parseStylesheets(sheets);
  }

  const codepoints = await deckCodepoints(input.rootDir);
  const faces = await selectedFaces(input.rootDir, codepoints.full);
  const stacks = await loadStackResolver(faces);
  // font-family does not vary by theme, so one resolver answers for both.
  const resolver = new StyleResolver(model, model.themeVars.dark);

  const slideNodes = document.querySelectorAll(".slide");

  // A single element can hold several text nodes (e.g. `<p>Inline <code>…</code>
  // is monospace.</p>` walks the <p> twice, once per side of the <code>) and a
  // rule's ::before/::after can in principle match more than one node across
  // slides. Accumulate per (element, pseudo-suffix) and emit one entry each,
  // rather than one per text node — Task 9 renders one warning per entry, and
  // a reader should not see the same element flagged twice.
  interface EntryAcc {
    slideIndex: number;
    stack: string[];
    element: string;
    codepoints: Set<number>;
  }
  const accByElement = new Map<DomElement, Map<string, EntryAcc>>();

  const record = (
    el: DomElement,
    pseudoSuffix: string,
    slideIndex: number,
    element: string,
    stack: string[],
    codepoints: number[],
  ): void => {
    if (codepoints.length === 0) {
      return;
    }
    let byPseudo = accByElement.get(el);
    if (!byPseudo) {
      byPseudo = new Map();
      accByElement.set(el, byPseudo);
    }
    const existing = byPseudo.get(pseudoSuffix);
    if (existing) {
      for (const codepoint of codepoints) {
        existing.codepoints.add(codepoint);
      }
    } else {
      byPseudo.set(pseudoSuffix, { slideIndex, stack, element, codepoints: new Set(codepoints) });
    }
  };

  const judge = (el: DomElement, text: string, slideIndex: number): void => {
    const stack = parseFontStack(resolver.resolveVars(resolver.computedFor(el).fontFamily));
    const codepoints = judgeText(text, stack, stacks);
    record(el, "", slideIndex, elementLabel(el), stack, codepoints);
  };

  const walk = (el: DomElement, slideIndex: number): void => {
    if (SKIP_TAGS.has(el.tagName) || el.getAttribute("aria-hidden") === "true") {
      return;
    }
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (!child) {
        continue;
      }
      if (child.nodeType === 3) {
        const text = child.textContent ?? "";
        if (/\S/.test(text)) {
          judge(el, text, slideIndex);
        }
      } else if (child.nodeType === 1) {
        walk(child as DomElement, slideIndex);
      }
    }
  };

  for (let i = 0; i < slideNodes.length; i++) {
    walk(slideNodes[i] as DomElement, i);
  }

  // `content:` literals have no DOM node, so they are judged from the rules
  // that declare them: match the originating selector, then resolve the stack
  // the rule itself sets (zerp's markers name --zerp-font-marker precisely so
  // `→` resolves) or the element's own if it sets none.
  for (const rule of model.rules) {
    if (rule.pseudoElement === null) {
      continue;
    }
    const literal = rule.declarations.get("content");
    if (!literal) {
      continue;
    }
    const own = rule.declarations.get("font-family");
    for (let i = 0; i < slideNodes.length; i++) {
      const slide = slideNodes[i] as DomElement;
      let matched: DomElement | null = null;
      const find = (el: DomElement): void => {
        if (matched) {
          return;
        }
        try {
          if (el.matches(rule.selector)) {
            matched = el;
            return;
          }
        } catch {
          return;
        }
        for (let j = 0; j < el.childNodes.length; j++) {
          const child = el.childNodes[j];
          if (child && child.nodeType === 1) {
            find(child as DomElement);
          }
        }
      };
      find(slide);
      if (!matched) {
        continue;
      }
      // Resolved per matched element, not once per rule: attr() reads the
      // matching element's own attribute, which can differ slide to slide.
      const text = resolveContentText(literal, matched);
      if (text === null) {
        continue;
      }
      const raw = own ?? resolver.computedFor(matched).fontFamily;
      const stack = parseFontStack(resolver.resolveVars(raw));
      const codepoints = judgeText(text, stack, stacks);
      record(
        matched,
        rule.pseudoElement,
        i,
        `${elementLabel(matched)}${rule.pseudoElement}`,
        stack,
        codepoints,
      );
    }
  }

  const found: UncoveredText[] = [];
  for (const byPseudo of accByElement.values()) {
    for (const entry of byPseudo.values()) {
      found.push({
        slideIndex: entry.slideIndex,
        stack: entry.stack,
        element: entry.element,
        codepoints: [...entry.codepoints].sort((left, right) => left - right),
      });
    }
  }
  return found;
}
