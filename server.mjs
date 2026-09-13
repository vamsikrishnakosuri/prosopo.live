// Local dev server (no dependencies): serves the static site and /api/chat.
// Production uses Vercel (static files + api/ functions) instead.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chatCompletion, validateMessages } from "./lib/hf.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 3000;

// Load .env.local if present (KEY=VALUE lines)
try {
  const env = await readFile(join(ROOT, ".env.local"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* no .env.local — demo mode */ }

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".glb": "model/gltf-binary",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/chat") {
    if (req.method !== "POST") {
      res.writeHead(405).end(JSON.stringify({ error: "POST only" }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    let parsed;
    try { parsed = JSON.parse(body); } catch { parsed = null; }
    const messages = validateMessages(parsed);
    if (!messages) {
      res.writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Invalid messages" }));
      return;
    }
    try {
      const result = await chatCompletion(messages);
      res.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify(result));
    } catch (err) {
      console.error(err.message);
      res.writeHead(502, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Upstream model error" }));
    }
    return;
  }

  // Static files
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  path = normalize(path).replace(/^([.][.][/\\])+/, "");
  try {
    const file = await readFile(join(ROOT, path));
    res.writeHead(200, {
      "Content-Type": MIME[extname(path).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    }).end(file);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`PROSOPO dev server → http://localhost:${PORT}`);
  console.log(process.env.HF_TOKEN ? "HF token loaded — live AI replies." : "No HF_TOKEN — demo replies (create .env.local, see README).");
});
