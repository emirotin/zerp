import { marked } from "marked";

const SLIDE_SEPARATOR = /^---\s*$/;
const CODE_FENCE_OPEN = /^`{3,}/;

function splitMarkdownSlides(content: string): string[] {
  const lines = content.split("\n");
  const slides: string[][] = [[]];
  let fence: string | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (fence) {
      if (trimmed === fence) {
        fence = null;
      }
      slides[slides.length - 1]!.push(line);
    } else if (CODE_FENCE_OPEN.test(trimmed)) {
      const match = trimmed.match(/^(`{3,})/);
      fence = match![1]!;
      slides[slides.length - 1]!.push(line);
    } else if (SLIDE_SEPARATOR.test(line)) {
      slides.push([]);
    } else {
      slides[slides.length - 1]!.push(line);
    }
  }

  return slides.map((s) => s.join("\n").trim()).filter(Boolean);
}

export function renderMarkdownSlides(content: string): string[] {
  const chunks = splitMarkdownSlides(content);
  return chunks.map((chunk) => {
    const html = marked.parse(chunk, { async: false }) as string;
    return `<div class="slide">\n${html}</div>`;
  });
}
