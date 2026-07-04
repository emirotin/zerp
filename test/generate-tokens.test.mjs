import assert from "node:assert/strict";
import { test } from "node:test";

import { generateTokenContrast, generateTokensCss } from "../scripts/generate-tokens.mjs";

test("tokens CSS defines both explicit themes and system fallbacks", async () => {
  const css = await generateTokensCss();
  assert.match(css, /:root\[data-zerp-theme="dark"\]/);
  assert.match(css, /:root\[data-zerp-theme="light"\]/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /@media \(prefers-color-scheme: light\)/);
  assert.match(css, /:root:not\(\[data-zerp-theme\]\)/);
});

test("dark theme uses Harmony gray-950 background and gray-100 text", async () => {
  const css = await generateTokensCss();
  const darkBlock = css.split(':root[data-zerp-theme="light"]')[0];
  assert.match(darkBlock, /--zerp-bg: #12141c;/);
  assert.match(darkBlock, /--zerp-text: #f0f3ff;/);
  assert.match(darkBlock, /--zerp-on-solid: #fafbfe;/);
  assert.match(darkBlock, /color-scheme: dark;/);
});

test("every theme exposes all 40 tokens", async () => {
  const css = await generateTokensCss();
  for (const theme of ["dark", "light"]) {
    const block = css.match(new RegExp(`:root\\[data-zerp-theme="${theme}"\\] \\{[^}]*\\}`))[0];
    assert.equal((block.match(/--zerp-/g) ?? []).length, 40);
    assert.match(block, /--zerp-shadow: 0 8px 24px rgb\(0 0 0 \/ 0\.\d+\);/);
    for (const hue of ["blue", "green", "orange", "purple", "red", "amber", "teal"]) {
      for (const suffix of ["", "-solid", "-tint", "-on-tint"]) {
        assert.match(block, new RegExp(`--zerp-${hue}${suffix}: #[0-9a-f]{6};`));
      }
    }
  }
});

test("token contrast table has signed Lc values per background", async () => {
  const contrast = await generateTokenContrast();
  const darkTextOnBg = contrast.dark.lc["--zerp-bg"]["--zerp-text"];
  assert.ok(darkTextOnBg < -90, `expected strong negative Lc, got ${darkTextOnBg}`);
  const lightTextOnBg = contrast.light.lc["--zerp-bg"]["--zerp-text"];
  assert.ok(lightTextOnBg > 90, `expected strong positive Lc, got ${lightTextOnBg}`);
  assert.ok(Math.abs(contrast.dark.lc["--zerp-surface"]["--zerp-muted"]) > 60);
});
