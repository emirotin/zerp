import { spawn } from "node:child_process";
import { existsSync, statSync, watch } from "node:fs";
import path from "node:path";

// Framework-development inner loop: serve an example deck through the real
// `zerp serve` (which owns live reload), watch src/, and on change rebuild
// dist/ and respawn the server. A fresh process is the only reliable way to
// pick up a rebuilt dist — the ESM module cache pins imports for the life of
// a process. Browsers notice the restart via the reload client's SSE
// reconnect and refresh themselves, stepped slides preserved.

const name = process.argv[2];

if (!name) {
  console.error("Usage: pnpm demo <example-name> [port]");
  process.exit(1);
}

if (name.includes("..") || path.isAbsolute(name)) {
  console.error(`Invalid example name: ${name}`);
  process.exit(1);
}

const rootDir = path.resolve("examples", name);

if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
  console.error(`Example not found: examples/${name}`);
  process.exit(1);
}

if (!existsSync(path.join(rootDir, "slides"))) {
  console.error(`No slides/ directory in examples/${name}`);
  process.exit(1);
}

const parsedPort = Number.parseInt(process.argv[3] ?? "", 10);
const port = Number.isInteger(parsedPort) ? parsedPort : 8000;

let server = null;
let restarting = false;

function startServer() {
  restarting = false;
  server = spawn(process.execPath, ["dist/cli.js", "serve", rootDir, String(port)], {
    stdio: "inherit",
  });
}

function restartServer() {
  if (!server || server.exitCode !== null) {
    startServer();
    return;
  }
  if (restarting) {
    return;
  }
  restarting = true;
  server.once("exit", startServer);
  server.kill();
}

// Builds are serialized; a change arriving mid-build queues exactly one
// follow-up build.
let building = false;
let buildQueued = false;

function rebuildFramework() {
  if (building) {
    buildQueued = true;
    return;
  }
  building = true;
  console.log("Framework change detected - rebuilding dist/ ...");
  const build = spawn(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
  build.on("exit", (code) => {
    building = false;
    if (code === 0) {
      console.log("Rebuilt - restarting the server; browsers reload on reconnect.");
      restartServer();
    } else {
      console.error("Build failed - keeping the previous server.");
    }
    if (buildQueued) {
      buildQueued = false;
      rebuildFramework();
    }
  });
}

const srcDir = path.resolve("src");
if (existsSync(srcDir)) {
  let buildTimer;
  watch(srcDir, { recursive: true }, () => {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(rebuildFramework, 300);
  });
}

startServer();
