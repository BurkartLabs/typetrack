const test = require("node:test");
const assert = require("node:assert/strict");

const load = (p) => import("../public/js/core/" + p);

test("router: parseHash splits path, sub-path and query; accepts v1 hashes", async () => {
  const { parseHash } = await load("router.js");
  assert.deepEqual(parseHash("#/games/typing-racer?seed=4&x=y"), { segments: ["games", "typing-racer"], query: { seed: "4", x: "y" } });
  assert.deepEqual(parseHash("#stats"), { segments: ["stats"], query: {} });
  assert.deepEqual(parseHash(""), { segments: [], query: {} });
  assert.deepEqual(parseHash("#/profile/J%C3%B6rg").segments, ["profile", "Jörg"]);
});

test("router: matchRoute picks the most specific route and fills params", async () => {
  const { matchRoute } = await load("router.js");
  const routes = [
    { path: "games" },
    { path: "profile/:name" },
    { path: "profile/me" },
    { path: "test" },
  ];
  let m = matchRoute(routes, ["games", "sprint", "x"]);
  assert.equal(m.route.path, "games");
  assert.equal(m.params.sub, "sprint/x");
  assert.deepEqual(m.params.parts, ["sprint", "x"]);
  m = matchRoute(routes, ["games"]);
  assert.equal(m.params.sub, undefined);
  m = matchRoute(routes, ["profile", "ann"]);
  assert.equal(m.route.path, "profile/:name");
  assert.equal(m.params.name, "ann");
  assert.equal(matchRoute(routes, ["profile", "me"]).route.path, "profile/me");
  assert.equal(matchRoute(routes, ["nope"]), null);
  assert.equal(matchRoute(routes, ["profile"]), null);
});

test("settings: defaults match the contract and set() emits settings:changed", async () => {
  const settings = (await load("settings.js")).default;
  const bus = (await load("bus.js")).default;
  assert.deepEqual(settings.DEFAULTS, {
    lang: "en", list: "common-1k", accents: "lenient", layout: "qwerty", sound: "off", caret: "underline",
    hideTimer: false, hideLiveWpm: false, width: 1000, theme: null,
  });
  let seen = null;
  const off = bus.on("settings:changed", (d) => { seen = d; });
  settings.set("width", 800);
  off();
  assert.deepEqual(seen, { key: "width", value: 800 });
  assert.equal(settings.get("width"), 800);
});

test("store: isResult accepts v1 results and text mode, rejects junk", async () => {
  const { isResult } = await load("store.js");
  assert.ok(isResult({ ts: 1, wpm: 80, acc: 97, mode: "time", target: 30 }));
  assert.ok(isResult({ ts: 1, wpm: 80, acc: 97, mode: "text", target: 12 }));
  assert.ok(!isResult({ ts: 1, wpm: 80, acc: 97, mode: "zen", target: 30 }));
  assert.ok(!isResult(null));
});

test("typing: paceAt walks word + space per word", async () => {
  const { paceAt, splitText } = await load("typing.js");
  const words = ["ab", "cde", "f"];
  // 60 wpm = 5 chars/s
  assert.deepEqual(paceAt(words, 60, 0), { index: 0, typed: 0 });
  assert.deepEqual(paceAt(words, 60, 400), { index: 0, typed: 2 }); // 2 chars
  assert.deepEqual(paceAt(words, 60, 600), { index: 1, typed: 0 }); // 3 chars: "ab "
  assert.deepEqual(paceAt(words, 60, 60000), { index: 2, typed: 1 }); // past the end: stays at the end
  assert.deepEqual(splitText("  the quick\n brown  "), ["the", "quick", "brown"]);
});

test("words: FALLBACK is the v1 English list", async () => {
  const { FALLBACK } = await load("words.js");
  assert.ok(FALLBACK.length >= 200 && FALLBACK.every((w) => /^[a-z]+$/.test(w)));
  assert.equal(FALLBACK[0], "the");
});
