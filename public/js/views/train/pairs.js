// Pair drills: words heavy in your slowest letter pairs (or ?pairs=th,ck), with per-pair medians
// before (all your history) and after (this round).
import { createTyping } from "../../core/typing.js";
import { esc } from "../../core/ui.js";
import * as L from "./lib.js";
import { drillPage, loadPool, group, SEP, bindConfig, tiles, actions, note, save, langName } from "./shell.js";

let typing = null;

function fmtMs(x) {
  return x == null ? "&#8212;" : Math.round(x) + "<small>ms</small>";
}

async function mount(root, ctx) {
  const E = window.Engine;
  const { store, settings } = ctx;
  const lang = settings.get("lang") || "en";
  const cfg = Object.assign({ count: 30 }, store.get("train.pairs", {}));
  const history = () => store.results().filter((r) => (r.lang || "en") === lang);

  const chosen = L.parsePairs(ctx.query.pairs);
  let targets = chosen.length ? chosen : L.slowestPairs(E, history(), 5);
  const origin = chosen.length ? "chosen" : targets.length ? "slowest" : "default";
  if (!targets.length) targets = L.FALLBACK_PAIRS.slice();

  const el = drillPage(root, {
    title: "pair drills",
    config: group("count", [[20, "20"], [30, "30"], [50, "50"]], cfg.count) + SEP +
      `<form class="pair-form" data-el="form"><input class="train-input" name="pairs" value="${esc(targets.join(", "))}"
        aria-label="pairs to drill" spellcheck="false" autocomplete="off"><button type="submit">drill</button></form>` +
      (origin !== "slowest" ? `${SEP}<button data-act="slowest">my slowest</button>` : ""),
  });

  const { pool, missing } = await loadPool(ctx.words, lang);
  if (!root.isConnected) return;
  if (missing) note(el, `no word list for ${esc(langName(lang))} yet, so these are english words.`);
  else if (origin === "default") note(el, `not enough typing yet to find your slowest pairs (each needs 5 clean samples). drilling common awkward pairs; take a few tests and come back.`);

  let before = L.pairMedians(E, history(), targets);
  function renderSub() {
    el.sub.innerHTML = (origin === "chosen" ? "your pairs: " : origin === "slowest" ? "your slowest pairs: " : "pairs: ") +
      targets.map((p) => `<span class="pair-chip">${esc(p)} <small>${before[p] == null ? "new" : Math.round(before[p]) + "ms"}</small></span>`).join(" ");
  }
  renderSub();

  const words = () => E.pairDrillWords(pool, targets, cfg.count);
  function newRound() {
    el.result.hidden = true;
    el.typing.hidden = false;
    typing.restart({ words: words(), wordCount: cfg.count });
  }

  typing = createTyping(el.typing, {
    words: words(), mode: "words", ordered: true, wordCount: cfg.count, lang,
    onRestart: newRound,
    onFinish(r) {
      const after = L.pairMedians(E, [r], targets);
      save(store, r, "pairs", lang, { targets });
      const rows = L.pairComparison(before, after, targets);
      el.typing.hidden = true;
      el.result.hidden = false;
      el.result.innerHTML = tiles([["wpm", Math.round(r.wpm)], ["acc", Math.round(r.acc) + "%"], ["pairs", targets.length]]) +
        `<table class="recent pair-table"><thead><tr><th>pair</th><th class="num">before</th><th class="num">this round</th><th class="num">change</th></tr></thead><tbody>` +
        rows.map((x) => `<tr><td><b>${esc(x.pair)}</b></td><td class="num">${fmtMs(x.before)}</td><td class="num">${fmtMs(x.after)}</td>` +
          `<td class="num ${x.delta == null ? "" : x.delta <= 0 ? "faster" : "slower"}">${x.delta == null ? "&#8212;" : (x.delta > 0 ? "+" : "") + Math.round(x.delta) + "ms"}</td></tr>`).join("") +
        `</tbody></table><p class="train-foot">median gap between the two keys, clean keystrokes only. before = all your ${esc(langName(lang))} history.</p>` +
        actions();
      before = L.pairMedians(E, history(), targets);
      renderSub();
    },
  });

  el.result.addEventListener("click", (e) => { if (e.target.closest("[data-act=next]")) newRound(); });
  bindConfig(el.config, (k, v) => {
    if (k === "count") { cfg.count = Number(v); store.set("train.pairs", cfg); newRound(); }
  });
  el.config.addEventListener("click", (e) => {
    if (e.target.closest("[data-act=slowest]")) ctx.navigate("#/train/pairs");
  });
  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ps = L.parsePairs(el.form.elements.pairs.value);
    if (ps.length) ctx.navigate("#/train/pairs?pairs=" + encodeURIComponent(ps.join(",")));
  });
}

function unmount() {
  if (typing) typing.destroy();
  typing = null;
}

export default { mount, unmount };
