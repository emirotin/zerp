/**
 * Dev-time visual harness: screenshot deck slides via headless Chrome.
 *
 * Usage (after `pnpm build`):
 *   pnpm shot <deck-dir> [--slide 1,16] [--theme dark|light|both] \
 *     [--setup "js to run after the runtime"] [--focus ".selector"] \
 *     [--scale 2] [--out shots] [--size 1920x1080]
 *
 * --focus outlines matching elements in magenta; --scale renders at a
 * higher device pixel ratio for close inspection of small elements;
 * --no-web-fonts blackholes Google Fonts (fast + offline-safe layout shots).
 *
 * Drives Chrome over the DevTools Protocol (Emulation.setDeviceMetricsOverride)
 * rather than the --window-size/--screenshot CLI flags: headless Chrome's
 * --window-size sets the outer window bounds, and vh/%-based layout vs.
 * position:fixed elements resolve against two different, disagreeing
 * viewport notions derived from it — no single size or post-crop
 * reconciles both (a deck's fixed-position nav chrome and its vh-sized
 * slide frame would land in different places). CDP's device metrics
 * override sets one real viewport that every subsystem agrees on, so
 * captures are pixel-exact to --size with nothing to compensate.
 *
 * Shots are capped at 15s per page — a hung network fetch degrades to
 * fallback rendering instead of hanging the harness. Chrome itself is
 * killed as soon as the shot is captured: headless Chrome can hang on
 * shutdown for minutes, so the harness never waits for a clean exit.
 *
 * Writes <out>/<deck>-s<N>-<theme>.png. Requires Google Chrome or Chromium
 * (override the binary with CHROME_BIN).
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import { buildPresentationHtml } from "../dist/index.js";

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome",
  "chromium",
  "chromium-browser",
].filter(Boolean);

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate.includes("/") && !existsSync(candidate)) {
      continue;
    }
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore" });
    if (probe.status === 0) {
      return candidate;
    }
  }
  console.error("No Chrome/Chromium found. Set CHROME_BIN to a browser binary.");
  process.exit(1);
}

function killProcessGroup(child) {
  if (!child.pid) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Minimal DevTools Protocol client over Node's built-in WebSocket: tracks
 * request ids to resolve responses, dispatches events to waiters, and
 * fails every pending request the moment the connection drops instead of
 * leaving them hanging forever.
 */
function createCdpClient(ws) {
  let nextId = 1;
  const pending = new Map();
  const eventListeners = new Set();

  const rejectAllPending = (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  };
  ws.addEventListener("close", () => rejectAllPending(new Error("DevTools connection closed")));
  ws.addEventListener("error", () => rejectAllPending(new Error("DevTools connection error")));
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined) {
      const waiter = pending.get(message.id);
      if (!waiter) {
        return;
      }
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`CDP error (${message.error.code}): ${message.error.message}`));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    if (message.method) {
      for (const listener of eventListeners) {
        listener(message);
      }
    }
  });

  return {
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify(payload));
      });
    },
    // Resolves with the next matching event, or null if timeoutMs elapses
    // first — callers proceed either way, capturing whatever has rendered.
    waitForEvent(method, sessionId, timeoutMs) {
      return new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          if (done) {
            return;
          }
          done = true;
          eventListeners.delete(listener);
          resolve(null);
        }, timeoutMs);
        const listener = (message) => {
          if (done || message.method !== method) {
            return;
          }
          if (sessionId && message.sessionId !== sessionId) {
            return;
          }
          done = true;
          clearTimeout(timer);
          eventListeners.delete(listener);
          resolve(message);
        };
        eventListeners.add(listener);
      });
    },
  };
}

async function connectWebSocket(url, timeoutMs) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("DevTools WebSocket connection timed out"));
    }, timeoutMs);
    ws.addEventListener(
      "open",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
    ws.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("DevTools WebSocket connection failed"));
      },
      { once: true },
    );
  });
  return ws;
}

/**
 * Launch headless Chrome with a DevTools port and connect to it. Chrome
 * writes the assigned port and browser endpoint path into its profile dir
 * shortly after starting (--remote-debugging-port=0 picks a free port);
 * poll for that file rather than parsing stderr.
 */
async function launchChrome(chrome, extraArgs) {
  const profile = mkdtempSync(path.join(tmpdir(), "zerp-shot-"));
  const portFile = path.join(profile, "DevToolsActivePort");
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-extensions",
      "--disable-component-update",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      ...extraArgs,
      "about:blank",
    ],
    { detached: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = Date.now() + 10_000;
  while (!existsSync(portFile) && Date.now() < deadline) {
    await sleep(50);
  }
  if (!existsSync(portFile)) {
    killProcessGroup(child);
    rmSync(profile, { force: true, recursive: true });
    throw new Error(`Chrome never opened a DevTools port:\n${stderr}`);
  }
  const [port, wsPath] = readFileSync(portFile, "utf8").trim().split("\n");
  const ws = await connectWebSocket(`ws://127.0.0.1:${port}${wsPath}`, 10_000);
  return { child, profile, ws, cdp: createCdpClient(ws) };
}

/**
 * Open a fresh page target, force its viewport to exactly width x height
 * before navigating (so nothing ever renders against the wrong size, even
 * transiently), load url, and capture a PNG at that same size.
 */
async function captureScreenshot(cdp, { url, width, height, scale, timeoutMs }) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width, height, deviceScaleFactor: scale, mobile: false },
    sessionId,
  );
  const loaded = cdp.waitForEvent("Page.loadEventFired", sessionId, timeoutMs);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  // Let reveal/theme-switch transitions and any deferred script settle.
  await sleep(500);
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId,
  );
  await cdp.send("Target.closeTarget", { targetId });
  return Buffer.from(data, "base64");
}

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    slide: { type: "string", default: "1" },
    theme: { type: "string", default: "both" },
    setup: { type: "string" },
    focus: { type: "string" },
    scale: { type: "string", default: "1" },
    "no-web-fonts": { type: "boolean", default: false },
    out: { type: "string", default: "shots" },
    size: { type: "string", default: "1920x1080" },
  },
});

const deckDir = path.resolve(positionals[0] ?? ".");
if (!existsSync(path.join(deckDir, "slides"))) {
  console.error(`Not a deck directory (no slides/): ${deckDir}`);
  process.exit(1);
}

const themes = values.theme === "both" ? ["dark", "light"] : [values.theme];
for (const theme of themes) {
  if (!["dark", "light"].includes(theme)) {
    console.error(`Invalid theme: ${theme} (use dark, light, or both)`);
    process.exit(1);
  }
}
const slides = values.slide.split(",").map((s) => Number.parseInt(s.trim(), 10));
if (slides.some((n) => !Number.isInteger(n) || n < 1)) {
  console.error(`Invalid --slide list: ${values.slide}`);
  process.exit(1);
}
const sizeMatch = values.size.match(/^(\d+)x(\d+)$/);
if (!sizeMatch) {
  console.error(`Invalid --size: ${values.size} (expected WxH)`);
  process.exit(1);
}
const scaleValue = Number.parseFloat(values.scale);
if (!(scaleValue > 0)) {
  console.error(`Invalid --scale: ${values.scale}`);
  process.exit(1);
}

const chrome = findChrome();
const requestedWidth = Number.parseInt(sizeMatch[1], 10);
const requestedHeight = Number.parseInt(sizeMatch[2], 10);
const outDir = path.resolve(values.out);
mkdirSync(outDir, { recursive: true });
const deckName = path.basename(deckDir);
const tempHtml = path.join(deckDir, `.zerp-shot-${process.pid}.html`);
const shots = [];

// Sweep temp files orphaned by killed runs; an hour of age keeps us clear of
// any run that is still legitimately in flight.
for (const name of readdirSync(deckDir)) {
  if (/^\.zerp-shot-\d+\.html$/.test(name)) {
    const stale = path.join(deckDir, name);
    if (Date.now() - statSync(stale).mtimeMs > 60 * 60 * 1000) {
      rmSync(stale, { force: true });
    }
  }
}

try {
  for (const theme of themes) {
    let html = await buildPresentationHtml({ rootDir: deckDir, theme });
    // Freeze the theme: shots must not depend on a stale localStorage profile.
    const freeze = `<script>try{localStorage.setItem("zerp-theme",${JSON.stringify(theme)})}catch{}</script>`;
    const focus = values.focus
      ? `<script>for (const el of document.querySelectorAll(${JSON.stringify(values.focus)})) { el.style.outline = "4px solid magenta"; el.style.outlineOffset = "3px"; }</script>`
      : "";
    const setup = values.setup ? `<script>${values.setup}</script>` : "";
    html = html
      .replace("<body>", `<body>${freeze}`)
      .replace("</body>", `${setup}${focus}\n</body>`);
    writeFileSync(tempHtml, html);

    for (const slide of slides) {
      const outPath = path.join(outDir, `${deckName}-s${slide}-${theme}.png`);
      rmSync(outPath, { force: true });
      const extraArgs = values["no-web-fonts"]
        ? [
            "--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1, MAP fonts.gstatic.com 127.0.0.1",
          ]
        : [];
      // Chrome can hang on shutdown for minutes (observed with headless 149
      // on macOS), so launch/capture/kill happen in the same try/finally —
      // cleanup always runs even if a step above throws or times out.
      const { child, profile, ws, cdp } = await launchChrome(chrome, extraArgs);
      let png;
      let captureError;
      try {
        png = await captureScreenshot(cdp, {
          url: `file://${tempHtml}#${slide}`,
          width: requestedWidth,
          height: requestedHeight,
          scale: scaleValue,
          timeoutMs: 15_000,
        });
      } catch (error) {
        captureError = error;
      } finally {
        try {
          ws.close();
        } catch {
          // already gone
        }
        killProcessGroup(child);
        rmSync(profile, { force: true, recursive: true });
      }
      if (captureError) {
        console.error(`Chrome failed for slide ${slide} (${theme}):`);
        console.error(captureError.stack ?? String(captureError));
        process.exit(1);
      }
      writeFileSync(outPath, png);
      shots.push(outPath);
      console.log(outPath);
    }
  }
} finally {
  rmSync(tempHtml, { force: true });
}

console.log(`${shots.length} shot(s) written to ${outDir}`);
