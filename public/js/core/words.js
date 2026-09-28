// Word data: cached fetches of public/words/*.json. Every loader falls back instead of throwing, so the
// site works before the word files exist and when one is missing.

// Common English words (the v1 list, ~280), used when words/<lang>/<list>.json cannot be loaded.
export const FALLBACK = Object.freeze((
  "the of and to in a is that for it as was with be by on not he i this are or his from at " +
  "which but have an had they you were their one all we can her has there been if more when " +
  "will would who so no she other its may these than up out into some could them about time " +
  "only new like then now over such our man me even most made after also did many before must " +
  "through back years where much your way well down should because each just those people how " +
  "too little state good very make world still own see men work long get here between both " +
  "life being under never day same another know while last might us great old year off come " +
  "since against go came right used take three states himself few house use during without " +
  "again place american around however home small found mrs thought went say part once general " +
  "high upon school every don does got united left number course war until always away " +
  "something fact though water less public put think almost hand enough far took head yet " +
  "government system better set told nothing night end why called didn eyes find going look " +
  "asked later knew point next program city business give group toward young days let room " +
  "president side social given present several order national possible rather second face per " +
  "among form important often things looked early white case become large big need four within " +
  "felt along children saw best church ever least power development light thing seemed family " +
  "interest want members mind country area others turned although open god problem service"
).split(" "));

const BASE = new URL("../../words/", import.meta.url);
const cache = new Map();

function fetchJson(rel, fallback, check) {
  if (cache.has(rel)) return cache.get(rel);
  const p = (async () => {
    try {
      const res = await fetch(new URL(rel, BASE));
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      const data = await res.json();
      if (check && !check(data)) throw new Error("unexpected shape");
      return data;
    } catch (err) {
      console.warn(`[words] ${rel} unavailable (${err.message}); using fallback`);
      return typeof fallback === "function" ? fallback() : fallback;
    }
  })();
  cache.set(rel, p);
  return p;
}

const isList = (d) => Array.isArray(d) && d.length > 0;

// string[] for a word list, e.g. list('en', 'common-1k'). Falls back to the 200 English words.
export function list(lang = "en", name = "common-1k") {
  return fetchJson(`${lang}/${name}.json`, () => FALLBACK.slice(), (d) => isList(d) && d.every((w) => typeof w === "string"));
}

export function manifest() {
  return fetchJson("index.json", () => ({
    languages: [{ code: "en", name: "english", dir: "ltr", lists: ["common-200"] }],
    themes: [],
    code: [],
  }), (d) => d && Array.isArray(d.languages));
}

// [{text, source}]
export function quotes(lang = "en") {
  return fetchJson(`quotes/${lang}.json`, [], Array.isArray);
}

// string[]
export function theme(name) {
  return fetchJson(`themes/${name}.json`, [], Array.isArray);
}

// [{text}]
export function code(lang) {
  return fetchJson(`code/${lang}.json`, [], Array.isArray);
}

// [{en, word}]
export function translations(lang) {
  return fetchJson(`translate/${lang}.json`, [], Array.isArray);
}

// {title, author, paragraphs} or null. Not in the contract; additive.
export function book(id) {
  return fetchJson(`books/${id}.json`, null, (d) => d && Array.isArray(d.paragraphs));
}


// ── pure text builders (no fetch; covered by test/testmodes.test.js) ───────────────────────────────
// rand: () => [0,1). Every builder returns a fresh ordered word list for Engine (ordered: true).

// n random words from pool, no immediate repeats.
export function pick(pool, n, rand = Math.random) {
  const out = [];
  if (!pool || !pool.length) return out;
  let last = null, guard = 0;
  while (out.length < n) {
    const w = pool[Math.floor(rand() * pool.length)];
    if (w === last && pool.length > 1 && guard++ < n * 4) continue;
    out.push(w);
    last = w;
  }
  return out;
}

const cap = (w) => (w ? w[0].toLocaleUpperCase() + w.slice(1) : w);

// Punctuation: sentences of 4-12 words, capitalised starts, commas, periods (sometimes ? or !), the odd quoted
// word, colon or semicolon. Input words are left untouched; returns a new list.
export function punctuate(words, rand = Math.random) {
  const out = [];
  let left = 0;
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (left === 0) { left = 4 + Math.floor(rand() * 9); w = cap(w); }
    left--;
    const last = i === words.length - 1;
    if (left === 0 || last) {
      const r = rand();
      w += r < 0.1 ? "?" : r < 0.16 ? "!" : ".";
      left = 0;
    } else {
      const r = rand();
      if (r < 0.04) w = '"' + w + '"';
      else if (r < 0.06) w = "(" + w + ")";
      if (rand() < 0.12) w += ",";
      else if (rand() < 0.02) w += rand() < 0.5 ? ";" : ":";
    }
    out.push(w);
  }
  return out;
}

// Numbers: about 15% of the words become numbers (1-4 digits, a year, or a decimal).
export function numberize(words, rand = Math.random, rate = 0.15) {
  return words.map((w) => {
    if (rand() >= rate) return w;
    const r = rand();
    if (r < 0.2) return String(1900 + Math.floor(rand() * 130));
    if (r < 0.3) return (rand() * 100).toFixed(1 + Math.floor(rand() * 2));
    const digits = 1 + Math.floor(rand() * 4);
    return String(Math.floor(rand() * Math.pow(10, digits)));
  });
}

// Capitals: about 35% of the words capitalised, 3% all caps.
export function capitalize(words, rand = Math.random, rate = 0.35) {
  return words.map((w) => {
    const r = rand();
    if (r < 0.03 && w.length > 1) return w.toLocaleUpperCase();
    return r < rate ? cap(w) : w;
  });
}

// Mixed-language run: n words alternating a, b, a, b ... (each side random, no immediate repeats).
export function interleave(a, b, n, rand = Math.random) {
  if (!b || !b.length) return pick(a, n, rand);
  if (!a || !a.length) return pick(b, n, rand);
  const half = Math.ceil(n / 2);
  const xs = pick(a, half, rand), ys = pick(b, half, rand);
  const out = [];
  for (let i = 0; out.length < n; i++) { out.push(xs[i]); if (out.length < n) out.push(ys[i]); }
  return out;
}

// Code: split a snippet into typeable tokens plus layout. → { words, breaks, indents } where breaks[i] is true
// when a newline follows words[i] (Enter types it) and indents[i] is the indentation (in spaces, tabs = 2)
// before words[i] when it starts a line. Indentation is not typed: the caret skips it, like an editor.
export function splitCode(text) {
  const words = [], breaks = [], indents = [];
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  for (const line of lines) {
    const expanded = line.replace(/\t/g, "  ");
    const tokens = expanded.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue; // blank lines collapse
    if (words.length) breaks[words.length - 1] = true;
    const indent = expanded.length - expanded.trimStart().length;
    tokens.forEach((t, k) => { words.push(t); breaks.push(false); indents.push(k === 0 ? indent : 0); });
  }
  return { words, breaks, indents };
}

// Which list tier to use: the wanted one when the language has it, else the nearest common list.
export function tierFor(langEntry, wanted) {
  const lists = (langEntry && langEntry.lists) || [];
  if (lists.includes(wanted)) return wanted;
  return ["common-1k", "common-200", "common-10k"].find((l) => lists.includes(l)) || "common-200";
}

export const words = { list, manifest, quotes, theme, code, translations, book, FALLBACK, pick, punctuate, numberize, capitalize, interleave, splitCode, tierFor };
export default words;
