declare module "css-tree" {
  export interface CssNode {
    type: string;
    name?: string;
    property?: string;
    value?: CssNode;
    prelude?: CssNode | null;
    block?: { children: { forEach(callback: (node: CssNode) => void): void } } | null;
    children?: { forEach(callback: (node: CssNode) => void): void } | null;
  }
  export function parse(css: string, options?: { context?: string }): CssNode;
  export function generate(node: CssNode): string;
  export function walk(
    node: CssNode,
    options:
      | ((node: CssNode) => void)
      | { visit?: string; enter?: (this: { atrule: CssNode | null }, node: CssNode) => void },
  ): void;
}

declare module "linkedom" {
  export function parseHTML(html: string): { document: unknown };
}
