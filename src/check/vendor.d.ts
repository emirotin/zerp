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
  export function parse(css: string): CssNode;
  export function generate(node: CssNode): string;
  export function walk(
    node: CssNode,
    options:
      | ((node: CssNode) => void)
      | { visit?: string; enter?: (this: { atrule: CssNode | null }, node: CssNode) => void },
  ): void;
}

declare module "apca-w3" {
  export function APCAcontrast(textY: number, bgY: number, places?: number): number | string;
  export function sRGBtoY(rgb: number[]): number;
  export function fontLookupAPCA(lc: number | string, places?: number): Array<number | string>;
}

declare module "linkedom" {
  export function parseHTML(html: string): { document: unknown };
}
