import assert from "node:assert/strict";
import { get } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { buildPresentationHtml } from "../dist/presentation.js";
import { servePresentation } from "../dist/server.js";

let rootDir;
let server;
let baseUrl;

before(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "zerp-live-"));
  await mkdir(path.join(rootDir, "slides"));
  await writeFile(path.join(rootDir, "slides", "00-first.md"), "# Hello\n", "utf8");
  server = await servePresentation(rootDir, 0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(rootDir, { recursive: true, force: true });
});

function fetchText(url) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => resolve(body));
    }).on("error", reject);
  });
}

test("serve injects the live-reload client", async () => {
  const html = await fetchText(`${baseUrl}/`);
  assert.match(html, /data-zerp="live-reload"/);
  assert.match(html, /\/__zerp\/events/);
});

test("build output does not contain the live-reload client", async () => {
  // The runtime ships the sessionStorage restore half in every build (inert
  // without the flag); the EventSource client itself must be serve-only.
  const html = await buildPresentationHtml({ rootDir });
  assert.doesNotMatch(html, /data-zerp="live-reload"/);
  assert.doesNotMatch(html, /__zerp\/events/);
  assert.doesNotMatch(html, /EventSource/);
});

test("a slide change emits an SSE reload event", async () => {
  await new Promise((resolve, reject) => {
    let settled = false;
    const timers = [];
    const done = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      for (const timer of timers) {
        clearTimeout(timer);
      }
      req.destroy();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const req = get(`${baseUrl}/__zerp/events`, (res) => {
      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.includes("event: reload")) {
          done();
        }
      });
    });
    req.on("error", (error) => {
      if (!settled) {
        done(error);
      }
    });
    // Give the watcher time to take its baseline fingerprint, then edit.
    timers.push(
      setTimeout(() => {
        writeFile(path.join(rootDir, "slides", "00-first.md"), "# Hello again\n", "utf8").catch(
          done,
        );
      }, 700),
    );
    timers.push(setTimeout(() => done(new Error("no reload event within 8s")), 8000));
  });
});
