import * as csstree from "css-tree";

import type { CheckTheme } from "./types.js";

export interface StyleRule {
  selector: string;
  specificity: readonly [number, number, number];
  order: number;
  declarations: ReadonlyMap<string, string>;
}

export interface StyleSheetInput {
  css: string;
  origin: "framework" | "deck";
}

export interface CssModel {
  rules: StyleRule[];
  themeVars: Record<CheckTheme, Map<string, string>>;
  skippedSelectors: string[];
}

const THEME_BLOCK = /^:root\[data-zerp-theme=(?:"(dark|light)"|(dark|light))\]$/;

function isSupportedSelector(selector: string): boolean {
  if (selector === ":root" || selector === "html") {
    return true;
  }
  return !/[[\]+~:]/.test(selector);
}

function specificityOf(selectorNode: csstree.CssNode): [number, number, number] {
  let ids = 0;
  let classes = 0;
  let types = 0;
  csstree.walk(selectorNode, (node) => {
    if (node.type === "IdSelector") {
      ids += 1;
    } else if (
      node.type === "ClassSelector" ||
      node.type === "AttributeSelector" ||
      node.type === "PseudoClassSelector"
    ) {
      classes += 1;
    } else if (node.type === "TypeSelector" && node.name !== "*") {
      types += 1;
    }
  });
  return [ids, classes, types];
}

export function parseStylesheets(sheets: StyleSheetInput[]): CssModel {
  const rules: StyleRule[] = [];
  const themeVars: Record<CheckTheme, Map<string, string>> = {
    dark: new Map(),
    light: new Map(),
  };
  const skipped = new Set<string>();
  let order = 0;

  for (const sheet of sheets) {
    const ast = csstree.parse(sheet.css);
    csstree.walk(ast, {
      visit: "Rule",
      enter(node) {
        if (this.atrule) {
          return;
        }
        const prelude = node.prelude;
        if (!prelude || prelude.type !== "SelectorList" || !prelude.children) {
          return;
        }
        const declarations = new Map<string, string>();
        node.block?.children.forEach((decl) => {
          if (decl.type === "Declaration" && decl.property && decl.value) {
            const property = decl.property.startsWith("--")
              ? decl.property
              : decl.property.toLowerCase();
            declarations.set(property, csstree.generate(decl.value).trim());
          }
        });
        prelude.children.forEach((selectorNode) => {
          const selector = csstree.generate(selectorNode).trim();
          const themeMatch = selector.match(THEME_BLOCK);
          if (themeMatch) {
            const theme = (themeMatch[1] ?? themeMatch[2]) as CheckTheme;
            for (const [property, value] of declarations) {
              if (property.startsWith("--")) {
                themeVars[theme].set(property, value);
              }
            }
            return;
          }
          if (selector === ":root" || selector === "html") {
            for (const [property, value] of declarations) {
              if (property.startsWith("--")) {
                themeVars.dark.set(property, value);
                themeVars.light.set(property, value);
              }
            }
          }
          if (!isSupportedSelector(selector)) {
            if (sheet.origin === "deck") {
              skipped.add(selector);
            }
            return;
          }
          rules.push({
            selector,
            specificity: specificityOf(selectorNode),
            order: order++,
            declarations,
          });
        });
      },
    });
  }

  return { rules, themeVars, skippedSelectors: [...skipped] };
}
