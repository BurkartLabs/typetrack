// Translation race: see the English word, type the target-language word. 60 seconds, lenient accents,
// score = correct translations. A miss shows the answer for a moment so the next one sticks.
import { createTyping } from "../../core/typing.js";
import { esc } from "../../core/ui.js";
import * as L from "./lib.js";
import { drillPage, group, bindConfig, tiles, actions, note, save, langName, translationLangs } from "./shell.js";

let typing = null;

async function mount(root, ctx) {
  const { store } = ctx;
  const KEY = "train.race";
  const { codes, lang: first, dir } = await translationLangs(ctx, KEY);
  let lang = first;
  const el = drillPage(root, {
    title: "translation race",
    sub: "english on top, you type it in the other language. 60 seconds. accents are lenient: e counts for é.",
    config: codes.length ? group("lang", codes.map((c) => [c, langName(c)]), lang) : "",
    hint: "space &#8212; submit &nbsp;&middot;&nbsp; tab / esc &#8212; restart",
  });
  if (!root.isConnected) return;
  el.typing.classList.add("train-hidden-words", "race-typing");

  let list = [], byWord = new Map(), last = null;
  const best = () => (store.get(KEY, {}) || {}).best || {};

  function render() {
    const t = typing && typing.test;
    if (!t) return;
    const w = t.words[t.index];
    const score = L.raceScore(t.words, t.typed, t.index, false);
    const fb = last ? (last.ok ? `<span class="race-ok">&#10003; ${esc(last.word)}</span>`
      : `<span class="race-bad">&#10007; ${(last.typed ? esc(last.typed) : "&#8212;")}</span> &rarr; <b>${esc(last.word)}</b> <small>${esc(last.en)}</small>`) : "&nbsp;";
    const rtl = dir[lang] === "rtl" ? "rtl" : "auto";
    el.stage.innerHTML = `
      <div class="race">
        <div class="race-score"><span class="label">correct</span> <b>${score}</b>${best()[lang] ? ` <small>best ${best()[lang]}</small>` : ""}</div>
        <div class="race-en">${esc(byWord.get(w) || "")}</div>
        <div class="echo race-echo" dir="${rtl}">${esc(t.typed[t.index] || "")}<span class="echo-caret"></span></div>
        <div class="race-fb">${fb}</div>
      </div>`;
  }

  function opts() {
    return { words: L.shuffle(list).map((e) => e.word), mode: "time", duration: 60, ordered: true, lang, accents: "lenient" };
  }
  function newRound() {
    last = null;
    el.result.hidden = true;
    el.typing.hidden = false;
    typing.restart(opts());
    render();
  }

  async function start() {
    if (typing) { typing.destroy(); typing = null; }
    el.stage.innerHTML = "";
    el.result.hidden = true;
    el.typing.hidden = false;
    if (!lang) { note(el, "the race needs a second language, and no word data for one is available yet."); return; }
    const raw = await ctx.words.translations(lang);
    if (!root.isConnected) return;
    list = L.cleanTranslations(raw, lang, true);
    if (list.length < 10) {
      note(el, `no translations for ${esc(langName(lang))} yet${codes.length > 1 ? "; try another language above" : ""}.`);
      return;
    }
    note(el, "");
    byWord = new Map();
    list.forEach((e) => { if (!byWord.has(e.word)) byWord.set(e.word, e.en); });
    typing = createTyping(el.typing, Object.assign(opts(), {
      keys: false,
      onRestart: newRound,
      onFinish(r) {
        const t = typing.test;
        const score = L.raceScore(t.words, t.typed, t.index, false);
        const b = best();
        const pb = score > (b[lang] || 0);
        if (pb) store.set(KEY, { lang, best: Object.assign({}, b, { [lang]: score }) });
        save(store, r, "translate", lang, { score });
        const missed = [];
        for (let i = 0; i < t.index; i++) if (t.typed[i] !== t.words[i]) missed.push(t.words[i]);
        el.stage.innerHTML = "";
        el.typing.hidden = true;
        el.result.hidden = false;
        el.result.innerHTML = tiles([["correct", score, pb ? "new best" : ""], ["tried", t.index], ["wpm", Math.round(r.wpm)], ["acc", Math.round(r.acc) + "%"]]) +
          (missed.length ? `<div class="err-block"><span class="label">missed</span><div class="chips">${
            [...new Set(missed)].map((w) => `<span class="chip">${esc(byWord.get(w) || "")} &rarr; ${esc(w)}</span>`).join("")}</div></div>` : "") +
          actions("race again");
      },
    }));
    render();
  }

  ctx.keys.set((e) => {
    if (!typing) return;
    const t = typing.test, before = t ? t.index : 0;
    typing.handleKey(e);
    const now = typing.test;
    if (now && now.index > before && !typing.finished) {
      const w = now.words[before], typed = now.typed[before];
      last = { ok: typed === w, word: w, typed, en: byWord.get(w) || "" };
    }
    if (!typing.finished) render();
  });
  el.result.addEventListener("click", (e) => { if (e.target.closest("[data-act=next]")) newRound(); });
  bindConfig(el.config, (k, v) => {
    lang = v;
    store.set(KEY, Object.assign({}, store.get(KEY, {}), { lang }));
    start();
  });
  await start();
}

function unmount() {
  if (typing) typing.destroy();
  typing = null;
}

export default { mount, unmount };
