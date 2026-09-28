// Ghost race: race a caret replaying a recorded run keystroke by keystroke on the same words.
// Sources: your personal best for a mode, any recent run, or another player's run from the server
// (#/games/ghost-race?result=<id>, or the top-10 picker fed by /api/leaderboard).
import { createTyping } from "../../core/typing.js";
import { esc, shortDate } from "../../core/ui.js";
import {
  Eng, charPos, progressSeries, ghostGap, hasLog, modeOf, fmtSigned, loadPack3Css, bestScore, endPanel,
} from "./pack3-kit.js";

const ID = "ghost-race";
const BOARD_MODES = [["time", 15], ["time", 30], ["time", 60], ["words", 25], ["words", 50]];

// ── pure ──────────────────────────────────────────────────────────────────
// Best run with a log for a mode + target + lang (the PB ghost), or null.
export function pickPB(results, { mode, target, lang }) {
  let best = null;
  for (const r of results) {
    if (!hasLog(r) || r.mode !== mode || Number(r.target) !== Number(target) || (r.lang || "en") !== (lang || "en")) continue;
    if (!best || r.wpm > best.wpm || (r.wpm === best.wpm && r.ts < best.ts)) best = r;
  }
  return best;
}

// One PB per mode key that has a raceable run, best first.
export function personalBests(results) {
  const keys = [...new Set(results.filter(hasLog).map(modeOf))];
  return keys
    .map((k) => { const [mode, target, lang] = k.split(":"); return pickPB(results, { mode, target: Number(target), lang }); })
    .filter(Boolean)
    .sort((a, b) => (a.mode === b.mode ? a.target - b.target : a.mode < b.mode ? -1 : 1));
}

export function recentGhosts(results, n = 15) {
  return results.filter(hasLog).sort((a, b) => b.ts - a.ts).slice(0, n);
}

// Won = more wpm than the ghost on the same words (wpm counts only correct characters, so mashing loses).
export function raceWon(myWpm, ghostWpm) {
  return Number(myWpm) > Number(ghostWpm);
}

// "+12 ch" / "−340 ms" style texts for a gap.
export function gapText(gap) {
  const ch = `${fmtSigned(gap.chars)} ch`;
  const ms = gap.ms == null ? "past the ghost's last key" : `${fmtSigned(gap.ms / 1000, 2)} s`;
  return { ch, ms };
}

function ghostFromResult(r, name) {
  return {
    name, wpm: r.wpm, acc: r.acc, mode: r.mode, target: Number(r.target), lang: r.lang || "en",
    words: r.words, log: r.log, accents: r.accents, noBackspace: r.noBackspace, ts: r.ts,
  };
}

// ── view ──────────────────────────────────────────────────────────────────
let alive = false, typing = null, timer = null, removeKeys = null;

function stopRace() {
  clearInterval(timer); timer = null;
  if (typing) { typing.destroy(); typing = null; }
  if (removeKeys) { removeKeys(); removeKeys = null; }
}

async function mount(root, ctx) {
  alive = true;
  await loadPack3Css();
  const { store, settings, api, auth, keys } = ctx;
  const lang = settings.get("lang") || "en";
  root.innerHTML = `<section class="p3 p3-ghost-race">
    <div class="p3-head"><div><div class="p3-title">ghost race</div>
    <div class="p3-sub">race a run keystroke by keystroke &#8212; yours or anyone's</div></div></div>
    <div class="p3-body"></div></section>`;
  const body = root.querySelector(".p3-body");
  let tab = "pb", boardMode = BOARD_MODES[1];

  function setKeys(fn) {
    if (removeKeys) removeKeys();
    removeKeys = keys.set(fn);
  }

  // ── picker ──────────────────────────────────────────────────────────
  function showPicker(note) {
    stopRace();
    body.innerHTML = `
      ${note ? `<div class="p3-note warn">${note}</div>` : ""}
      <div class="p3-tabs">
        <button data-tab="pb">personal best</button><button data-tab="recent">recent runs</button><button data-tab="players">other players</button>
      </div>
      <div class="p3-pane"></div>
      <div class="p3-hint">enter: race the first ghost in the list</div>`;
    body.querySelector(".p3-tabs").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-tab]");
      if (b) { tab = b.dataset.tab; renderPane(); }
    });
    renderPane();
  }

  function localTable(list, label) {
    if (!list.length) {
      return `<div class="p3-note">no runs with a keystroke log yet. finish a test on the <a href="#/test">test page</a> and it becomes a ghost.</div>`;
    }
    return `<table class="p3-list"><thead><tr><th>${label}</th><th class="num">wpm</th><th class="num">acc</th><th>lang</th><th>date</th><th></th></tr></thead><tbody>
      ${list.map((r, i) => `<tr><td>${esc(r.mode)} ${esc(r.target)}</td><td class="num wpm">${Math.round(r.wpm)}</td>
        <td class="num dim">${Math.round(r.acc)}%</td><td class="dim">${esc(r.lang || "en")}</td><td class="dim">${shortDate(r.ts)}</td>
        <td class="num"><button class="p3-btn" data-race="${i}">race</button></td></tr>`).join("")}
    </tbody></table>`;
  }

  function renderPane() {
    body.querySelectorAll(".p3-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const pane = body.querySelector(".p3-pane");
    const results = store.results();
    let list = [], raceLocal = null;
    if (tab === "pb" || tab === "recent") {
      list = tab === "pb" ? personalBests(results) : recentGhosts(results);
      pane.innerHTML = localTable(list, tab === "pb" ? "personal best" : "run");
      raceLocal = (i) => race(ghostFromResult(list[i], tab === "pb" ? "your pb" : `you, ${shortDate(list[i].ts)}`), tab);
      pane.onclick = (e) => { const b = e.target.closest("[data-race]"); if (b) raceLocal(Number(b.dataset.race)); };
      setKeys((e) => { if (e.key === "Enter" && list.length) { e.preventDefault(); raceLocal(0); } });
      return;
    }
    renderPlayers(pane);
  }

  async function renderPlayers(pane) {
    const [mode, target] = boardMode;
    pane.innerHTML = `
      <div class="p3-tabs p3-modes">${BOARD_MODES.map(([m, t]) =>
        `<button data-m="${m}" data-t="${t}" class="${m === mode && t === target ? "active" : ""}">${m} ${t}</button>`).join("")}</div>
      <div class="p3-board"><div class="p3-note">loading the top 10 for ${mode} ${target} (${esc(lang)})&#8230;</div></div>`;
    pane.querySelector(".p3-modes").onclick = (e) => {
      const b = e.target.closest("button[data-m]");
      if (b) { boardMode = [b.dataset.m, Number(b.dataset.t)]; renderPlayers(pane); }
    };
    let rows = [];
    setKeys((e) => { if (e.key === "Enter" && rows.length) { e.preventDefault(); ctx.navigate(`#/games/${ID}?result=${rows[0].resultId}`); } });
    const boardEl = pane.querySelector(".p3-board");
    try {
      rows = await api.get(`/api/leaderboard?mode=${mode}&target=${target}&lang=${encodeURIComponent(lang)}&period=all`);
    } catch (err) {
      if (!alive || tab !== "players") return;
      boardEl.innerHTML = err && err.status === 0
        ? `<div class="p3-note warn"><b>offline</b> &#8212; the server can't be reached, so other players' ghosts aren't available. your own ghosts (personal best, recent runs) still work.</div>`
        : `<div class="p3-note warn">the leaderboard could not be loaded (${esc((err && err.error) || "error")}). your own ghosts still work.</div>`;
      return;
    }
    if (!alive || tab !== "players" || !pane.isConnected) return;
    rows = (Array.isArray(rows) ? rows : []).filter((r) => r && r.resultId != null).slice(0, 10);
    const signedOut = !auth.user
      ? `<div class="p3-note"><b>signed out</b> &#8212; you can race anyone on the board; <a href="#/login">sign in</a> to put your own runs there.</div>` : "";
    boardEl.innerHTML = signedOut + (rows.length
      ? `<table class="p3-list"><thead><tr><th>#</th><th>player</th><th class="num">wpm</th><th class="num">acc</th><th>date</th><th></th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td class="dim">${r.rank}</td><td>${esc(r.name)}</td><td class="num wpm">${Math.round(r.wpm)}</td>
          <td class="num dim">${Math.round(r.acc)}%</td><td class="dim">${shortDate(r.ts)}</td>
          <td class="num"><a class="p3-btn" href="#/games/${ID}?result=${encodeURIComponent(r.resultId)}">race</a></td></tr>`).join("")}
        </tbody></table>`
      : `<div class="p3-note">nobody is on the ${mode} ${target} board for ${esc(lang)} yet.</div>`);
  }

  async function loadRemote(id) {
    body.innerHTML = `<div class="p3-note">fetching run #${esc(id)}&#8230;</div>`;
    try {
      const g = await api.get(`/api/ghosts/${encodeURIComponent(id)}`);
      if (!alive) return;
      if (!g || !Array.isArray(g.words) || !Array.isArray(g.log) || !g.log.length) throw { status: 422, error: "that run has no keystroke log" };
      race(Object.assign(ghostFromResult(g, g.name || "player"), { resultId: g.id != null ? g.id : id }), "player");
    } catch (err) {
      if (!alive) return;
      tab = "pb";
      showPicker(err && err.status === 0
        ? `<b>offline</b> &#8212; run #${esc(id)} lives on the server, which can't be reached. race one of your own ghosts instead.`
        : err && err.status === 404 ? `run #${esc(id)} doesn't exist (any more).`
        : `run #${esc(id)} could not be loaded: ${esc((err && err.error) || "error")}.`);
    }
  }

  // ── race ────────────────────────────────────────────────────────────
  function race(ghost, source) {
    stopRace();
    const E = Eng();
    const series = progressSeries(ghost.words, ghost.log, ghost);
    body.innerHTML = `
      <div class="p3-race-bar">
        <div><div class="p3-label">racing</div>
          <div class="p3-ghost-name">${esc(ghost.name)} <small>${Math.round(ghost.wpm)} wpm · ${Math.round(ghost.acc)}% · ${esc(ghost.mode)} ${esc(ghost.target)} · ${esc(ghost.lang)}</small></div></div>
        <div class="p3-gap"><div class="p3-label">gap</div><div class="v">&#8212;</div><div class="ms">the ghost starts when you do</div></div>
      </div>
      <div class="p3-typing"></div>
      <div class="p3-actions"><button class="p3-btn" data-act="pick">change ghost</button></div>
      <div class="p3-hint">esc: restart · the faint caret is the ghost</div>`;
    const gapV = body.querySelector(".p3-gap .v"), gapMs = body.querySelector(".p3-gap .ms");
    body.querySelector('[data-act="pick"]').onclick = () => { if (ctx.query && ctx.query.result) ctx.navigate(`#/games/${ID}`); else showPicker(); };

    function showGap() {
      const t = typing && typing.test;
      if (!t || t.startedAt === null) return;
      const ms = E.elapsedMs(t, Date.now());
      const gap = ghostGap(series, charPos(t.words, t.index, (t.typed[t.index] || "").length), ms);
      const txt = gapText(gap);
      gapV.textContent = txt.ch;
      gapV.className = "v " + (gap.chars > 0 ? "ahead" : gap.chars < 0 ? "behind" : "");
      gapMs.textContent = txt.ms;
    }

    const mode = ghost.mode === "words" || ghost.mode === "text" ? ghost.mode : "time";
    typing = createTyping(body.querySelector(".p3-typing"), {
      mode, duration: ghost.target, wordCount: ghost.words.length, lang: ghost.lang,
      ghost: { words: ghost.words, log: ghost.log, accents: ghost.accents, noBackspace: ghost.noBackspace },
      onProgress: showGap,
      onRestart() { gapV.textContent = "—"; gapV.className = "v"; gapMs.textContent = "the ghost starts when you do"; },
      onFinish(r) { finish(ghost, source, series, r); },
    });
    removeKeys = null; // typing owns the keyboard now
    timer = setInterval(showGap, 100);
  }

  function finish(ghost, source, series, r) {
    clearInterval(timer); timer = null;
    const t = typing && typing.test;
    const myMs = t ? Eng().elapsedMs(t, t.finishedAt) : r.duration * 1000;
    const gap = t ? ghostGap(series, charPos(t.words, t.index, (t.typed[t.index] || "").length), myMs) : { chars: 0, ms: null };
    const won = raceWon(r.wpm, ghost.wpm);
    r.source = "ghost";
    r.ghost = { name: ghost.name, wpm: ghost.wpm, resultId: ghost.resultId };
    store.addResult(r);
    const prevBest = bestScore(store, ID);
    const score = Math.round(r.wpm);
    const timeDiff = mode(ghost) === "time" ? null : Math.round(series.end - myMs);
    store.addGameScore(ID, score, {
      won, ghost: ghost.name, ghostWpm: ghost.wpm, ghostResultId: ghost.resultId, source,
      mode: ghost.mode, target: ghost.target, lang: ghost.lang, wpm: r.wpm, acc: r.acc,
      gapChars: gap.chars, gapMs: timeDiff != null ? timeDiff : gap.ms,
    });
    if (typing) { typing.destroy(); typing = null; }
    const margin = timeDiff != null
      ? `${(Math.abs(timeDiff) / 1000).toFixed(2)} s ${timeDiff >= 0 ? "ahead" : "behind"}`
      : `${Math.abs(gap.chars)} ch ${gap.chars >= 0 ? "ahead" : "behind"}`;
    body.innerHTML = endPanel({
      title: `you vs ${ghost.name}`, score, unit: "wpm", best: prevBest, isBest: prevBest == null || score > prevBest,
      stats: [["ghost", `${Math.round(ghost.wpm)} wpm`], ["difference", `${fmtSigned(r.wpm - ghost.wpm, 1)} wpm`],
        ["margin", margin], ["accuracy", `${Math.round(r.acc)}%`]],
      extra: `<div class="p3-verdict ${won ? "won" : "lost"}">${won ? "you beat the ghost" : "the ghost wins"}</div>
        <div class="p3-actions" style="margin-bottom:8px"><button class="p3-btn" data-act="pick">change ghost</button></div>`,
      retry: "race again",
    });
    body.querySelector('[data-act="retry"]').onclick = () => race(ghost, source);
    body.querySelector('[data-act="pick"]').onclick = () => { if (ctx.query && ctx.query.result) ctx.navigate(`#/games/${ID}`); else showPicker(); };
    setKeys((e) => {
      if (e.key === "Enter" || (e.key === "Escape" && !e.repeat)) { e.preventDefault(); race(ghost, source); }
    });
  }

  const mode = (g) => (g.mode === "words" || g.mode === "text" ? g.mode : "time");

  const id = ctx.query && ctx.query.result;
  if (id) await loadRemote(id);
  else showPicker();
}

function unmount() {
  alive = false;
  stopRace();
}

export default { mount, unmount };
