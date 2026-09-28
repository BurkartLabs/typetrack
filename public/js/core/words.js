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

export const words = { list, manifest, quotes, theme, code, translations, book, FALLBACK };
export default words;
