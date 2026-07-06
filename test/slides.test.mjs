import assert from "node:assert/strict";
import { test } from "node:test";

import { formatSlideList, listDeckSlides } from "../dist/slides.js";

const rootDir = "test/fixtures/multi-deck";

test("listDeckSlides maps deck positions to source files", async () => {
  const slides = await listDeckSlides(rootDir);
  assert.deepEqual(slides, [
    { index: 1, file: "slides/00-two.html", slideInFile: 1, slidesInFile: 2, title: "Alpha" },
    { index: 2, file: "slides/00-two.html", slideInFile: 2, slidesInFile: 2, title: "Beta" },
    { index: 3, file: "slides/01-more.md", slideInFile: 1, slidesInFile: 2, title: "Gamma" },
    { index: 4, file: "slides/01-more.md", slideInFile: 2, slidesInFile: 2, title: "Delta" },
  ]);
});

test("formatSlideList renders one aligned row per slide", async () => {
  const table = formatSlideList(await listDeckSlides(rootDir));
  assert.match(table, /#\s+file\s+in-file\s+title/);
  assert.match(table, /1\s+slides\/00-two\.html\s+1\/2\s+Alpha/);
  assert.match(table, /2\s+slides\/00-two\.html\s+2\/2\s+Beta/);
  assert.match(table, /4\s+slides\/01-more\.md\s+2\/2\s+Delta/);
});
