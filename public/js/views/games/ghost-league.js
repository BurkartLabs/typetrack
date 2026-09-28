// Ghost league: race up to ten of your own runs at once. Each ghost is drawn at the character position its
// recorded run had reached at the same moment (the runs had different words, so position, not word, is what
// maps across). Your caret is the crimson one; the end screen gives your placing.
import { createTyping } from "../../core/typing.js";
import { esc, shortDate } from "../../core/ui.js";
import {
  Eng, charPos, placeAt, progressSeries, posAt, leaguePlacing, hasLog, modeOf, pbProgression,
  commonWords, loadPack3Css, bestScore, endPanel,
} from "./pack3-kit.js";

const ID = "ghost-league";
const SIZE = 10;

// ── pure ──────────────────────────────────────────────────────────────────
// Up to `n` ghosts for a mode key: kind 'pb' = the last n runs that raised your best, 'top' = your n best runs.
export function leagueGhosts(results, key, kind = "pb", n = SIZE) {
  if (kind === "top") {
    return results.filter((r) => hasLog(r) && modeOf(r) === key).sort((a, b) => b.wpm - a.wpm || a.ts - b.ts).slice(0, n);
  }
  return pbProgression(results, key).slice(-n);
}

// Mode keys with at least one raceable run, most runs first.
export function leagueModes(results) {
  const count = new Map();
  for (const r of results) if (hasLog(r)) count.set(modeOf(r), (count.get(modeOf(r)) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, n }));
}

// Final standings, best first: [{name, wpm, me}]
export function standings(myWpm, ghosts) {
  const rows = ghosts.map((g) => ({ name: g.label, wpm: g.wpm, me: false }));
  rows.push({ name: "you", wpm: myWpm, me: true });
  return rows.sort((a, b) => b.wpm - a.wpm || (a.me ? 1 : b.me ? -1 : 0));
}

// ── view ──────────────────────────────────────────────────────────────────
let alive = false, typing = null, timer = null, removeKeys = null;

function stop() {
  clearInterval(timer); timer = null;
  if (typing) { typing.destroy(); typing = null; }
  if (removeKeys) { removeKeys(); removeKeys = null; }
}

async function mount(root, ctx) {
  alive = true;
  await loadPack3Css();
  const { store, settings, keys } = ctx;
  root.innerHTML = `<section class="p3 p3-ghost-league">
    <div class="p3-head"><div><div class="p3-title">ghost league</div>
    <div class="p3-sub">ten of your own runs at once. you are the crimson caret.</div></div></div>
    <div class="p3-body"></div></section>`;
  const body = root.querySelector(".p3-body");
  const modes = leagueModes(store.results());
  let key = modes.length ? modes[0].key : null, kind = "pb";

  function setKeys(fn) { if (removeKeys) removeKeys(); removeKeys = keys.set(fn); }

  function showStart() {
    stop();
    if (!key) {
      body.innerHTML = `<div class="p3-note">no runs with a keystroke log yet. finish a few tests on the <a href="#/test">test page</a>; each one becomes a ghost.</div>`;
      return;
    }
    const ghosts = leagueGhosts(store.results(), key, kind);
    body.innerHTML = `
      <div class="p3-tabs p3-modes">${modes.map((m) => { const [mo, t, l] = m.key.split(":");
        return `<button data-k="${esc(m.key)}" class="${m.key === key ? "active" : ""}">${esc(mo)} ${esc(t)} ${esc(l)} <small>(${m.n})</small></button>`; }).join("")}</div>
      <div class="p3-tabs p3-kinds"><button data-kind="pb" class="${kind === "pb" ? "active" : ""}">last ${SIZE} personal bests</button>
        <button data-kind="top" class="${kind === "top" ? "active" : ""}">top ${SIZE} runs</button></div>
      <table class="p3-list"><thead><tr><th>ghost</th><th class="num">wpm</th><th class="num">acc</th></tr></thead><tbody>
        ${ghosts.slice().reverse().map((g) => `<tr><td>${shortDate(g.ts)}</td><td class="num wpm">${Math.round(g.wpm)}</td><td class="num dim">${Math.round(g.acc)}%</td></tr>`).join("")}
      </tbody></table>
      <div class="p3-actions"><button class="p3-btn primary" data-act="go">race ${ghosts.length} ghost${ghosts.length === 1 ? "" : "s"}</button></div>
      <div class="p3-hint">enter: start</div>`;
    body.querySelector(".p3-modes").onclick = (e) => { const b = e.target.closest("[data-k]"); if (b) { key = b.dataset.k; showStart(); } };
    body.querySelector(".p3-kinds").onclick = (e) => { const b = e.target.closest("[data-kind]"); if (b) { kind = b.dataset.kind; showStart(); } };
    const go = () => play(ghosts);
    body.querySelector('[data-act="go"]').onclick = go;
    setKeys((e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  }

  async function play(runs) {
    stop();
    const [mode, targetStr, lang] = key.split(":");
    const target = Number(targetStr);
    const pool = await commonWords(lang);
    if (!alive) return;
    const best = Math.max(...runs.map((r) => r.wpm));
    const ghosts = runs.map((r) => ({
      label: shortDate(r.ts), wpm: r.wpm, ts: r.ts, pb: r.wpm === best,
      series: progressSeries(r.words, r.log, r),
    }));
    body.innerHTML = `
      <div class="p3-race-bar"><div><div class="p3-label">league</div>
        <div class="p3-ghost-name">${ghosts.length} ghosts <small>${esc(mode)} ${target} · ${esc(lang)} · best ${Math.round(best)} wpm</small></div></div>
        <div class="p3-gap"><div class="p3-label">live place</div><div class="v">&#8212;</div><div class="ms">the ghosts start when you do</div></div></div>
      <div class="p3-typing"></div>
      <div class="p3-league-legend">${ghosts.map((g) => `<span><b>${esc(g.label)}</b> ${Math.round(g.wpm)}</span>`).join("")}</div>
      <div class="p3-hint">esc: restart</div>`;
    const placeV = body.querySelector(".p3-gap .v"), placeMs = body.querySelector(".p3-gap .ms");
    const E = Eng();
    const typingEl = body.querySelector(".p3-typing");
    typing = createTyping(typingEl, {
      mode: mode === "words" ? "words" : mode === "text" ? "words" : "time",
      duration: target, wordCount: target, words: pool, lang,
      onRestart() { hideAll(); placeV.textContent = "—"; placeMs.textContent = "the ghosts start when you do"; },
      onFinish(r) { finish(r, ghosts, mode, target, lang); },
    });
    removeKeys = null;
    const win = typingEl.querySelector(".words-window");
    const layer = document.createElement("div");
    layer.className = "p3-league-layer";
    win.appendChild(layer);
    const carets = ghosts.map((g) => {
      const c = document.createElement("div");
      c.className = "p3-lcaret" + (g.pb ? " pb" : "");
      c.hidden = true;
      c.innerHTML = `<span>${esc(g.label)}</span>`;
      layer.appendChild(c);
      return c;
    });
    function hideAll() { carets.forEach((c) => { c.hidden = true; }); }

    function draw() {
      const t = typing && typing.test;
      if (!t || t.startedAt === null) return;
      const ms = E.elapsedMs(t, Date.now());
      const wordsEl = typingEl.querySelector(".words");
      const wr = win.getBoundingClientRect();
      const myPos = charPos(t.words, t.index, (t.typed[t.index] || "").length);
      let ahead = 0;
      ghosts.forEach((g, i) => {
        const pos = posAt(g.series, ms);
        if (pos > myPos) ahead++;
        const at = placeAt(t.words, pos);
        const w = wordsEl.children[at.index];
        if (!w || !w.children.length) { carets[i].hidden = true; return; }
        const end = at.typed >= w.children.length;
        const l = w.children[end ? w.children.length - 1 : at.typed];
        const lr = l.getBoundingClientRect();
        const left = (end ? lr.right : lr.left) - wr.left;
        const top = lr.top - wr.top + w.offsetHeight * 0.82;
        const visible = top >= 0 && top < wr.height;
        carets[i].hidden = !visible;
        if (visible) { carets[i].style.left = left + "px"; carets[i].style.top = top + "px"; }
      });
      placeV.textContent = `${ahead + 1} / ${ghosts.length + 1}`;
      placeMs.textContent = ahead ? `${ahead} ghost${ahead === 1 ? "" : "s"} ahead of you` : "you lead the pack";
    }
    timer = setInterval(draw, 100);
  }

  function finish(r, ghosts, mode, target, lang) {
    clearInterval(timer); timer = null;
    r.source = "ghost-league";
    store.addResult(r);
    const pl = leaguePlacing(r.wpm, ghosts.map((g) => g.wpm));
    const prevBest = bestScore(store, ID);
    store.addGameScore(ID, pl.beaten, {
      place: pl.place, of: pl.of, won: pl.place === 1, wpm: r.wpm, acc: r.acc, mode, target, lang, kind,
    });
    if (typing) { typing.destroy(); typing = null; }
    const rows = standings(r.wpm, ghosts);
    body.innerHTML = endPanel({
      title: "ghosts beaten", score: `${pl.beaten}/${ghosts.length}`, unit: "", best: prevBest, isBest: pl.beaten > 0 && (prevBest == null || pl.beaten > prevBest),
      stats: [["place", `${pl.place} of ${pl.of}`], ["wpm", Math.round(r.wpm)], ["accuracy", `${Math.round(r.acc)}%`]],
      extra: `<table class="p3-list p3-league-table" style="max-width:420px;margin:0 auto 20px"><tbody>
        ${rows.map((x, i) => `<tr><td class="dim">${i + 1}</td><td class="${x.me ? "me" : ""}">${esc(x.name)}</td><td class="num ${x.me ? "me" : "wpm"}">${Math.round(x.wpm)}</td></tr>`).join("")}
        </tbody></table>`,
      retry: "race again",
    });
    const again = () => play(leagueGhosts(store.results(), key, kind));
    body.querySelector('[data-act="retry"]').onclick = again;
    setKeys((e) => { if (e.key === "Enter" || (e.key === "Escape" && !e.repeat)) { e.preventDefault(); again(); } });
  }

  showStart();
}

function unmount() {
  alive = false;
  stop();
}

export default { mount, unmount };
