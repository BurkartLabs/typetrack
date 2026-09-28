// Pure helpers used by public/js/views/stats.js. Node has no DOM; these are exported alongside the
// view's default { mount, unmount } so they can be tested without mounting anything.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/js/engine.js");

const load = () => import("../public/js/views/stats.js");

// Types `words` correctly, `gapMs` between every keystroke (including the space after a word),
// no trailing space after the last word (the words-mode test finishes on the last correct char).
function eventsFor(words, gapMs) {
  const events = [];
  let t = 0;
  words.forEach((w, wi) => {
    for (const ch of w) { events.push([t, ch]); t += gapMs; }
    if (wi < words.length - 1) { events.push([t, " "]); t += gapMs; }
  });
  return events;
}

let tsCounter = 1700000000000;
function buildResult(words, gapMs, extra) {
  const s = E.createTest({ mode: "words", wordCount: words.length, words, ordered: true, seed: 1 });
  for (const [t, k] of eventsFor(words, gapMs)) {
    if (k === " ") E.space(s, t);
    else E.input(s, k, t);
  }
  const r = E.results(s);
  return Object.assign(r, { ts: tsCounter++ }, extra);
}

test("resultLang/resultSource fall back to en/words when missing", async () => {
  const { resultLang, resultSource } = await load();
  assert.equal(resultLang({}), "en");
  assert.equal(resultLang({ lang: "es" }), "es");
  assert.equal(resultSource({}), "words");
  assert.equal(resultSource({ source: "quotes" }), "quotes");
});

test("distinctValues collects a sorted, deduplicated set", async () => {
  const { distinctValues, resultLang } = await load();
  const rs = [{ lang: "en" }, { lang: "es" }, { lang: "en" }, {}];
  assert.deepEqual(distinctValues(rs, resultLang), ["en", "es"]);
});

test("filterByLangSource: 'all' passes everything, otherwise both facets must match, missing = default", async () => {
  const { filterByLangSource } = await load();
  const rs = [
    { lang: "en", source: "quotes" },
    { lang: "es", source: "words" },
    { lang: "en" }, // source defaults to "words"
  ];
  assert.equal(filterByLangSource(rs, "all", "all").length, 3);
  assert.equal(filterByLangSource(rs, "en", "all").length, 2);
  assert.equal(filterByLangSource(rs, "en", "words").length, 1);
  assert.equal(filterByLangSource(rs, "en", "quotes").length, 1);
});

test("hasLog/withLogs: only results with a non-empty log and words count", async () => {
  const { hasLog, withLogs } = await load();
  const withIt = buildResult(["alpha", "beta"], 100);
  const without = { ts: 1, wpm: 90, acc: 100, mode: "words", target: 2 };
  assert.equal(hasLog(withIt), true);
  assert.equal(hasLog(without), false);
  assert.equal(hasLog(null), false);
  assert.deepEqual(withLogs([withIt, without]), [withIt]);
});

test("pairWpm converts a median interval to the equivalent wpm (12000 / ms)", async () => {
  const { pairWpm } = await load();
  assert.equal(pairWpm(120), 100); // 12000 / 120 = 100
  assert.equal(pairWpm(0), 0);
});

test("mergeRhythm sums bins and weights the mean across several results; null with no logs", async () => {
  const { mergeRhythm } = await load();
  const a = buildResult(["alpha", "gamma", "delta"], 80);
  const b = buildResult(["omega", "zebra", "delta"], 120);
  const merged = mergeRhythm(E, [a, b], 10, 500);
  assert.ok(merged);
  const soloA = E.rhythm(a, 10, 500), soloB = E.rhythm(b, 10, 500);
  assert.equal(merged.count, soloA.count + soloB.count);
  merged.bins.forEach((v, i) => assert.equal(v, soloA.bins[i] + soloB.bins[i]));
  assert.equal(mergeRhythm(E, [{ ts: 1 }], 10, 500), null);
});

test("burstSummary picks the fastest clean word, the fastest window, and the mean overall speed", async () => {
  const { burstSummary } = await load();
  const a = buildResult(["alpha", "gamma", "delta"], 60);
  const b = buildResult(["omega", "zebra", "delta"], 200);
  const summary = burstSummary(E, [a, b]);
  const ba = E.burst(a), bb = E.burst(b);
  assert.equal(summary.bestWord.wpm, Math.max(ba.word.wpm, bb.word.wpm));
  assert.equal(summary.bestWindow, Math.round(Math.max(ba.window, bb.window) * 10) / 10);
  assert.equal(summary.sustained, Math.round(((ba.overall + bb.overall) / 2) * 10) / 10);
  assert.equal(burstSummary(E, [{ ts: 1 }]), null);
});

test("avgConsistency averages Engine.consistency over the last n logged results; null when none logged", async () => {
  const { avgConsistency } = await load();
  const a = buildResult(["alpha", "gamma", "delta"], 90);
  const b = buildResult(["omega", "zebra", "delta"], 90);
  const avg = avgConsistency(E, [a, b], 10);
  const expect = Math.round(((E.consistency(a) + E.consistency(b)) / 2) * 10) / 10;
  assert.equal(avg, expect);
  assert.equal(avgConsistency(E, [{ ts: 1 }], 10), null);
});

test("bestBurstWpm is 0 with no logged results and matches the fastest clean word otherwise", async () => {
  const { bestBurstWpm } = await load();
  assert.equal(bestBurstWpm(E, [{ ts: 1 }]), 0);
  const a = buildResult(["alpha", "gamma", "delta"], 60);
  assert.equal(bestBurstWpm(E, [a]), E.burst(a).word.wpm);
});

test("staminaResults keeps only results at or above the minimum duration and attaches ts + Engine.staminaDrop", async () => {
  const { staminaResults } = await load();
  const long = buildResult(["alpha", "gamma", "delta"], 60, { duration: 150 });
  const short = buildResult(["omega", "zebra", "delta"], 60, { duration: 30 });
  const rows = staminaResults(E, [long, short], 120);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ts, long.ts);
  assert.ok("drop" in rows[0] && "first" in rows[0] && "middle" in rows[0] && "last" in rows[0]);
});

test("toCsv: header plus one row per result, defaults missing lang/source, blanks consistency without a log", async () => {
  const { toCsv } = await load();
  const logged = buildResult(["alpha", "gamma"], 80, { lang: "es", source: "quotes" });
  const noLog = { ts: 5, wpm: 100, raw: 105, acc: 99, mode: "time", target: 30, duration: 30, chars: { incorrect: 1, extra: 0, missed: 0 } };
  const csv = toCsv([logged, noLog], E);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "date,lang,source,mode,target,wpm,raw,acc,consistency,errors,duration");
  assert.equal(lines.length, 3);
  assert.ok(lines[1].includes(",es,quotes,"));
  const noLogRow = lines[2].split(",");
  // date,lang,source,mode,target,wpm,raw,acc,consistency,errors,duration
  assert.equal(noLogRow[1], "en");
  assert.equal(noLogRow[2], "words");
  assert.equal(noLogRow[8], ""); // consistency blank: no log
  assert.equal(noLogRow[9], "1"); // errors summed from chars
});
