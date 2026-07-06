import { parseHTML } from "linkedom";

import { composeSlidesHtml } from "./presentation.js";

export interface DeckSlide {
  /** 1-based deck position — the number the runtime counter shows. */
  index: number;
  /** Source file, `slides/`-relative. */
  file: string;
  /** 1-based ordinal of this slide within its source file. */
  slideInFile: number;
  /** How many slides the source file contains. */
  slidesInFile: number;
  /** Text of the slide's first heading, if any. */
  title: string;
}

interface SlideElement {
  getAttribute(name: string): string | null;
  querySelector(selector: string): { textContent: string | null } | null;
}

export async function listDeckSlides(rootDir: string): Promise<DeckSlide[]> {
  const slidesHtml = await composeSlidesHtml(rootDir);
  const { document } = parseHTML(`<body>${slidesHtml}</body>`) as unknown as {
    document: { querySelectorAll(selector: string): { length: number; [index: number]: unknown } };
  };
  const nodes = document.querySelectorAll(".slide");
  const out: DeckSlide[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i] as SlideElement;
    const [inFile = "1", ofFile = "1"] = (el.getAttribute("data-zerp-src-slide") ?? "1/1").split(
      "/",
    );
    out.push({
      index: Number.parseInt(el.getAttribute("data-zerp-index") ?? "", 10) || i + 1,
      file: el.getAttribute("data-zerp-src") ?? "",
      slideInFile: Number.parseInt(inFile, 10) || 1,
      slidesInFile: Number.parseInt(ofFile, 10) || 1,
      title: (el.querySelector("h1, h2, h3")?.textContent ?? "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

export function formatSlideList(slides: DeckSlide[]): string {
  const indexWidth = Math.max(1, String(slides.length).length);
  const fileWidth = Math.max(4, ...slides.map((slide) => slide.file.length));
  const lines = [`${"#".padStart(indexWidth)}  ${"file".padEnd(fileWidth)}  in-file  title`];
  for (const slide of slides) {
    lines.push(
      [
        String(slide.index).padStart(indexWidth),
        slide.file.padEnd(fileWidth),
        `${slide.slideInFile}/${slide.slidesInFile}`.padEnd(7),
        slide.title,
      ]
        .join("  ")
        .trimEnd(),
    );
  }
  return `${lines.join("\n")}\n`;
}
