// Local stand-in for Vercel: serves public/ and runs api/*.js handlers. `npm run dev` → http://localhost:3000
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.chdir(path.dirname(fileURLToPath(import.meta.url)));
const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve("public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain" };

// Test-only wallet for browsers without Phantom. Served by this dev server only, never deployed.
const DEV_FILES = {
  "/dev/nacl.js": "node_modules/tweetnacl/nacl-fast.min.js",
  "/dev/mock-wallet.js": "test/mock-wallet.js",
};

async function api(req, res, name) {
  const file = path.resolve("api", name + ".js");
  if (!/^[\w-]+$/.test(name) || !fs.existsSync(file)) return send(res, 404, "Not found");
  const mod = await import(pathToFileURL(file).href);
  const fn = mod[req.method];
  if (!fn) return send(res, 405, "Method not allowed");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await fn(request);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

function send(res, status, body, type = "text/plain") {
  res.writeHead(status, { "content-type": type });
  res.end(body);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/api/")) return await api(req, res, url.pathname.slice(5));
    if (DEV_FILES[url.pathname]) return send(res, 200, fs.readFileSync(DEV_FILES[url.pathname]), "text/javascript");
    // Link preview generator (tools/og.html) and where it saves the PNG
    if (url.pathname === "/dev/og") return send(res, 200, fs.readFileSync("tools/og.html"), TYPES[".html"]);
    if (url.pathname === "/dev/save-og" && req.method === "POST") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      fs.writeFileSync("public/img/og.png", Buffer.concat(chunks));
      return send(res, 200, "ok");
    }
    let file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT)) return send(res, 403, "Forbidden");
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html";
    if (!fs.existsSync(file)) return send(res, 404, "Not found");
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || "application/octet-stream");
  } catch (e) {
    console.error(e);
    send(res, 500, "Server error");
  }
}).listen(PORT, () => console.log(`Enlist dev server: http://localhost:${PORT}`));
