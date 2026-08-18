import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

import { generateTokenContrast, generateTokensCss } from "./generate-tokens.mjs";

await rm("dist", { force: true, recursive: true });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { stdio: "inherit" });
await mkdir("dist/assets", { recursive: true });
await cp("src/assets", "dist/assets", { recursive: true });

const tokensCss = await generateTokensCss();
const baseCss = await readFile("dist/assets/base-styles.css", "utf8");
await writeFile("dist/assets/default-styles.css", `${tokensCss}\n\n${baseCss}`);
await rm("dist/assets/base-styles.css");

await mkdir("dist/check", { recursive: true });
await writeFile(
  "dist/check/token-contrast.json",
  JSON.stringify(await generateTokenContrast(), null, 2),
);

execFileSync("pnpm", ["exec", "oxfmt", "--write", "dist"], { stdio: "inherit" });

// tsc emits without the exec bit; the bin entry needs it when the package
// is consumed via npm/pnpm link rather than a tarball install.
await chmod("dist/cli.js", 0o755);
