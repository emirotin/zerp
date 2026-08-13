import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { readDeckConfig } from "../dist/deck-config.js";
import { fontCss } from "../dist/fonts.js";
import { buildPresentationHtml } from "../dist/presentation.js";

const latin = new Set([..."Ab 1"].map((character) => character.codePointAt(0)));
const subsetsOf = (css) => [...css.matchAll(/\/\* ([a-z0-9-]+) \*\//g)].map((match) => match[1]);

async function writeTempDeck(zerp) {
  const dir = await mkdtemp(path.join(tmpdir(), "zerp-config-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "temp-deck", zerp }));
  return dir;
}

test("a deck with no package.json is configured — with the defaults", async () => {
  assert.deepEqual(await readDeckConfig("test/fixtures/kitchen-sink"), {});
  const { faces, tokens } = await fontCss("test/fixtures/kitchen-sink", latin);
  assert.equal(tokens, "", "nothing to say, so nothing is emitted");
  assert.ok(
    subsetsOf(faces).every(
      (subset) =>
        subset.startsWith("montserrat-latin") ||
        subset.startsWith("roboto-mono-latin") ||
        subset === "zerp-symbols-400-normal",
    ),
  );
});

test("zerp.fonts in the deck's package.json selects the families", async () => {
  const config = await readDeckConfig("test/fixtures/custom-font-deck");
  assert.deepEqual(config, { fonts: { body: { family: "Roboto Mono" } } });

  const { faces, tokens } = await fontCss("test/fixtures/custom-font-deck", latin);
  // The package name is derived from the family, and resolved from the deck
  // (this one falls back to zerp's own copy, which is the same package).
  assert.ok(subsetsOf(faces).every((subset) => !subset.startsWith("montserrat")));
  assert.ok(subsetsOf(faces).includes("roboto-mono-latin-600-normal"), "a body weight");
  // 900 is a body weight zerp's styles ask for and Roboto Mono does not ship.
  // It is simply not emitted — the browser synthesizes, and no engine for
  // remapping weights has to exist.
  assert.ok(!subsetsOf(faces).some((subset) => subset.includes("-900-")));
  // Each woff2 once, though body and mono resolved to the same package.
  assert.equal(new Set(subsetsOf(faces)).size, subsetsOf(faces).length);
  // The four stacks, rebuilt around the configured family, symbol face intact.
  assert.match(tokens, /--zerp-font-body: "Roboto Mono", "Zerp Symbols", sans-serif;/);
  assert.match(tokens, /--zerp-font-marker: "Zerp Symbols", "Roboto Mono", sans-serif;/);
  assert.match(tokens, /--zerp-font-nav: "Roboto Mono", monospace;/);
});

test("the token block lands after the base styles that define the defaults", async () => {
  const html = await buildPresentationHtml({ rootDir: "test/fixtures/custom-font-deck" });
  assert.ok(
    html.indexOf('data-zerp="font-tokens"') > html.indexOf('data-zerp="base"'),
    "later in the cascade, so the deck's families win",
  );
  const defaulted = await buildPresentationHtml({ rootDir: "test/fixtures/kitchen-sink" });
  assert.ok(!defaulted.includes("font-tokens"), "a default deck's document is unchanged");
});

test("a font package the deck never installed fails with a plain instruction", async () => {
  await assert.rejects(
    buildPresentationHtml({ rootDir: "test/fixtures/missing-font-deck" }),
    /Cannot resolve "@fontsource\/not-installed" for the mono font .*pnpm add @fontsource\/not-installed/s,
  );
});

test("config mistakes are named, not ignored", async () => {
  const cases = [
    [{ fonts: { body: { fontsourcePackage: "@fontsource/inter" } } }, /family must be/],
    [{ fonts: { body: { family: "Inter", weight: ["400"] } } }, /unknown key "weight"/],
    [{ fonts: { body: { family: "Inter", weights: "400" } } }, /weights must be an array/],
    [{ fonts: { display: { fontsourcePackage: "@fontsource/inter" } } }, /family must be/],
    [{ fonts: { display: { family: "Inter", weight: ["400"] } } }, /unknown key "weight"/],
    [{ fonts: { heading: { family: "Inter" } } }, /unknown key "heading"/],
    [{ font: {} }, /unknown key "font"/],
  ];
  for (const [zerp, expected] of cases) {
    const dir = await writeTempDeck(zerp);
    await assert.rejects(readDeckConfig(dir), expected);
  }
});

test("display is a role of its own", async () => {
  const dir = await writeTempDeck({
    fonts: { display: { family: "Roboto Mono", weights: ["400"] } },
  });
  assert.deepEqual(await readDeckConfig(dir), {
    fonts: { display: { family: "Roboto Mono", weights: ["400"] } },
  });
});

test("a package that declares a different family name says so", async () => {
  const dir = await writeTempDeck({
    fonts: { mono: { family: "Roboto Mono Flex", fontsourcePackage: "@fontsource/roboto-mono" } },
  });
  await assert.rejects(
    fontCss(dir, latin),
    /declares font-family "Roboto Mono", but zerp.fonts.mono.family says "Roboto Mono Flex"/,
  );
});
