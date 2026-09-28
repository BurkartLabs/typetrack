"use strict";
// Server tests: start the real server on port 0 with a temp DATA_DIR and talk to it over HTTP.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const E = require("../public/js/engine.js");
const { start } = require("../server/index.js");

const POOL = ["the", "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "and", "runs"];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-server-"));
const wordsDir = path.join(tmp, "words");
fs.mkdirSync(path.join(wordsDir, "en"), { recursive: true });
fs.writeFileSync(path.join(wordsDir, "en", "common-200.json"), JSON.stringify(POOL));

let server;
let base;

function listen(opts) {
  return new Promise((resolve) => {
    const s = start({ port: 0, host: "127.0.0.1", ...opts });
    s.on("listening", () => resolve(s));
  });
}

test.before(async () => {
  server = await listen({ dataDir: path.join(tmp, "data"), wordsDir, rateLimit: { max: 1000 } });
  base = `http://127.0.0.1:${server.address().port}`;
});
function stop(s) {
  return new Promise((resolve) => {
    s.close(resolve);
    s.closeAllConnections();
  });
}

test.after(async () => {
  await stop(server);
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, p, body, cookie, headers = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function signup(name) {
  const email = `${name.toLowerCase()}@example.com`;
  const r = await call("POST", "/api/register", { name, email, password: "correct horse" });
  assert.equal(r.status, 201, r.text);
  const l = await call("POST", "/api/login", { email, password: "correct horse" });
  assert.equal(l.status, 200, l.text);
  return l.headers.get("set-cookie").split(";")[0];
}

// Drive the engine like a browser would and record the keystroke log.
// msPerChar sets the speed; `typo` inserts one wrong letter (then backspaces it) in the first word.
function playResult({ mode = "time", target = 15, msPerChar = 200, typo = false, words = POOL, seed = 3 } = {}) {
  const s = E.createTest({ mode, duration: target, wordCount: target, words, seed });
  const log = [];
  let t = 0;
  const key = (k) => {
    E.tick(s, t);
    if (s.finishedAt !== null) return;
    log.push([t, k]);
    if (k === "\b") E.backspace(s);
    else if (k === " ") E.space(s, t);
    else E.input(s, k, t);
    t += msPerChar;
  };
  let first = true;
  while (s.finishedAt === null) {
    const w = s.words[s.index];
    if (typo && first) {
      key("x");
      key("\b");
    }
    first = false;
    for (const ch of w) key(ch);
    if (s.finishedAt === null) key(" ");
    if (mode === "time") E.tick(s, t);
  }
  const r = E.results(s);
  return { ...r, lang: "en", words: s.words.slice(0, Math.min(s.words.length, s.index + 1)), log };
}

test("register -> login -> me -> logout", async () => {
  const reg = await call("POST", "/api/register", { name: "alice", email: "Alice@Example.com", password: "password123" });
  assert.equal(reg.status, 201);
  assert.deepEqual(reg.json, { ok: true });

  const login = await call("POST", "/api/login", { email: "alice@example.com", password: "password123" });
  assert.equal(login.status, 200);
  assert.equal(login.json.user.name, "alice");
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const me = await call("GET", "/api/me", undefined, cookie);
  assert.equal(me.status, 200);
  assert.deepEqual(me.json.user, { id: login.json.user.id, name: "alice" });

  const out = await call("POST", "/api/logout", {}, cookie);
  assert.equal(out.status, 200);
  assert.match(out.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await call("GET", "/api/me", undefined, cookie)).status, 401);
});

test("session cookie flags: HttpOnly, SameSite=Lax, Path=/, 30 days; Secure only behind https", async () => {
  await call("POST", "/api/register", { name: "cookies", email: "c@example.com", password: "password123" });
  const plain = await call("POST", "/api/login", { email: "c@example.com", password: "password123" });
  const c = plain.headers.get("set-cookie");
  assert.match(c, /^tt_session=[A-Za-z0-9_-]{40,}/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Path=\//);
  assert.match(c, /Max-Age=2592000/);
  assert.doesNotMatch(c, /Secure/);
  const tls = await call("POST", "/api/login", { email: "c@example.com", password: "password123" }, null, {
    "x-forwarded-proto": "https",
  });
  assert.match(tls.headers.get("set-cookie"), /; Secure/);
});

test("duplicate email or name (case-insensitive) is 409; invalid input is 400", async () => {
  await call("POST", "/api/register", { name: "bob", email: "bob@example.com", password: "password123" });
  assert.equal((await call("POST", "/api/register", { name: "bob2", email: "BOB@example.com", password: "password123" })).status, 409);
  assert.equal((await call("POST", "/api/register", { name: "BOB", email: "other@example.com", password: "password123" })).status, 409);
  assert.equal((await call("POST", "/api/register", { name: "b", email: "x@example.com", password: "password123" })).status, 400);
  assert.equal((await call("POST", "/api/register", { name: "bad name", email: "y@example.com", password: "password123" })).status, 400);
  assert.equal((await call("POST", "/api/register", { name: "zed", email: "not-an-email", password: "password123" })).status, 400);
  assert.equal((await call("POST", "/api/register", { name: "zed", email: "z@example.com", password: "short" })).status, 400);
});

test("bad password and unknown email give the same generic 401", async () => {
  await call("POST", "/api/register", { name: "carol", email: "carol@example.com", password: "password123" });
  const wrong = await call("POST", "/api/login", { email: "carol@example.com", password: "nope-nope" });
  const unknown = await call("POST", "/api/login", { email: "ghost@example.com", password: "password123" });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.json.error, "invalid email or password");
  assert.equal(unknown.json.error, wrong.json.error);
  assert.equal(wrong.headers.get("set-cookie"), null);
});

test("non-JSON, oversized and cross-origin requests are refused", async () => {
  const form = await call("POST", "/api/login", "email=a&password=b", null, { "content-type": "application/x-www-form-urlencoded" });
  assert.equal(form.status, 415);
  const big = await call("POST", "/api/register", { name: "big", email: "big@example.com", password: "x".repeat(20000) });
  assert.equal(big.status, 413);
  const cross = await call("POST", "/api/login", { email: "a@b.cc", password: "password123" }, null, { origin: "https://evil.example" });
  assert.equal(cross.status, 403);
});

test("login and register are rate limited per IP", async () => {
  const s = await listen({ dataDir: path.join(tmp, "data-rl"), wordsDir, rateLimit: { max: 3 } });
  const url = `http://127.0.0.1:${s.address().port}/api/login`;
  const statuses = [];
  for (let i = 0; i < 5; i++) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: '{"email":"a@b.cc","password":"password1"}' });
    statuses.push(r.status);
  }
  await stop(s);
  assert.deepEqual(statuses, [401, 401, 401, 429, 429]);
});

test("a genuine result is accepted and stored with the engine's numbers", async () => {
  const cookie = await signup("dave");
  const r = playResult({ typo: true });
  assert.ok(r.wpm > 30 && r.acc < 100, `wpm ${r.wpm} acc ${r.acc}`);
  const res = await call("POST", "/api/results", r, cookie);
  assert.equal(res.status, 201, res.text);
  assert.equal(typeof res.json.id, "number");
  assert.equal(res.json.rank, 1);
  assert.equal(res.json.wpm, r.wpm);

  const words = playResult({ mode: "words", target: 10, msPerChar: 150 });
  const w = await call("POST", "/api/results", words, cookie);
  assert.equal(w.status, 201, w.text);
});

test("results need a session", async () => {
  assert.equal((await call("POST", "/api/results", playResult())).status, 401);
});

test("tampered, implausible or log-less results are rejected", async () => {
  const cookie = await signup("eve");
  const r = playResult();
  const post = (body) => call("POST", "/api/results", body, cookie);
  assert.equal((await post({ ...r, wpm: r.wpm + 20 })).status, 422);
  assert.equal((await post({ ...r, acc: r.acc - 5 })).status, 422);
  assert.equal((await post({ ...r, log: undefined })).status, 422);
  assert.equal((await post({ ...r, log: [] })).status, 422);
  // A words test whose log is squeezed to fake a faster finish no longer matches its claimed numbers.
  const w = playResult({ mode: "words", target: 10 });
  assert.equal((await post(w)).status, 201);
  assert.equal((await post({ ...w, log: w.log.map(([t, k]) => [t / 2, k]) })).status, 422);
  // A bot at 5 ms per key, honestly reported, is still implausible.
  const bot = playResult({ msPerChar: 5 });
  assert.ok(bot.wpm > 350);
  assert.equal((await post(bot)).status, 422);
  // Time tests shorter than 5 seconds.
  assert.equal((await post({ ...playResult({ target: 3 }) })).status, 422);
  // Typing past the submitted word list.
  assert.equal((await post({ ...r, words: r.words.slice(0, 3) })).status, 422);
});

test("leaderboard: best result per user, ordered by wpm, filters and periods", async () => {
  const fast = await signup("fast");
  const slow = await signup("slow");
  const a = await call("POST", "/api/results", playResult({ msPerChar: 110, target: 30 }), fast);
  const a2 = await call("POST", "/api/results", playResult({ msPerChar: 160, target: 30 }), fast);
  const b = await call("POST", "/api/results", playResult({ msPerChar: 140, target: 30 }), slow);
  assert.equal(a.status, 201);
  assert.equal(a2.status, 201);
  assert.equal(b.status, 201);
  assert.equal(b.json.rank, 2);

  const lb = await call("GET", "/api/leaderboard?mode=time&target=30&lang=en&period=all");
  assert.equal(lb.status, 200);
  assert.deepEqual(lb.json.map((r) => r.name), ["fast", "slow"]);
  assert.deepEqual(lb.json.map((r) => r.rank), [1, 2]);
  assert.equal(lb.json[0].resultId, a.json.id);
  assert.ok(lb.json[0].wpm > lb.json[1].wpm);
  for (const k of ["rank", "name", "wpm", "acc", "ts", "resultId"]) assert.ok(k in lb.json[0], k);

  assert.equal((await call("GET", "/api/leaderboard?mode=time&target=30&period=day")).json.length, 2);
  assert.equal((await call("GET", "/api/leaderboard?mode=time&target=60")).json.length, 0);
  assert.equal((await call("GET", "/api/leaderboard?mode=time&target=30&lang=de")).json.length, 0);
  assert.equal((await call("GET", "/api/leaderboard?period=year")).status, 400);
});

test("results of words outside the standard lists are stored but unranked", async () => {
  const cookie = await signup("cheap");
  const r = playResult({ words: ["a", "i"], target: 30, msPerChar: 150 });
  const res = await call("POST", "/api/results", r, cookie);
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.ranked, false);
  const lb = await call("GET", "/api/leaderboard?mode=time&target=30");
  assert.ok(!lb.json.some((row) => row.name === "cheap"));
});

test("non-standard sources (drills, ghosts) are stored but unranked", async () => {
  const cookie = await signup("driller");
  for (const source of ["train:blind", "ghost", "quotes"]) {
    const res = await call("POST", "/api/results", { ...playResult({ target: 30, msPerChar: 150 }), source }, cookie);
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.ranked, false, source);
  }
  const ok = await call("POST", "/api/results", { ...playResult({ target: 30, msPerChar: 150 }), source: "words" }, cookie);
  assert.equal(ok.json.ranked, true);
});

test("ghost fetch returns the words and log of a result", async () => {
  const cookie = await signup("ghosty");
  const r = playResult();
  const saved = await call("POST", "/api/results", r, cookie);
  const g = await call("GET", `/api/ghosts/${saved.json.id}`);
  assert.equal(g.status, 200);
  assert.equal(g.json.name, "ghosty");
  assert.equal(g.json.wpm, r.wpm);
  assert.deepEqual(g.json.words, r.words);
  assert.deepEqual(g.json.log, r.log);
  assert.equal(g.json.mode, "time");
  assert.equal(g.json.target, 15);
  assert.equal((await call("GET", "/api/ghosts/999999")).status, 404);
});

test("game scores: post needs auth, leaderboard keeps each user's best", async () => {
  const p1 = await signup("gamer1");
  const p2 = await signup("gamer2");
  assert.equal((await call("POST", "/api/games/zombie/score", { score: 5 })).status, 401);
  assert.equal((await call("POST", "/api/games/zombie/score", { score: 10, meta: { wave: 3 } }, p1)).status, 201);
  assert.equal((await call("POST", "/api/games/zombie/score", { score: 30 }, p1)).status, 201);
  assert.equal((await call("POST", "/api/games/zombie/score", { score: 20 }, p2)).status, 201);
  assert.equal((await call("POST", "/api/games/zombie/score", { score: "lots" }, p2)).status, 422);
  assert.equal((await call("POST", "/api/games/Bad_Id/score", { score: 1 }, p2)).status, 400);
  const lb = await call("GET", "/api/games/zombie/leaderboard?period=week");
  assert.equal(lb.status, 200);
  assert.deepEqual(lb.json.map((r) => [r.rank, r.name, r.score]), [[1, "gamer1", 30], [2, "gamer2", 20]]);
  const asc = await call("GET", "/api/games/zombie/leaderboard?order=asc");
  assert.deepEqual(asc.json.map((r) => [r.name, r.score]), [["gamer1", 10], ["gamer2", 20]]);
});

test("profile shows joined, pbs and test count; unknown user is 404", async () => {
  const cookie = await signup("Profiled");
  await call("POST", "/api/results", playResult(), cookie);
  const p = await call("GET", "/api/profile/profiled");
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json.name, "Profiled");
  assert.equal(p.json.tests, 1);
  assert.equal(typeof p.json.joined, "number");
  assert.equal(p.json.pbs.length, 1);
  assert.equal(typeof p.json.xp, "number");
  assert.ok(p.json.level >= 1);
  assert.ok(p.json.badges.some((b) => b.id === "tests-1"), "first-test badge earned: " + JSON.stringify(p.json.badges));
  assert.equal((await call("GET", "/api/profile/nobody-here")).status, 404);
});

test("static files: content types, index for /, 404s, traversal blocked", async () => {
  const root = await fetch(base + "/");
  assert.equal(root.status, 200);
  assert.match(root.headers.get("content-type"), /text\/html/);
  assert.match(await root.text(), /<html/i);
  const js = await fetch(base + "/js/engine.js");
  assert.match(js.headers.get("content-type"), /text\/javascript/);
  const css = await fetch(base + "/css/base.css");
  assert.match(css.headers.get("content-type"), /text\/css/);
  assert.equal((await fetch(base + "/nope.html")).status, 404);
  for (const p of ["/../package.json", "/%2e%2e/package.json", "/css/..%2f..%2fpackage.json", "/..%5cpackage.json", "/%00"]) {
    const r = await fetch(base + p);
    assert.equal(r.status, 404, p);
  }
  assert.equal((await fetch(base + "/", { method: "POST" })).status, 405);
});
