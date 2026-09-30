"use strict";
// Small HTTP helpers shared by the API modules.

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const KB = 1024;
const SMALL_BODY = 10 * KB;

function send(res, status, body, headers = {}) {
  const data = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(data),
    ...headers,
  });
  res.end(data);
}

// Reads a JSON body. Rejects other content types (415), bodies over `limit` (413) and bad JSON (400).
function readJson(req, limit = SMALL_BODY) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") return reject(new HttpError(415, "expected application/json"));
    const declared = Number(req.headers["content-length"]);
    if (declared > limit) return reject(new HttpError(413, "body too large"));
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        reject(new HttpError(413, "body too large"));
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
        if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error();
        resolve(v);
      } catch {
        reject(new HttpError(400, "invalid json"));
      }
    });
    req.on("error", (e) => {
      if (!done) {
        done = true;
        reject(e);
      }
    });
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (fwd) return fwd;
  }
  return req.socket.remoteAddress || "unknown";
}

function isHttps(req) {
  return Boolean(req.socket.encrypted) || String(req.headers["x-forwarded-proto"] || "").toLowerCase() === "https";
}

// Fixed-window in-memory limiter: at most `max` hits per `windowMs` per key.
function rateLimiter({ max, windowMs }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();
  return {
    hit(key) {
      const now = Date.now();
      let v = hits.get(key);
      if (!v || v.reset <= now) {
        v = { n: 0, reset: now + windowMs };
        hits.set(key, v);
      }
      v.n++;
      return v.n <= max ? 0 : Math.ceil((v.reset - now) / 1000);
    },
    stop() {
      clearInterval(sweep);
    },
  };
}

module.exports = { HttpError, send, readJson, parseCookies, clientIp, isHttps, rateLimiter, SMALL_BODY, KB };
