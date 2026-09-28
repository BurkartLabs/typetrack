// Memory mode: a line of words shows for a few seconds (scaled to its length), then hides; type it from
// memory. Scored on recalled words and speed. The typing surface runs hidden; we draw what you type.
import { createTyping } from "../../core/typing.js";
import { esc } from "../../core/ui.js";
import * as L from "./lib.js";
import { drillPage, loadPool, group, bindConfig, tiles, review, actions, note, save, langName } from "./shell.js";

let typing = null, timer = null;

async function mount(root, ctx) {
  const { store, settings } = ctx;
  const lang = settings.get("lang") || "en";
  const cfg = Object.assign({ words: 6 }, store.get("train.memory", {}));
  const el = drillPage(root, {
    title: "memory mode",
    sub: "read the line, hold it, type it blind. speed that sticks is the score.",
    config: group("words", [[4, "4 words"], [6, "6"], [8, "8"], [10, "10"], [12, "12"]], cfg.words),
    hint: "enter &#8212; ready early &nbsp;&middot;&nbsp; tab / esc &#8212; new line",
  });
  const { common, missing } = await loadPool(ctx.words, lang, { rare: false });
  if (!root.isConnected) return;
  if (missing) note(el, `no word list for ${esc(langName(lang))} yet, so these are english words.`);

  let phase = "show", line = [], showMs = 0;
  el.typing.classList.add("train-hidden-words");

  typing = createTyping(el.typing, {
    text: "memory", mode: "text", lang, keys: false,
    onFinish(r) {
      phase = "result";
      clearTimeout(timer);
      const t = typing.test;
      const acc = L.wordAccuracy(line, t.typed);
      const score = L.memoryScore(r.wpm, acc.pct);
      save(store, r, "memory", lang, { memory: { words: line.length, recalled: acc.correct, pct: acc.pct, score, showMs } });
      el.stage.innerHTML = "";
      el.typing.hidden = true;
      el.result.hidden = false;
      const up = acc.correct === acc.total && cfg.words < 12;
      el.result.innerHTML = tiles([["score", score], ["recalled", `${acc.correct}/${acc.total}`], ["wpm", Math.round(r.wpm)], ["acc", Math.round(r.acc) + "%"]]) +
        `<div class="err-block"><span class="label">the line</span><div class="memory-answer">${esc(line.join(" "))}</div></div>` +
        `<div class="err-block"><span class="label">what you typed</span>${review(line, t.typed)}</div>` +
        (up ? `<p class="train-foot">perfect recall. try a longer line: <button data-act="longer">${cfg.words + 2} words</button></p>` : "") +
        actions("next line");
    },
  });

  function newRound() {
    clearTimeout(timer);
    line = L.shuffle(common).slice(0, cfg.words);
    showMs = L.memoryShowMs(line.join(" "));
    phase = "show";
    el.result.hidden = true;
    el.typing.hidden = true;
    el.live.innerHTML = "";
    el.stage.innerHTML = `<div class="memory-line">${esc(line.join(" "))}</div>
      <div class="memory-bar"><i style="animation-duration:${showMs}ms"></i></div>
      <div class="train-foot">memorise &#8212; hides in ${(showMs / 1000).toFixed(1)} s</div>`;
    timer = setTimeout(startTyping, showMs);
  }

  function startTyping() {
    clearTimeout(timer);
    phase = "type";
    typing.restart({ text: line.join(" ") });
    el.stage.innerHTML = `<div class="memory-prompt">type the line</div>`;
    el.typing.hidden = false;
    renderEcho();
  }

  function renderEcho() {
    const t = typing.test;
    if (!t) return;
    const parts = [];
    for (let i = 0; i <= t.index && i < t.typed.length; i++) parts.push(esc(t.typed[i]));
    el.live.innerHTML = `<div class="echo" dir="auto">${parts.join(" ")}<span class="echo-caret"></span></div>`;
  }

  ctx.keys.set((e) => {
    if (e.key === "Tab" || e.key === "Escape") { e.preventDefault(); newRound(); return; }
    if (phase === "show") {
      if (e.key === "Enter") { e.preventDefault(); startTyping(); }
      return;
    }
    if (phase === "type") {
      typing.handleKey(e);
      if (phase === "type") renderEcho();
      else el.live.innerHTML = "";
    }
  });

  el.result.addEventListener("click", (e) => {
    if (e.target.closest("[data-act=longer]")) {
      cfg.words = Math.min(12, cfg.words + 2);
      store.set("train.memory", cfg);
      el.config.querySelectorAll("button[data-k]").forEach((b) => b.classList.toggle("active", Number(b.dataset.v) === cfg.words));
      newRound();
    } else if (e.target.closest("[data-act=next]")) newRound();
  });
  bindConfig(el.config, (k, v) => { cfg.words = Number(v); store.set("train.memory", cfg); newRound(); });
  newRound();
}

function unmount() {
  clearTimeout(timer);
  if (typing) typing.destroy();
  typing = null;
}

export default { mount, unmount };
