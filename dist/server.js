import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildPresentationHtml } from "./presentation.js";
const CONTENT_TYPES = new Map([
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
function getContentType(filePath) {
    return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}
export async function servePresentation(rootDir, port) {
    const resolvedRoot = path.resolve(rootDir);
    const server = createServer(async (req, res) => {
        try {
            const requestUrl = new URL(req.url ?? "/", "http://localhost");
            const pathname = decodeURIComponent(requestUrl.pathname);
            if (pathname === "/" || pathname === "/index.html") {
                const html = await buildPresentationHtml({ rootDir: resolvedRoot });
                res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
                res.end(html);
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
        }
        catch (error) {
            const status = error.code === "ENOENT" ? 404 : 500;
            res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
            res.end(status === 404 ? "Not found" : "Internal server error");
        }
    });
    await new Promise((resolve) => {
        server.listen(port, resolve);
    });
    process.stdout.write(`Serving ${resolvedRoot} at http://localhost:${port}\n`);
}
