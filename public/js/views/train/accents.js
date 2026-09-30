// Accent drills: words heavy in the language's accented letters (strict accents: é is not e), with a
// small keyboard hint for the next accented character on your layout (native or US-International).
import { createTyping } from "../../core/typing.js";
import { esc } from "../../core/ui.js";
import * as L from "./lib.js";
import { drillPage, loadPool, group, SEP, bindConfig, tiles, review, actions, note, save, langName } from "./shell.js";

let typing = null;

const CAP = { shift: "shift", altgr: "altgr" };
function keycaps(steps) {
  return steps.map((keys) => keys.map((k) => `<kbd class="${CAP[k] ? "mod" : ""}">${esc(k)}</kbd>`).join("<i>+</i>"))
    .join(`<span class="then">then</span>`);
}

async function mount(root, ctx) {
  const E = window.Engine;
  const { store, settings } = ctx;
  const saved = Object.assign({ layout: "native", count: 30 }, store.get("train.accents", {}));
  const own = settings.get("lang");
  const langs = Object.keys(L.ACCENTS);
  let lang = langs.includes(own) ? own : langs.includes(saved.lang) ? saved.lang : null;
  const cfg = saved;

  const el = drillPage(root, {
    title: "accent drills",
    sub: "words full of the letters your layout makes awkward. strict accents: e does not count for é.",
    config: group("lang", langs.map((c) => [c, langName(c)]), lang) + SEP +
      group("layout", [["native", "native layout"], ["us-intl", "us-international"]], cfg.layout) + SEP +
      group("count", [[20, "20"], [30, "30"], [50, "50"]], cfg.count),
  });
  el.live.innerHTML = `<div class="layout-hint" data-el="hintBox" hidden></div>`;
  const hintBox = el.live.firstElementChild;

  let pool = [], chars = [];
  async function load() {
    note(el, "");
    if (!lang) {
      note(el, `${esc(langName(own))} has no accented letters. pick a language above to drill its accents.`);
      el.typing.hidden = true;
      return false;
    }
    const p = await loadPool(ctx.words, lang);
    if (!root.isConnected) return false;
    if (p.missing) {
      note(el, `the ${esc(langName(lang))} word list isn't available yet. try another language.`);
      el.typing.hidden = true;
      hintBox.hidden = true;
      return false;
    }
    pool = p.pool;
    chars = L.accentChars(lang);
    el.sub.innerHTML = `${esc(langName(lang))}: ${chars.map((c) => `<span class="pair-chip">${esc(c)}</span>`).join(" ")}`;
    return true;
  }

  function opts() {
    return { words: E.keyDrillWords(pool, chars, cfg.count), mode: "words", ordered: true, wordCount: cfg.count, lang, accents: "strict" };
  }

  function renderHint() {
    const t = typing && typing.test;
    if (!t || typing.finished) { hintBox.hidden = true; return; }
    const nx = L.nextAccent(t.words, t.index, (t.typed[t.index] || "").length, chars);
    const steps = nx && L.layoutHint(nx.ch, cfg.layout, lang);
    hintBox.hidden = false;
    const layoutName = cfg.layout === "native" ? (L.LAYOUT_NAMES[lang] || "your layout") : "us-international";
    hintBox.innerHTML = !nx ? `<span class="label">next accent</span> <span class="hint-none">none in the next words</span>`
      : `<span class="label">next: <b class="hint-ch">${esc(nx.ch)}</b> on ${esc(layoutName)}</span>` +
        (steps ? `<span class="keys">${keycaps(steps)}</span>` : `<span class="hint-none">not on this layout; try us-international</span>`);
  }

  function newRound() {
    el.result.hidden = true;
    el.typing.hidden = false;
    typing.restart(opts());
    renderHint();
  }

  async function start() {
    if (typing) { typing.destroy(); typing = null; }
    if (!(await load())) return;
    el.typing.hidden = false;
    typing = createTyping(el.typing, Object.assign(opts(), {
      keys: false,
      onRestart: newRound,
      onFinish(r) {
        save(store, r, "accents", lang, { accentChars: chars.join("") });
        const t = typing.test;
        hintBox.hidden = true;
        el.typing.hidden = true;
        el.result.hidden = false;
        const miss = chars.map((c) => ({ c, hit: r.errors.keyHits[c] || 0, miss: r.errors.keyMiss[c] || 0 })).filter((x) => x.hit);
        el.result.innerHTML = tiles([["wpm", Math.round(r.wpm)], ["acc", Math.round(r.acc) + "%"],
          ["accents typed", miss.reduce((a, x) => a + x.hit, 0)], ["accents missed", miss.reduce((a, x) => a + x.miss, 0)]]) +
          (miss.length ? `<div class="err-block"><span class="label">per letter (missed / typed)</span><div class="chips">${
            miss.map((x) => `<span class="chip key-chip" style="--heat:${x.miss ? 1 : 0.2}"><b>${esc(x.c)}</b><small>${x.miss}/${x.hit}</small></span>`).join("")}</div></div>` : "") +
          `<div class="err-block"><span class="label">your run</span>${review(t.words, t.typed)}</div>` + actions();
      },
    }));
    renderHint();
  }

  ctx.keys.set((e) => {
    if (!typing) return;
    typing.handleKey(e);
    renderHint();
  });
  el.result.addEventListener("click", (e) => { if (e.target.closest("[data-act=next]")) newRound(); });
  bindConfig(el.config, (k, v) => {
    if (k === "lang") { lang = v; cfg.lang = v; }
    else cfg[k] = /^\d+$/.test(v) ? Number(v) : v;
    store.set("train.accents", cfg);
    if (k === "layout" && typing) renderHint();
    else start();
  });
  await start();
}

function unmount() {
  if (typing) typing.destroy();
  typing = null;
}

export default { mount, unmount };
