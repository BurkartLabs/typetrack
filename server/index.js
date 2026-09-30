"use strict";
// typetrack server: static files from public/ plus the JSON API under /api. No dependencies.
//   PORT (default 5177), DATA_DIR (default ./data), TRUST_PROXY=1 to take the client IP from X-Forwarded-For.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const db = require("./db.js");
const auth = require("./auth.js");
const { HttpError, send, rateLimiter } = require("./http.js");
const { wordLists } = require("./validate.js");
const results = require("./api/results.js");
const leaderboard = require("./api/leaderboard.js");
const games = require("./api/games.js");
const profile = require("./api/profile.js");
const weekly = require("./api/weekly.js");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webmanifest": "application/manifest+json",
};

// [method, pattern, handler(app, req, res, params, query)]
const ROUTES = [
  ["POST", /^\/api\/register$/, auth.register],
  ["POST", /^\/api\/login$/, auth.login],
  ["POST", /^\/api\/logout$/, auth.logout],
  ["GET", /^\/api\/me$/, auth.me],
  ["POST", /^\/api\/results$/, results.create],
  ["GET", /^\/api\/leaderboard$/, leaderboard.list],
  ["GET", /^\/api\/leaderboard\/me$/, leaderboard.me],
  ["GET", /^\/api\/weekly$/, weekly.standings],
  ["GET", /^\/api\/weekly\/winners$/, weekly.winners],
  ["GET", /^\/api\/ghosts\/(\d{1,15})$/, results.ghost],
  ["POST", /^\/api\/games\/([^/]+)\/score$/, games.score],
  ["GET", /^\/api\/games\/([^/]+)\/leaderboard$/, games.leaderboard],
  ["GET", /^\/api\/profile\/([^/]+)$/, profile.get],
];

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
};

async function handleApi(app, req, res, url) {
  // Cross-site writes: SameSite=Lax already blocks the cookie on cross-site POSTs, and a JSON body forces a
  // CORS preflight we never answer. A mismatching Origin is refused outright as a third layer.
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers.origin) {
    let originHost = null;
    try {
      originHost = new URL(req.headers.origin).host;
    } catch {
      /* "null" or garbage */
    }
    const hosts = [req.headers.host, req.headers["x-forwarded-host"]].filter(Boolean);
    if (!hosts.includes(originHost)) throw new HttpError(403, "cross-origin request refused");
  }
  let pathMatched = false;
  for (const [method, re, handler] of ROUTES) {
    const m = re.exec(url.pathname);
    if (!m) continue;
    pathMatched = true;
    if (method !== req.method) continue;
    return handler(app, req, res, m.slice(1), url.searchParams);
  }
  throw new HttpError(pathMatched ? 405 : 404, pathMatched ? "method not allowed" : "not found");
}

function serveStatic(app, req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return notFound(res);
  }
  if (rel.includes("\0")) return notFound(res);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(app.publicDir, "." + path.posix.normalize("/" + rel.replace(/\\/g, "/")));
  if (file !== app.publicDir && !file.startsWith(app.publicDir + path.sep)) return notFound(res);
  if (path.basename(file).startsWith(".")) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": st.size,
      "Cache-Control": "no-cache",
      "Last-Modified": st.mtime.toUTCString(),
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
}

function notFound(res) {
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
}

function start({ port = Number(process.env.PORT) || 5177, dataDir = process.env.DATA_DIR || path.join(ROOT, "data"),
  publicDir = PUBLIC, wordsDir, host, rateLimit = {}, trustProxy = process.env.TRUST_PROXY === "1" } = {}) {
  const pub = path.resolve(publicDir);
  const limits = { max: 10, windowMs: 60 * 1000, ...rateLimit };
  const app = {
    db: db.open(path.resolve(dataDir)),
    publicDir: pub,
    opts: { trustProxy },
    limiters: { login: rateLimiter(limits), register: rateLimiter(limits) },
    wordsDir: path.resolve(wordsDir || path.join(pub, "words")),
    isRanked: wordLists(path.resolve(wordsDir || path.join(pub, "words"))),
  };

  const server = http.createServer(async (req, res) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    let url;
    try {
      url = new URL(req.url, "http://x");
    } catch {
      return send(res, 400, { error: "bad url" });
    }
    if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return serveStatic(app, req, res, url);
    try {
      await handleApi(app, req, res, url);
    } catch (e) {
      if (res.headersSent) return res.destroy();
      if (e instanceof HttpError) return send(res, e.status, { error: e.message }, e.headers);
      console.error(e);
      send(res, 500, { error: "server error" });
    }
  });
  server.on("close", () => {
    app.limiters.login.stop();
    app.limiters.register.stop();
    try {
      app.db.close();
    } catch {
      /* already closed */
    }
  });
  server.app = app;
  server.listen(port, host);
  return server;
}

module.exports = { start };

if (require.main === module) {
  const server = start();
  server.on("listening", () => {
    const a = server.address();
    console.log(`typetrack on http://localhost:${a.port}`);
  });
}
