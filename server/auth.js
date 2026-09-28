"use strict";
// Accounts and cookie sessions. Passwords: scrypt with a per-user random salt, compared with timingSafeEqual.
// Sessions: 32 random bytes in the cookie, only their sha256 is stored.
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { HttpError, send, readJson, parseCookies, clientIp, isHttps } = require("./http.js");

const scrypt = promisify(crypto.scrypt);
const COOKIE = "tt_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 3600 * 1000;
const KEYLEN = 64;
const NAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const BAD_LOGIN = "invalid email or password";
// Used to spend the same scrypt time when the email is unknown, so timing does not reveal accounts.
const DUMMY_SALT = crypto.randomBytes(16).toString("hex");

async function hashPassword(password, salt) {
  return (await scrypt(password, salt, KEYLEN)).toString("hex");
}

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function sessionCookie(req, token, maxAgeSec) {
  let c = `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`;
  if (isHttps(req)) c += "; Secure";
  return c;
}

// Returns {id, name} for a valid session cookie, else null.
function currentUser(app, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const row = app.db
    .prepare(
      "SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?"
    )
    .get(sha256(token), Date.now());
  return row ? { id: row.id, name: row.name } : null;
}

function requireUser(app, req) {
  const u = currentUser(app, req);
  if (!u) throw new HttpError(401, "sign in required");
  return u;
}

function limit(app, req, which) {
  const wait = app.limiters[which].hit(clientIp(req, app.opts.trustProxy));
  if (wait) {
    const e = new HttpError(429, "too many attempts, try again later");
    e.headers = { "Retry-After": String(wait) };
    throw e;
  }
}

async function register(app, req, res) {
  limit(app, req, "register");
  const b = await readJson(req);
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password : "";
  if (!NAME_RE.test(name)) throw new HttpError(400, "name must be 2-24 letters, digits, _ or -");
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, "invalid email");
  if (password.length < 8) throw new HttpError(400, "password must be at least 8 characters");
  if (password.length > 256) throw new HttpError(400, "password too long");

  const taken = (field, v) => app.db.prepare(`SELECT 1 FROM users WHERE ${field} = ?`).get(v);
  if (taken("email", email)) throw new HttpError(409, "email already registered");
  if (taken("name", name)) throw new HttpError(409, "name taken");

  const salt = crypto.randomBytes(16).toString("hex");
  const hash = await hashPassword(password, salt);
  try {
    app.db
      .prepare("INSERT INTO users (name, email, pass_hash, salt, created) VALUES (?, ?, ?, ?, ?)")
      .run(name, email, hash, salt, Date.now());
  } catch (e) {
    // Lost a race with a concurrent registration.
    if (/UNIQUE/.test(String(e.message))) {
      throw new HttpError(409, /email/.test(e.message) ? "email already registered" : "name taken");
    }
    throw e;
  }
  send(res, 201, { ok: true });
}

async function login(app, req, res) {
  limit(app, req, "login");
  const b = await readJson(req);
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
  const password = typeof b.password === "string" ? b.password.slice(0, 256) : "";
  const user = email ? app.db.prepare("SELECT id, name, pass_hash, salt FROM users WHERE email = ?").get(email) : null;
  const actual = Buffer.from(await hashPassword(password, user ? user.salt : DUMMY_SALT), "hex");
  const expected = user ? Buffer.from(user.pass_hash, "hex") : crypto.randomBytes(KEYLEN);
  const ok = user && actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  if (!ok) throw new HttpError(401, BAD_LOGIN);

  const token = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  app.db.prepare("DELETE FROM sessions WHERE expires <= ?").run(now);
  app.db
    .prepare("INSERT INTO sessions (token_hash, user_id, expires) VALUES (?, ?, ?)")
    .run(sha256(token), user.id, now + SESSION_MS);
  send(res, 200, { user: { id: user.id, name: user.name } }, {
    "Set-Cookie": sessionCookie(req, token, SESSION_MS / 1000),
  });
}

async function logout(app, req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) app.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
  send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(req, "", 0) });
}

function me(app, req, res) {
  const user = currentUser(app, req);
  if (!user) return send(res, 401, { error: "not signed in" });
  send(res, 200, { user });
}

module.exports = { register, login, logout, me, currentUser, requireUser, COOKIE, NAME_RE };
