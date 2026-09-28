// Regenerates public/words/index.json from the files present. Run after adding word data:
//   node scripts/build-words-index.mjs
import { readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "words");
const NAMES = {
  en: "english", es: "español", fr: "français", de: "deutsch", pt: "português", it: "italiano", nl: "nederlands",
  pl: "polski", ru: "русский", uk: "українська", el: "ελληνικά", ar: "العربية", he: "עברית",
  ja: "japanese (romaji)", zh: "chinese (pinyin)", ko: "korean (romanised)",
};
const RTL = new Set(["ar", "he"]);
const SPECIAL = new Set(["quotes", "themes", "code", "translate", "books"]);
const stem = (f) => f.replace(/\.json$/, "");
const jsonIn = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).map(stem).sort() : []);

const languages = readdirSync(root)
  .filter((d) => !SPECIAL.has(d) && statSync(join(root, d)).isDirectory())
  .sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b)))
  .map((code) => ({
    code,
    name: NAMES[code] || code,
    dir: RTL.has(code) ? "rtl" : "ltr",
    lists: jsonIn(join(root, code)),
    quotes: existsSync(join(root, "quotes", code + ".json")),
    translate: existsSync(join(root, "translate", code + ".json")),
  }));

const index = { languages, themes: jsonIn(join(root, "themes")), code: jsonIn(join(root, "code")), books: jsonIn(join(root, "books")) };
writeFileSync(join(root, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`index.json: ${languages.length} languages, ${index.themes.length} themes, ${index.code.length} code packs, ${index.books.length} books`);
