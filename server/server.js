#!/usr/bin/env node
/* ==========================================================================
 * CarTune minimal server — REST + WebSocket for the admin app and the
 * customer app. No dependencies (Node 20+ built-ins only).
 *
 *   node server/server.js [--port 8787] [--data server/data/cartune.json] [--static web/dist]
 *
 * - Store: one JSON file, written atomically (tmp + rename). Swap for SQLite/Postgres
 *   behind the same adapter {load, save} when it outgrows a file.
 * - Business rules: web/shared/cartune-core.js (same code as the local demo store).
 * - Passwords: PBKDF2-SHA256, 120k iterations, per-user salt. Never logged.
 * - Sessions: random bearer tokens, 12 h, dropped on suspend / password reset.
 * - Roles: owner / admin / support (PERMS in cartune-core.js), checked on every call.
 * - Rate limits per IP: 240 req/min overall; 10 logins / 10 min; 30 code redeems or
 *   help-joins / 10 min (stops guessing 6-digit help codes or discount codes).
 * - First run: no accounts and no seed data. The server prints a ONE-TIME setup token;
 *   open /admin, choose "Set up", paste it, and create the owner. Setup then closes.
 * - WebSocket relay: GET /ws?code=123456&key=<customer key>  or  &token=<staff token>.
 *   Pushes {type: snapshot|chat|suggestion|joined|end}. Read-only for the car:
 *   there is no route that writes to an ECU; suggestions need the customer's accept.
 * - Static: serves the built PWA (web/dist) at / and the admin app at /admin.
 * Put it behind HTTPS (a reverse proxy such as Caddy or nginx) before going live.
 * ======================================================================== */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Core = require("../web/shared/cartune-core.js");
const { ROUTES } = require("../web/shared/api.js");

function arg(name, d) { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : process.env["CARTUNE_" + name.toUpperCase()] || d; }

function fileStore(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let cache = null;
  return {
    load() { if (cache) return JSON.parse(cache); if (!fs.existsSync(file)) return null; cache = fs.readFileSync(file, "utf8"); return JSON.parse(cache); },
    save(db) { cache = JSON.stringify(db); const tmp = file + ".tmp"; fs.writeFileSync(tmp, cache, { mode: 0o600 }); fs.renameSync(tmp, file); },
  };
}

function limiter() {
  const hits = new Map();
  return function hit(bucket, ip, max, windowMs) {
    const k = bucket + "|" + ip, t = Date.now(); let a = hits.get(k) || [];
    a = a.filter((x) => t - x < windowMs); a.push(t); hits.set(k, a);
    if (hits.size > 50000) hits.clear();
    return a.length <= max;
  };
}

function createServer(opts = {}) {
  const sockets = new Set();
  const store = opts.store || fileStore(opts.data || path.join(__dirname, "data", "cartune.json"));
  const core = Core.createCore(store, { now: opts.now, publish(code, ev) { const msg = JSON.stringify(ev); for (const s of sockets) if (s.code === code) wsSend(s.sock, msg); } });
  const setupToken = crypto.randomBytes(12).toString("hex");
  const hit = limiter();
  const staticDir = opts.static === false ? null : path.resolve(opts.static || path.join(__dirname, "..", "web", "dist"));
  const routes = Object.entries(ROUTES).map(([name, [method, p, args]]) => {
    const keys = []; const re = new RegExp("^" + p.replace(/:([a-z]+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "$");
    return { name, method, re, keys, args };
  });
  const LIMITS = { login: ["auth", opts.loginLimit || 10, 600e3], redeemCode: ["guess", 30, 600e3], joinHelp: ["guess", 30, 600e3], setupOwner: ["auth", 10, 600e3], submitTune: ["submit", 20, 600e3], openHelp: ["submit", 20, 600e3] };
  const STATUS = { auth: 401, forbidden: 403, notfound: 404, invalid: 400, expired: 410, used: 409, ratelimit: 429 };

  function send(res, code, obj, extra) { res.writeHead(code, Object.assign({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }, cors(), extra || {})); res.end(JSON.stringify(obj)); }
  function cors() { return opts.cors ? { "Access-Control-Allow-Origin": opts.cors, "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS" } : {}; }
  function readBody(req) { return new Promise((ok, no) => { let n = 0, b = []; req.on("data", (c) => { n += c.length; if (n > 256 * 1024) { no(Object.assign(new Error("Body too large"), { code: "invalid" })); req.destroy(); } else b.push(c); }); req.on("end", () => { try { ok(b.length ? JSON.parse(Buffer.concat(b).toString("utf8")) : {}); } catch (e) { no(Object.assign(new Error("Bad JSON"), { code: "invalid" })); } }); }); }

  async function api(req, res, url, ip) {
    if (!hit("all", ip, 240, 60e3)) return send(res, 429, { error: "Too many requests", code: "ratelimit" });
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(res, 404, { error: "Not found", code: "notfound" });
    const lim = LIMITS[r.name]; if (lim && !hit(lim[0], ip, lim[1], lim[2])) return send(res, 429, { error: "Too many attempts. Wait a few minutes.", code: "ratelimit" });
    const m = url.pathname.match(r.re), params = {}; r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    const body = req.method === "GET" ? {} : await readBody(req);
    const auth = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "") || null;
    if (r.name === "setupOwner") { const info = await core.info(); if (info.setupNeeded && (!body.body || body.body.setupToken !== setupToken)) return send(res, 403, { error: "Paste the one-time setup token the server printed when it started", code: "forbidden" }); }
    const args = r.args.map((name) => {
      if (name === "token") return auth;
      if (name in params) return params[name];
      if (req.method === "GET") { const v = url.searchParams.get(name); return v === null ? undefined : v; }
      return body[name];
    });
    const result = await core[r.name].apply(null, args);
    send(res, 200, { result });
  }

  function serveStatic(req, res, url) {
    if (!staticDir || req.method !== "GET") return send(res, 404, { error: "Not found" });
    let p = decodeURIComponent(url.pathname); if (p === "/admin") { res.writeHead(301, { Location: "/admin/" }); return res.end(); }
    if (p.endsWith("/")) p += "index.html";
    const f = path.resolve(staticDir, "." + p);
    if (!f.startsWith(staticDir + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return send(res, 404, { error: "Not found" });
    const type = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".json": "application/json" }[path.extname(f)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" }); fs.createReadStream(f).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x"), ip = req.socket.remoteAddress || "?";
    if (req.method === "OPTIONS") { res.writeHead(204, cors()); return res.end(); }
    try { if (url.pathname.startsWith("/api/")) return await api(req, res, url, ip); return serveStatic(req, res, url); }
    catch (e) { send(res, STATUS[e.code] || 500, { error: STATUS[e.code] ? e.message : "Server error", code: e.code || "error" }); if (!STATUS[e.code]) console.error(e); }
  });

  /* ---- minimal WebSocket (RFC 6455): text frames, server → client push; pings answered ---- */
  server.on("upgrade", async (req, sock) => {
    const url = new URL(req.url, "http://x"), ip = req.socket.remoteAddress || "?";
    const fail = (c) => { sock.end("HTTP/1.1 " + c + "\r\n\r\n"); };
    if (url.pathname !== "/ws" || !req.headers["sec-websocket-key"]) return fail("400 Bad Request");
    if (!hit("guess", ip, 30, 600e3)) return fail("429 Too Many Requests");
    const code = String(url.searchParams.get("code") || ""), key = url.searchParams.get("key"), token = url.searchParams.get("token");
    try { if (token) await core.staffView(token, code); else await core.customerView(code, key); } catch (e) { return fail("403 Forbidden"); }
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
    const entry = { sock, code, role: token ? "staff" : "customer" }; sockets.add(entry);
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); while (buf.length >= 2) { const op = buf[0] & 15; let len = buf[1] & 127, off = 2; if (len === 126) { len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { sock.destroy(); return; }
      const masked = buf[1] & 128; if (buf.length < off + (masked ? 4 : 0) + len) return; off += masked ? 4 : 0; buf = buf.slice(off + len);
      if (op === 8) { sock.end(); return; } if (op === 9) sock.write(Buffer.from([0x8a, 0])); } });
    sock.on("close", () => sockets.delete(entry)); sock.on("error", () => sockets.delete(entry));
    wsSend(sock, JSON.stringify({ type: "hello", code, role: entry.role }));
  });
  function wsSend(sock, text) { const p = Buffer.from(text); let h; if (p.length < 126) h = Buffer.from([0x81, p.length]); else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); } else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); } try { sock.write(Buffer.concat([h, p])); } catch (e) {} }

  return { server, core, setupToken, sockets };
}

if (require.main === module) {
  const port = Number(arg("port", 8787)), host = arg("host", "127.0.0.1");
  const s = createServer({ data: arg("data"), static: arg("static"), cors: arg("cors") });
  s.server.listen(port, host, async () => {
    console.log(`CarTune server on http://${host}:${port}  (app /, admin /admin/, API /api, WebSocket /ws)`);
    if ((await s.core.info()).setupNeeded) console.log(`First run. One-time setup token: ${s.setupToken}\nOpen /admin/, choose "Set up", paste it, and create the owner account.`);
  });
}
module.exports = { createServer, fileStore };
