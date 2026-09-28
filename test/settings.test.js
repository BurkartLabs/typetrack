const test = require("node:test");
const assert = require("node:assert/strict");

const load = (p) => import("../public/js/" + p);

test("layout: charFor remaps letter/punctuation codes per layout, leaves qwerty alone", async () => {
  const { charFor } = await load("core/layout.js");
  assert.equal(charFor("qwerty", "KeyQ", false), null); // hardware: no map, no remap needed
  assert.equal(charFor("dvorak", "KeyQ", false), "'");
  assert.equal(charFor("dvorak", "Semicolon", false), "s");
  assert.equal(charFor("colemak", "KeyS", false), "r");
  assert.equal(charFor("colemak-dh", "KeyD", false), "s");
  assert.equal(charFor("workman", "KeyD", false), "h");
  assert.equal(charFor("azerty", "KeyQ", false), "a");
  assert.equal(charFor("azerty", "KeyA", false), "q");
  assert.equal(charFor("qwertz", "KeyY", false), "z");
  assert.equal(charFor("qwertz", "KeyZ", false), "y");
  assert.equal(charFor("nope", "KeyQ", false), null);
});

test("layout: shiftChar upper-cases letters and maps punctuation shifts", async () => {
  const { shiftChar } = await load("core/layout.js");
  assert.equal(shiftChar("a"), "A");
  assert.equal(shiftChar(","), "<");
  assert.equal(shiftChar(";"), ":");
  assert.equal(shiftChar("1"), "1"); // no shift mapping defined -> unchanged
});

test("layout: charFor applies shift via shiftChar", async () => {
  const { charFor } = await load("core/layout.js");
  assert.equal(charFor("dvorak", "KeyA", true), "A");
  assert.equal(charFor("dvorak", "Comma", true), "W"); // dvorak puts "w" on the Comma key; shifted -> "W"
});

test("layout: remap() returns the same event for qwerty or an unmapped code", async () => {
  const { remap } = await load("core/layout.js");
  const e = { code: "KeyQ", key: "q", shiftKey: false };
  assert.equal(remap(e, "qwerty"), e);
  assert.equal(remap(e, "made-up-layout"), e);
  const arrow = { code: "ArrowUp", key: "ArrowUp", shiftKey: false };
  assert.equal(remap(arrow, "dvorak"), arrow);
});

test("layout: remap() wraps the event, overriding only `key`", async () => {
  const { remap } = await load("core/layout.js");
  let prevented = false;
  const e = { code: "KeyQ", key: "q", shiftKey: false, repeat: true, preventDefault() { prevented = true; } };
  const wrapped = remap(e, "dvorak");
  assert.notEqual(wrapped, e);
  assert.equal(wrapped.key, "'");
  assert.equal(wrapped.code, "KeyQ");
  assert.equal(wrapped.repeat, true);
  wrapped.preventDefault();
  assert.equal(prevented, true);
});

test("layout: keyboardRows covers number + three letter rows and reflects the chosen layout", async () => {
  const { keyboardRows } = await load("core/layout.js");
  const rows = keyboardRows("dvorak");
  assert.equal(rows.length, 4);
  assert.equal(rows[0].length, 10); // number row
  const topCodes = rows[1].map((k) => k.code);
  assert.ok(topCodes.includes("KeyQ"));
  const qKey = rows[1].find((k) => k.code === "KeyQ");
  assert.equal(qKey.label, "'");
  const qwertyRows = keyboardRows("qwerty");
  const qwertyQ = qwertyRows[1].find((k) => k.code === "KeyQ");
  assert.equal(qwertyQ.label, "q");
});

test("theme: isValidColor accepts 3/6-digit hex only", async () => {
  const { isValidColor } = await load("core/theme.js");
  assert.ok(isValidColor("#fff"));
  assert.ok(isValidColor("#a1b2c3"));
  assert.ok(!isValidColor("red"));
  assert.ok(!isValidColor("#12345"));
  assert.ok(!isValidColor(null));
});

test("theme: sanitizeVars keeps only known vars with valid colours", async () => {
  const { sanitizeVars, VARS } = await load("core/theme.js");
  const out = sanitizeVars({ "--main": "#FF0000", "--bg": "not-a-color", "--nope": "#123456", "--text": "#abc" });
  assert.deepEqual(Object.keys(out).sort(), ["--main", "--text"]);
  assert.equal(out["--main"], "#ff0000"); // lower-cased
  assert.equal(VARS.length, 8);
});

test("theme: resolve() merges preset base with sanitized overrides and falls back safely", async () => {
  const { resolve, PRESETS, DEFAULT_PRESET } = await load("core/theme.js");
  const r1 = resolve(null);
  assert.equal(r1.preset, DEFAULT_PRESET);
  assert.deepEqual(r1.vars, PRESETS[DEFAULT_PRESET]);
  assert.equal(r1.font, "JetBrains Mono");

  const r2 = resolve({ preset: "ember", vars: { "--main": "#123abc", "--evil": "javascript:1" }, font: "Roboto Mono" });
  assert.equal(r2.preset, "ember");
  assert.equal(r2.vars["--main"], "#123abc");
  assert.equal(r2.vars["--bg"], PRESETS.ember["--bg"]); // untouched vars keep the preset's value
  assert.equal(r2.vars["--evil"], undefined);
  assert.equal(r2.font, "Roboto Mono");

  const r3 = resolve({ preset: "not-a-preset" });
  assert.equal(r3.preset, DEFAULT_PRESET);
});

test("theme: every preset defines all eight vars as valid colours", async () => {
  const { PRESETS, VARS, isValidColor } = await load("core/theme.js");
  for (const [name, vars] of Object.entries(PRESETS)) {
    for (const k of VARS) assert.ok(isValidColor(vars[k]), `${name}.${k} should be a valid colour`);
  }
});

test("tools: buildCsv writes the header and one row per result, quoting commas", async () => {
  const { buildCsv, CSV_COLUMNS } = await load("views/tools.js");
  const results = [
    { ts: Date.UTC(2026, 0, 1), lang: "en", source: "test, quick", mode: "time", target: 30, wpm: 95.4, raw: 98, acc: 97, duration: 30 },
  ];
  const csv = buildCsv(results);
  const lines = csv.split("\n");
  assert.equal(lines[0], CSV_COLUMNS.join(","));
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('"test, quick"'));
  assert.ok(lines[1].startsWith(new Date(results[0].ts).toISOString()));
});

test("tools: buildCsv handles an empty list and missing fields", async () => {
  const { buildCsv } = await load("views/tools.js");
  assert.equal(buildCsv([]).split("\n").length, 1);
  const csv = buildCsv([{ mode: "time" }]);
  assert.equal(csv.split("\n")[1], ",,,time,,,,,");
});

test("tools: percentile picks a value from the sorted array, clamped at the ends", async () => {
  const { percentile } = await load("views/tools.js");
  const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(arr, 0), 1);
  assert.equal(percentile(arr, 0.5), 6);
  assert.equal(percentile(arr, 0.95), 10);
  assert.equal(percentile([], 0.5), 0);
});
