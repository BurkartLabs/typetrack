import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  pbKey, isTypingPb, isGamePb, personalBests, gameBests, calendar, timeline, frameAt, typedAt, wpmAt, gapAt,
} from "../public/js/core/gamify.js";

const require = createRequire(import.meta.url);
const E = require("../public/js/engine.js");

const DAY = 86400000;
const T0 = new Date(2026, 8, 16, 12).getTime(); // Wed 16 Sep 2026, local noon
const R = (wpm, o = {}) => Object.assign({ wpm, acc: 100, duration: 30, mode: "time", target: 30, lang: "en", ts: T0 }, o);

test("isTypingPb: beats the best of the same mode, target, language and source only", () => {
  const prior = [R(150, { ts: 1 }), R(170, { ts: 2, target: 15 }), R(160, { ts: 3, lang: "de" })];
  assert.equal(isTypingPb(prior, R(151, { ts: 9 })), true);
  assert.equal(isTypingPb(prior, R(150, { ts: 9 })), false, "a tie is not a PB");
  assert.equal(isTypingPb(prior, R(160, { ts: 9, target: 15 })), false);
  assert.equal(isTypingPb(prior, R(161, { ts: 9, lang: "de" })), true);
  assert.equal(isTypingPb(prior, R(200, { ts: 9, target: 60 })), false, "first run of a kind: nothing to beat");
  assert.equal(isTypingPb(prior, R(200, { ts: 9, source: "quotes" })), false);
  assert.notEqual(pbKey(R(1)), pbKey(R(1, { source: "quotes" })));
});

test("isTypingPb ignores the result itself when it is already in the list", () => {
  const r = R(180, { ts: 5 });
  assert.equal(isTypingPb([R(150, { ts: 1 }), r], r), true);
});

test("isGamePb: higher is better unless meta.order is asc", () => {
  const prior = [{ score: 10 }, { score: 30 }];
  assert.equal(isGamePb(prior, 31), true);
  assert.equal(isGamePb(prior, 30), false);
  assert.equal(isGamePb([], 99), false);
  const times = [{ score: 12.5, meta: { order: "asc" } }, { score: 11, meta: { order: "asc" } }];
  assert.equal(isGamePb(times, 10.9, { order: "asc" }), true);
  assert.equal(isGamePb(times, 11.5, { order: "asc" }), false);
  assert.equal(isGamePb(times, 10), true, "order from the stored entries when the new meta lacks it");
});

test("personalBests and gameBests", () => {
  const pbs = personalBests([R(150, { ts: 1 }), R(170, { ts: 2 }), R(120, { ts: 3, mode: "words", target: 25 })]);
  assert.deepEqual(pbs.map((p) => [p.label, p.r.wpm, p.count]), [["time 30", 170, 2], ["words 25", 120, 1]]);
  const gb = gameBests({ sprint: [{ score: 9, ts: 1, meta: { order: "asc" } }, { score: 7, ts: 2, meta: { order: "asc" } }], bomb: [{ score: 3, ts: 1 }, { score: 5, ts: 4 }] });
  assert.deepEqual(gb.sprint, { best: 7, plays: 2, ts: 2, asc: true });
  assert.deepEqual(gb.bomb, { best: 5, plays: 2, ts: 4, asc: false });
});

test("calendar: 26 Monday-first weeks ending this week, minutes bucketed per local day", () => {
  const rs = [R(1, { ts: T0, duration: 60 }), R(1, { ts: T0 + 3600e3, duration: 60 }), R(1, { ts: T0 - DAY, duration: 30 }), R(1, { ts: T0 - 400 * DAY })];
  const cal = calendar(rs, T0);
  assert.equal(cal.length, 26);
  assert.ok(cal.every((w) => w.length === 7));
  const last = cal[25];
  assert.equal(last[0].key, "2026-09-14", "Monday first");
  assert.equal(last[2].key, "2026-09-16");
  assert.deepEqual([last[2].seconds, last[2].tests, last[2].level], [120, 2, 4]);
  assert.deepEqual([last[1].seconds, last[1].level], [30, 1]);
  assert.equal(last[3].future, true);
  assert.equal(cal.flat().reduce((a, c) => a + c.tests, 0), 3, "a result older than the window is not counted");
});

// A real run through the engine: "the cat", with a mistake fixed by backspace.
function run() {
  const s = E.createTest({ mode: "words", ordered: true, words: ["the", "cat"], wordCount: 2, seed: 0 });
  const keys = [[0, "t"], [100, "h"], [200, "x"], [300, "\b"], [400, "e"], [500, " "], [600, "c"], [700, "a"], [800, "t"]];
  for (const [t, k] of keys) k === "\b" ? E.backspace(s, t) : k === " " ? E.space(s, t) : E.input(s, k, t);
  return Object.assign(E.results(s), { ts: T0 });
}

test("timeline: frames follow the engine; errors come from Engine.trace", () => {
  const r = run();
  const tl = timeline(E, r);
  assert.equal(tl.frames.length, 9);
  assert.equal(tl.end, 800);
  assert.deepEqual(tl.errors, [200]);
  assert.deepEqual(typedAt(tl, frameAt(tl, 250)), ["thx"]);
  assert.deepEqual(typedAt(tl, frameAt(tl, 450)), ["the"]);
  assert.deepEqual(typedAt(tl, frameAt(tl, 650)), ["the", "c"]);
  assert.equal(frameAt(tl, -1), -1);
  assert.equal(tl.frames[8].cc, 8, "the + space + cat + the words-mode finishing space, as the engine counts it");
  assert.equal(Math.round(wpmAt(tl, 800)), Math.round(r.wpm));
  assert.equal(wpmAt(tl, 100), null);
});

test("typedAt drops words after backing into a previous one", () => {
  const tl = { frames: [{ t: 0, index: 0, typed: "a" }, { t: 1, index: 1, typed: "" }, { t: 2, index: 1, typed: "b" }, { t: 3, index: 1, typed: "" }, { t: 4, index: 0, typed: "a" }] };
  assert.deepEqual(typedAt(tl, 2), ["a", "b"]);
  assert.deepEqual(typedAt(tl, 4), ["a"]);
});

test("gapAt: positive when the first run has more correct characters", () => {
  const a = { frames: [{ t: 0, cc: 1 }, { t: 100, cc: 5 }] };
  const b = { frames: [{ t: 50, cc: 2 }] };
  assert.equal(gapAt(a, b, 20), 1);
  assert.equal(gapAt(a, b, 60), -1);
  assert.equal(gapAt(a, b, 100), 3);
});
