import { existsSync, statSync, watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

import { buildPresentationHtml } from "../dist/presentation.js";

const name = process.argv[2];

if (!name) {
  console.error("Usage: pnpm demo <example-name>");
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

const slidesDir = path.join(rootDir, "slides");
if (!existsSync(slidesDir) || !statSync(slidesDir).isDirectory()) {
  console.error(`No slides/ directory in examples/${name}`);
  process.exit(1);
}

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const RELOAD_SNIPPET =
  '<script>new EventSource("/_zerp/reload").onmessage=()=>location.reload()</script>';

const sseClients = new Set();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/_zerp/reload") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(":\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  try {
    if (pathname === "/" || pathname === "/index.html") {
      const html = await buildPresentationHtml({ rootDir });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html.replace("</body>", `${RELOAD_SNIPPET}\n</body>`));
      return;
    }

    const candidatePath = path.resolve(rootDir, `.${pathname}`);
    if (!candidatePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const content = await readFile(candidatePath);
    const ext = path.extname(candidatePath).toLowerCase();
    res.writeHead(200, { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
    res.end(content);
  } catch (error) {
    const status = error.code === "ENOENT" ? 404 : 500;
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(status === 404 ? "Not found" : "Internal server error");
  }
});

function parseInt(str, fallback) {
  const parsed = str ? Number.parseInt(str) : null;
  return parsed === null || Number.isNaN(parsed) ? fallback : parsed;
}

const host = "127.0.0.1";
const port = parseInt(process.argv[3], 8000);
server.listen(port, host, () => {
  console.log(`Serving examples/${name} at http://${host}:${port} (live reload active)`);
});

let reloadTimer;
watch(slidesDir, { recursive: true }, () => {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const client of sseClients) {
      client.write("data: reload\n\n");
    }
  }, 100);
});
