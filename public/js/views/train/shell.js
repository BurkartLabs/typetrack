// Shared page furniture for the drills: the drill page, config groups, tiles, word pools, saving.
import { esc } from "../../core/ui.js";
import { FALLBACK } from "../../core/words.js";
import { LANG_NAMES } from "./lib.js";

export function langName(code) {
  return LANG_NAMES[code] || code;
}

// words.list falls back to the English FALLBACK list when a file is missing.
export function isFallback(list) {
  return !Array.isArray(list) || !list.length ||
    (list.length === FALLBACK.length && list[0] === FALLBACK[0] && list[list.length - 1] === FALLBACK[FALLBACK.length - 1]);
}

// common-1k (+ rare) of a language, deduped. missing: the language's own list is not there.
export async function loadPool(words, lang, { rare = true } = {}) {
  const [common, rareList] = await Promise.all([
    words.list(lang, "common-1k"),
    rare ? words.list(lang, "rare") : Promise.resolve([]),
  ]);
  const missing = lang !== "en" && isFallback(common);
  const extra = isFallback(rareList) ? [] : rareList;
  return { pool: [...new Set(common.concat(missing ? [] : extra))], common, missing };
}

export function drillPage(root, { title, sub = "", config = "", hint = "tab / esc &#8212; new round" }) {
  root.innerHTML = `
    <section class="view view-train drill">
      <div class="train-head">
        <a class="back-link" href="#/train">&larr; train</a>
        <div class="train-title">${esc(title)}</div>
        <div class="train-sub" data-el="sub">${sub}</div>
      </div>
      <div class="config" data-el="config">${config}</div>
      <div class="train-note" data-el="note" hidden></div>
      <div class="train-stage" data-el="stage"></div>
      <div data-el="typing"></div>
      <div class="train-live" data-el="live"></div>
      <div class="train-result" data-el="result" hidden></div>
      <div class="hint" data-el="hint">${hint}</div>
    </section>`;
  const el = {};
  root.querySelectorAll("[data-el]").forEach((n) => { el[n.dataset.el] = n; });
  return el;
}

// A config button group: options [[value, label], ...]; value compared as a string.
export function group(key, options, current) {
  return `<div class="group">${options.map(([v, label]) =>
    `<button data-k="${esc(key)}" data-v="${esc(v)}" class="${String(v) === String(current) ? "active" : ""}">${esc(label)}</button>`).join("")}</div>`;
}
export const SEP = `<span class="sep"></span>`;

export function bindConfig(configEl, onPick) {
  configEl.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    b.blur(); // keep space from re-pressing it
    configEl.querySelectorAll(`button[data-k="${b.dataset.k}"]`).forEach((x) => x.classList.toggle("active", x === b));
    onPick(b.dataset.k, b.dataset.v, b);
  });
}

// tiles([["wpm", 142], ["acc", "99%", "small"]])
export function tiles(list) {
  return `<div class="train-tiles">${list.map(([label, value, small]) =>
    `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${value}${small ? `<small>${esc(small)}</small>` : ""}</div></div>`).join("")}</div>`;
}

// Every word of a finished run, errors marked: the reveal for blind runs.
export function review(words, typed) {
  const n = Math.min(words.length, typed.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = words[i], t = typed[i] || "";
    if (!t && i === n - 1) break;
    let html = "";
    for (let k = 0; k < Math.max(w.length, t.length); k++) {
      if (k >= w.length) html += `<span class="rv-extra">${esc(t[k])}</span>`;
      else if (k >= t.length) html += `<span class="rv-missed">${esc(w[k])}</span>`;
      else html += t[k] === w[k] ? `<span>${esc(w[k])}</span>` : `<span class="rv-bad" title="typed ${esc(t[k])}">${esc(w[k])}</span>`;
    }
    out.push(`<span class="rv-word${t === w ? "" : " rv-wrong"}">${html}</span>`);
  }
  return `<div class="review">${out.join(" ")}</div>`;
}

export function actions(label = "next round") {
  return `<div class="result-actions"><button class="icon-btn" data-act="next">&#8635; ${esc(label)} <small>(tab)</small></button></div>`;
}

export function note(el, html) {
  el.note.innerHTML = html;
  el.note.hidden = !html;
}

// Save a finished drill result: source 'train:<drill>' plus lang and any extras.
export function save(store, r, drill, lang, extra) {
  return store.addResult(Object.assign(r, { source: "train:" + drill, lang: r.lang || lang }, extra || {}));
}

// Languages a translation drill can offer (from the words manifest, English excluded) and the one to start
// with: the user's language when it isn't English, else the last one picked here.
export async function translationLangs(ctx, storeKey) {
  const man = await ctx.words.manifest();
  const codes = (man.languages || []).map((l) => l && l.code).filter((c) => c && c !== "en");
  const own = ctx.settings.get("lang");
  if (own && own !== "en" && !codes.includes(own)) codes.unshift(own);
  const dir = Object.fromEntries((man.languages || []).filter(Boolean).map((l) => [l.code, l.dir || "ltr"]));
  const last = (ctx.store.get(storeKey, {}) || {}).lang;
  const lang = own && own !== "en" ? own : codes.includes(last) ? last : codes[0] || null;
  return { codes, lang, dir };
}
