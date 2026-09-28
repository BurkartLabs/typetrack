// Vocabulary mode: target-language words with their English translation underneath; type the word.
// The typing surface runs hidden (keys:false) and we draw word cards from its state.
import { createTyping } from "../../core/typing.js";
import { esc } from "../../core/ui.js";
import * as L from "./lib.js";
import { drillPage, group, SEP, bindConfig, tiles, actions, note, save, langName, translationLangs } from "./shell.js";

let typing = null;

function letters(word, typed, current) {
  let html = "";
  for (let k = 0; k < word.length; k++) {
    const cls = k < typed.length ? (typed[k] === word[k] ? "ok" : "bad") : current && k === typed.length ? "next" : "";
    html += `<span class="${cls}">${esc(word[k])}</span>`;
  }
  for (let k = word.length; k < typed.length; k++) html += `<span class="extra">${esc(typed[k])}</span>`;
  return html;
}

async function mount(root, ctx) {
  const { store } = ctx;
  const KEY = "train.vocab";
  const cfg = Object.assign({ count: 20 }, store.get(KEY, {}));
  const { codes, lang: first, dir } = await translationLangs(ctx, KEY);
  let lang = first;
  const el = drillPage(root, {
    title: "vocabulary",
    sub: "the word, its meaning underneath. type the word; learn it on the way.",
    config: (codes.length ? group("lang", codes.map((c) => [c, langName(c)]), lang) + SEP : "") +
      group("count", [[10, "10"], [20, "20"], [40, "40"]], cfg.count),
  });
  if (!root.isConnected) return;
  el.typing.classList.add("train-hidden-words");

  let list = [];
  const byWord = new Map();

  function render() {
    const t = typing && typing.test;
    if (!t) return;
    const from = Math.max(0, t.index - 1), to = Math.min(t.words.length, t.index + 4);
    let html = "";
    for (let i = from; i < to; i++) {
      const w = t.words[i], typed = t.typed[i] || "";
      const state = i < t.index ? (typed === w ? "done" : "missed") : i === t.index ? "current" : "ahead";
      html += `<div class="vcard ${state}"><div class="vword" dir="auto">${letters(w, typed, i === t.index)}</div>` +
        `<div class="vtrans">${esc(byWord.get(w) || "")}</div></div>`;
    }
    el.stage.innerHTML = `<div class="vcards" dir="${dir[lang] === "rtl" ? "rtl" : "ltr"}">${html}</div>`;
  }

  function opts() {
    return { words: L.shuffle(list).slice(0, cfg.count).map((e) => e.word), mode: "words", ordered: true, wordCount: cfg.count, lang };
  }
  function newRound() {
    el.result.hidden = true;
    typing.restart(opts());
    render();
  }

  async function start() {
    if (typing) { typing.destroy(); typing = null; }
    el.stage.innerHTML = "";
    el.result.hidden = true;
    if (!lang) { note(el, "vocabulary needs a second language, and no word data for one is available yet."); return; }
    const raw = await ctx.words.translations(lang);
    if (!root.isConnected) return;
    list = L.cleanTranslations(raw, lang);
    if (list.length < 5) {
      note(el, `no translations for ${esc(langName(lang))} yet${codes.length > 1 ? "; try another language above" : ""}.`);
      return;
    }
    note(el, "");
    byWord.clear();
    list.forEach((e) => { if (!byWord.has(e.word)) byWord.set(e.word, e.en); });
    typing = createTyping(el.typing, Object.assign(opts(), {
      keys: false,
      onRestart: newRound,
      onFinish(r) {
        const t = typing.test;
        const missed = t.words.filter((w, i) => (t.typed[i] || "") !== w);
        save(store, r, "vocab", lang);
        el.stage.innerHTML = "";
        el.result.hidden = false;
        el.result.innerHTML = tiles([["wpm", Math.round(r.wpm)], ["acc", Math.round(r.acc) + "%"], ["words", `${t.words.length - missed.length}/${t.words.length}`]]) +
          (missed.length ? `<div class="err-block"><span class="label">to look at again</span><div class="chips">${
            missed.map((w) => `<span class="chip">${esc(w)} <small>${esc(byWord.get(w) || "")}</small></span>`).join("")}</div></div>` : "") +
          actions();
      },
    }));
    render();
  }

  ctx.keys.set((e) => {
    if (!typing) return;
    typing.handleKey(e);
    if (!typing.finished) render();
  });
  el.result.addEventListener("click", (e) => { if (e.target.closest("[data-act=next]")) newRound(); });
  bindConfig(el.config, (k, v) => {
    if (k === "lang") lang = v; else cfg.count = Number(v);
    store.set(KEY, Object.assign(cfg, { lang }));
    start();
  });
  await start();
}

function unmount() {
  if (typing) typing.destroy();
  typing = null;
}

export default { mount, unmount };
