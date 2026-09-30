// The Board, 2026-09-30: after signing out "it's like I stay logged in, I can still see my profile as though I am, I see
// my level". The server did end the session (server.test.js, "register -> login -> me -> logout"); the pages kept
// reading one browser-wide store. Progress is now scoped to whoever is signed in (store.js), set by auth.js.
const test = require("node:test");
const assert = require("node:assert/strict");

// a localStorage for the client modules, installed before they load
const mem = new Map();
globalThis.localStorage = {
  get length() { return mem.size; },
  key: (i) => [...mem.keys()][i] ?? null,
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => { mem.delete(k); },
  clear: () => mem.clear(),
};
// the API: /api/me answers for whoever the test says is signed in; /api/logout ends it
let signedIn = null;
globalThis.fetch = async (url, opts = {}) => {
  const path = String(url);
  const json = (status, body) => ({ ok: status < 400, status, headers: { get: () => "application/json" }, json: async () => body, text: async () => JSON.stringify(body) });
  if (path.endsWith("/api/logout")) { signedIn = null; return json(200, { ok: true }); }
  if (path.endsWith("/api/login")) { signedIn = JSON.parse(opts.body).email === "b@x.test" ? { id: 2, name: "bea" } : { id: 1, name: "ann" }; return json(200, { user: signedIn }); }
  if (path.endsWith("/api/me")) return signedIn ? json(200, { user: signedIn }) : json(401, { error: "not signed in" });
  return json(404, { error: "no route" });
};

const load = (p) => import("../public/js/core/" + p);
const result = (wpm, ts) => ({ ts, wpm, acc: 97, mode: "time", target: 30 });

test("sign-out: the account's results, xp and game scores leave the pages; a guest sees only the guest's", async () => {
  mem.clear();
  const { store } = await load("store.js");
  const { auth } = await load("auth.js");
  await auth.refresh(); // a guest
  store.addResult(result(40, 1));
  store.set("xp", 25);

  await auth.login("a@x.test", "pw"); // the first sign-in here adopts the guest's progress
  assert.deepEqual(store.results().map((r) => r.wpm), [40]);
  store.addResult(result(71, 2));
  store.set("xp", 90);
  store.addGameScore("word-bomb", 12);
  assert.deepEqual(store.gameIds(), ["word-bomb"]);

  await auth.logout();
  assert.equal(auth.user, null);
  assert.deepEqual(store.results(), [], "signed out, the account's results are not shown");
  assert.equal(store.get("xp", null), null, "nor its level");
  assert.deepEqual(store.gameIds(), [], "nor its game scores");

  await auth.login("a@x.test", "pw"); // back in: the account's own progress, as it left it
  assert.deepEqual(store.results().map((r) => r.wpm), [40, 71]);
  assert.equal(store.get("xp", null), 90);
  await auth.logout();
});

test("sign-out: a second account on the same browser never sees the first one's progress", async () => {
  mem.clear();
  const { store } = await load("store.js");
  const { auth } = await load("auth.js");
  await auth.login("a@x.test", "pw");
  store.addResult(result(88, 3));
  await auth.logout();
  store.addResult(result(30, 4)); // someone else, signed out
  await auth.login("b@x.test", "pw"); // bea adopts only the guest's run
  assert.deepEqual(store.results().map((r) => r.wpm), [30]);
  await auth.logout();
  assert.deepEqual(store.results(), []);
});

test("sign-out: preferences stay with the browser, and a page load already signed in reads the account", async () => {
  mem.clear();
  const { store } = await load("store.js");
  const { auth } = await load("auth.js");
  store.set("settings.v1", { theme: "crimson" });
  signedIn = { id: 1, name: "ann" };
  await auth.refresh(); // what app.js does on load
  assert.deepEqual(store.get("settings.v1", null), { theme: "crimson" });
  store.set("xp", 5);
  assert.ok(mem.has("typetrack.u1.xp") && !mem.has("typetrack.xp"));
  await auth.logout();
  assert.deepEqual(store.get("settings.v1", null), { theme: "crimson" });
});
