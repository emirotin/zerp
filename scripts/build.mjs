import { cp, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

await rm("dist", { force: true, recursive: true });
execFileSync("pnpm", ["exec", "tsc", "-p", "tsconfig.json"], { stdio: "inherit" });
await mkdir("dist/assets", { recursive: true });
await cp("src/assets", "dist/assets", { recursive: true });
execFileSync("pnpm", ["exec", "oxfmt", "--write", "dist"], { stdio: "inherit" });
