import * as csstree from "css-tree";
import { parseHTML } from "linkedom";

/**
 * The characters the assembled document renders, framework chrome included.
 *
 * This decides which font subsets a built deck has to carry. It once also
 * carried a slide-only scope for the glyph-coverage check to warn from, but
 * that check now judges each element through the fonts the browser actually
 * rendered it with (see `check/judge.ts`'s `judgeGlyphs`) rather than against
 * a deck-wide codepoint set, so only this one scope is still read.
 */
export interface DeckCodepoints {
  readonly full: ReadonlySet<number>;
}

export interface DeckScanInput {
  /** Assembled slide markup — deck content only, no framework chrome. */
  slidesHtml: string;
  /** Framework chrome markup: nav, counter, progress, theme switch. */
  chromeHtml?: string;
  /**
   * Stylesheets that apply to the deck (zerp's own base styles). `<style>`
   * blocks inside `slidesHtml` are picked up on their own.
   */
  css?: readonly string[];
}

// Whitespace, control and format characters have no glyph to miss: a font
// either advances for them or the shaper handles them. Scanning them would
// pull U+00A0, U+200B and friends into every deck's codepoint set for nothing.
const NON_RENDERING = /[\s\p{Cc}\p{Cf}]/u;

// `counter()` renders digits that appear nowhere in the DOM and in no string
// literal, so no scan can find them. Every deck gets them.
const DIGITS = "0123456789";

// <style> holds CSS, not copy: its `content:` literals are collected from the
// parsed stylesheet instead, and the rest of it is selectors and base64.
const STYLE_TAG = "STYLE";
// <script> holds source. A string literal in it is text the deck may render,
// which is why it counts towards `full` — see scanDeckCodepoints.
const SCRIPT_TAG = "SCRIPT";

interface ScanNode {
  nodeType: number;
  textContent: string | null;
}

interface ScanElement extends ScanNode {
  tagName: string;
  childNodes: { length: number; [index: number]: ScanNode | undefined };
  getAttribute(name: string): string | null;
}

interface HtmlScan {
  /** Rendered text: everything outside <style> and <script>. */
  text: string;
  /** Source text of <script> elements. */
  scriptText: string;
  /** Every element, so `content: attr(X)` values can be read off them. */
  elements: ScanElement[];
  /** Inline <style> text, parsed as CSS rather than as copy. */
  styleCss: string[];
}

interface CssContent {
  /** Concatenated `content:` string literals, escapes already decoded. */
  literals: string;
  /** Attribute names named by `content: attr(X)`. */
  attrNames: Set<string>;
}

function scanHtml(html: string): HtmlScan {
  const scan: HtmlScan = { text: "", scriptText: "", elements: [], styleCss: [] };
  if (!html.trim()) {
    return scan;
  }
  // linkedom leaves `document.body` empty for a fragment parse but hangs the
  // parsed nodes off documentElement, so the walk starts there.
  const { document } = parseHTML(`<body>${html}</body>`) as unknown as {
    document: { documentElement: ScanElement | null };
  };
  const root = document.documentElement;
  if (!root) {
    return scan;
  }

  const visit = (el: ScanElement): void => {
    const tag = el.tagName.toUpperCase();
    if (tag === STYLE_TAG) {
      scan.styleCss.push(el.textContent ?? "");
      return;
    }
    if (tag === SCRIPT_TAG) {
      scan.scriptText += el.textContent ?? "";
      return;
    }
    scan.elements.push(el);
    for (let i = 0; i < el.childNodes.length; i++) {
      const child = el.childNodes[i];
      if (!child) {
        continue;
      }
      if (child.nodeType === 3) {
        scan.text += child.textContent ?? "";
      } else if (child.nodeType === 1) {
        visit(child as ScanElement);
      }
    }
  };

  visit(root);
  return scan;
}

// A `String` node carries its decoded text where a node would otherwise sit,
// which the hand-written css-tree declarations cannot express; check for it
// rather than casting.
function decodedText(node: csstree.CssNode): string | null {
  const value: unknown = node.value;
  return typeof value === "string" ? value : null;
}

function firstIdentifier(node: csstree.CssNode): string | null {
  let name: string | null = null;
  node.children?.forEach((child) => {
    if (name === null && child.type === "Identifier" && child.name) {
      name = child.name;
    }
  });
  return name;
}

function collectCssContent(sheets: readonly string[]): CssContent {
  const result: CssContent = { literals: "", attrNames: new Set() };
  for (const sheet of sheets) {
    if (!sheet.trim()) {
      continue;
    }
    csstree.walk(csstree.parse(sheet), {
      visit: "Declaration",
      enter(declaration) {
        const value = declaration.value;
        if (declaration.property?.toLowerCase() !== "content" || !value) {
          return;
        }
        csstree.walk(value, (node) => {
          if (node.type === "String") {
            // css-tree decodes quotes and escapes, so `content: "\2192 "`
            // arrives here as the arrow itself.
            result.literals += decodedText(node) ?? "";
          } else if (node.type === "Function" && node.name?.toLowerCase() === "attr") {
            const attrName = firstIdentifier(node);
            if (attrName) {
              result.attrNames.add(attrName);
            }
          }
        });
      },
    });
  }
  return result;
}

function addCodepoints(text: string, target: Set<number>): void {
  for (const character of text) {
    if (NON_RENDERING.test(character)) {
      continue;
    }
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined) {
      continue;
    }
    target.add(codepoint);
  }
}

/**
 * Compute the codepoints a deck can render.
 *
 * Four sources feed it, because slide text alone misses most of them:
 *
 * - the assembled deck's own text, markdown already rendered, plus framework
 *   chrome's;
 * - `content:` string literals from the stylesheets that apply to it — the
 *   `"→ "` ul marker and the `"vs"` of `.compare` are drawn by CSS and appear
 *   in no slide file;
 * - the values of attributes those rules name with `attr()`, which is how
 *   `.compare[data-vs]` prints its own label;
 * - the digits, which `counter()` generates at render time.
 *
 * Script source counts too, deliberately: a string literal in a slide script
 * is text the deck may well render, and over-selecting a subset costs bytes
 * while under-selecting costs the reader a fallback glyph.
 */
export function scanDeckCodepoints(input: DeckScanInput): DeckCodepoints {
  const full = new Set<number>();

  const slides = scanHtml(input.slidesHtml);
  const chrome = scanHtml(input.chromeHtml ?? "");

  addCodepoints(DIGITS, full);
  addCodepoints(slides.text, full);
  addCodepoints(slides.scriptText, full);
  addCodepoints(chrome.text, full);
  addCodepoints(chrome.scriptText, full);

  const content = collectCssContent([...(input.css ?? []), ...slides.styleCss, ...chrome.styleCss]);
  addCodepoints(content.literals, full);

  for (const name of content.attrNames) {
    for (const element of [...slides.elements, ...chrome.elements]) {
      addCodepoints(element.getAttribute(name) ?? "", full);
    }
  }

  return { full };
}
