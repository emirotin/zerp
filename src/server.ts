import { createServer, type Server, type ServerResponse } from "node:http";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { checkPresentation } from "./check/checker.js";
import { formatReport } from "./check/report.js";
import { buildPresentationHtml } from "./presentation.js";
import type { ThemeName } from "./presentation.js";

const CONTENT_TYPES = new Map<string, string>([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

const WATCH_INTERVAL_MS = 300;
const SSE_PING_INTERVAL_MS = 25_000;

// Injected by the dev server only — built decks never contain this. On a
// change event the client flags the reload in sessionStorage so the runtime
// can restore the active slide's step counter (the hash restores the slide).
const RELOAD_CLIENT = [
  '<script data-zerp="live-reload">',
  "      (() => {",
  '        new EventSource("/__zerp/events").addEventListener("reload", () => {',
  "          try {",
  '            sessionStorage.setItem("zerp-live-reload", "1");',
  "          } catch {}",
  "          location.reload();",
  "        });",
  "      })();",
  "    </script>",
].join("\n");

function getContentType(filePath: string): string {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

// Fingerprint everything under slides/ (sources AND assets) by path, mtime,
// and size. Decks are dozens of files, so a stat sweep every 300ms is
// negligible and avoids fs.watch's platform quirks.
async function fingerprintDir(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  const parts: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      parts.push(await fingerprintDir(entryPath));
    } else {
      const stats = await stat(entryPath);
      parts.push(`${entryPath}:${stats.mtimeMs}:${stats.size}`);
    }
  }
  return parts.join("|");
}

export interface ServeOptions {
  theme?: ThemeName;
}

export async function servePresentation(
  rootDir: string,
  port: number,
  options: ServeOptions = {},
): Promise<Server> {
  const resolvedRoot = path.resolve(rootDir);
  const slidesDir = path.join(resolvedRoot, "slides");
  const host = "127.0.0.1";

  const sseClients = new Set<ServerResponse>();

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(requestUrl.pathname);

      if (pathname === "/__zerp/events") {
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(":connected\n\n");
        sseClients.add(res);
        req.on("close", () => {
          sseClients.delete(res);
        });
        return;
      }

      if (pathname === "/" || pathname === "/index.html") {
        const html = await buildPresentationHtml({
          rootDir: resolvedRoot,
          ...(options.theme !== undefined ? { theme: options.theme } : {}),
        });
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html.replace("</body>", `${RELOAD_CLIENT}\n  </body>`));
        checkPresentation({ rootDir: resolvedRoot })
          .then((report) => process.stdout.write(formatReport(report, { summaryOnly: true })))
          .catch(() => {
            /* check is advisory during serve */
          });
        return;
      }

      const candidatePath = path.resolve(resolvedRoot, `.${pathname}`);
      if (!candidatePath.startsWith(resolvedRoot)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }

      const content = await readFile(candidatePath);
      res.writeHead(200, { "content-type": getContentType(candidatePath) });
      res.end(content);
    } catch (error) {
      const status = (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
      res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
      res.end(status === 404 ? "Not found" : "Internal server error");
    }
  });

  let lastFingerprint: string | null = null;
  let sweeping = false;
  const watcher = setInterval(() => {
    if (sweeping) {
      return;
    }
    sweeping = true;
    fingerprintDir(slidesDir)
      .then((fingerprint) => {
        if (lastFingerprint !== null && fingerprint !== lastFingerprint) {
          for (const client of sseClients) {
            client.write("event: reload\ndata: 1\n\n");
          }
        }
        lastFingerprint = fingerprint;
      })
      .catch(() => {
        /* transient fs states (mid-save) — retry next sweep */
      })
      .finally(() => {
        sweeping = false;
      });
  }, WATCH_INTERVAL_MS);
  watcher.unref();

  const pinger = setInterval(() => {
    for (const client of sseClients) {
      client.write(":ping\n\n");
    }
  }, SSE_PING_INTERVAL_MS);
  pinger.unref();

  server.on("close", () => {
    clearInterval(watcher);
    clearInterval(pinger);
    for (const client of sseClients) {
      client.end();
    }
    sseClients.clear();
  });

  await new Promise<void>((resolve) => {
    server.listen(port, host, resolve);
  });

  process.stdout.write(`Serving ${resolvedRoot} at http://${host}:${port} (live reload on)\n`);
  return server;
}
