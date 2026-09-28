const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../public/js/core/words.js");
const Engine = require("../public/js/engine.js");

// deterministic rand for the builders
const seq = (seed = 7) => Engine.mulberry32(seed);
const WORDS = "the of and to in a is that for it as was with be by on not he this are".split(" ");

test("pick: n words from the pool, no immediate repeats", async () => {
  const { pick } = await load();
  const out = pick(WORDS, 300, seq());
  assert.equal(out.length, 300);
  assert.ok(out.every((w) => WORDS.includes(w)));
  for (let i = 1; i < out.length; i++) assert.notEqual(out[i], out[i - 1]);
  assert.deepEqual(pick([], 5, seq()), []);
});

test("punctuate: capitalised starts, ends in . ? or !, keeps the word count and the letters", async () => {
  const { punctuate } = await load();
  const src = Array.from({ length: 200 }, (_, i) => WORDS[i % WORDS.length]);
  const out = punctuate(src, seq(3));
  assert.equal(out.length, src.length);
  assert.match(out[0], /^["(]?[A-Z]/);
  assert.match(out[out.length - 1], /[.?!]$/);
  // every word after a sentence end is capitalised
  for (let i = 1; i < out.length; i++) if (/[.?!]$/.test(out[i - 1])) assert.match(out[i], /^["(]?[A-Z]/, out[i]);
  // strip punctuation and case: the words are unchanged
  out.forEach((w, i) => assert.equal(w.replace(/[^a-z]/gi, "").toLowerCase(), src[i]));
  assert.ok(out.some((w) => w.endsWith(",")), "has commas");
  assert.ok(out.filter((w) => /[.?!]$/.test(w)).length >= 200 / 13, "has sentence ends");
});

test("numberize: some words become numbers, the rest are untouched", async () => {
  const { numberize } = await load();
  const src = Array.from({ length: 400 }, (_, i) => WORDS[i % WORDS.length]);
  const out = numberize(src, seq(5));
  assert.equal(out.length, src.length);
  const nums = out.filter((w) => /^\d+(\.\d+)?$/.test(w));
  assert.ok(nums.length > 20 && nums.length < 120, "about 15%: " + nums.length);
  out.forEach((w, i) => { if (!/^\d/.test(w)) assert.equal(w, src[i]); });
});

test("capitalize: a share of words capitalised, letters preserved", async () => {
  const { capitalize } = await load();
  const src = Array.from({ length: 400 }, (_, i) => WORDS[i % WORDS.length]);
  const out = capitalize(src, seq(9));
  const caps = out.filter((w) => /^[A-Z]/.test(w)).length;
  assert.ok(caps > 80 && caps < 220, "about 35%: " + caps);
  out.forEach((w, i) => assert.equal(w.toLowerCase(), src[i]));
  assert.equal(capitalize(["élan"], () => 0.1)[0], "Élan");
});

test("interleave: alternates the two languages word by word", async () => {
  const { interleave } = await load();
  const a = ["one", "two", "three"], b = ["uno", "dos", "tres"];
  const out = interleave(a, b, 51, seq(11));
  assert.equal(out.length, 51);
  out.forEach((w, i) => assert.ok((i % 2 === 0 ? a : b).includes(w), `${i}: ${w}`));
  assert.equal(interleave(a, [], 4, seq()).every((w) => a.includes(w)), true);
  assert.equal(interleave([], b, 4, seq()).every((w) => b.includes(w)), true);
});

test("splitCode: tokens, line breaks after the last token of a line, indentation per line start", async () => {
  const { splitCode } = await load();
  const src = "function isEven(n) {\n  return n % 2 === 0;\n\n}\r\n\tx();";
  const { words, breaks, indents } = splitCode(src);
  assert.deepEqual(words, ["function", "isEven(n)", "{", "return", "n", "%", "2", "===", "0;", "}", "x();"]);
  assert.deepEqual(breaks.map((b, i) => (b ? i : -1)).filter((i) => i >= 0), [2, 8, 9]);
  assert.equal(breaks.length, words.length);
  assert.equal(indents[3], 2); // "return" is indented two spaces
  assert.equal(indents[4], 0); // mid-line token
  assert.equal(indents[10], 2); // a tab counts as two spaces
  assert.equal(indents[9], 0);
  assert.deepEqual(splitCode("").words, []);
  // the engine accepts the tokens as an ordered text
  const t = Engine.createTest({ mode: "text", words, ordered: true });
  assert.equal(t.words.length, words.length);
});

test("tierFor: wanted tier when present, else the nearest common list", async () => {
  const { tierFor } = await load();
  assert.equal(tierFor({ lists: ["common-200", "common-1k", "common-10k"] }, "common-10k"), "common-10k");
  assert.equal(tierFor({ lists: ["common-200", "common-1k", "rare"] }, "common-10k"), "common-1k");
  assert.equal(tierFor({ lists: ["common-200"] }, "common-1k"), "common-200");
  assert.equal(tierFor(null, "common-1k"), "common-200");
});
