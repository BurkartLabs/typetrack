// Weekly tournament (#/weekly): one fixed challenge per ISO week (UTC), the same seeded words for everybody
// (the server generates them), unlimited attempts, best run counts. Standings, last week's podium and a
// countdown to the week's end. Runs are posted straight to /api/results with `challenge`; they are not added
// to the local results (they would otherwise also be posted by app.js as a normal test).
import { loadCss } from "../core/css.js";
import { esc, toast } from "../core/ui.js";
import { createTyping } from "../core/typing.js";
import { tabsHtml, signInBar, errorHtml, fmtDate, profileLink, raceLink } from "./leaderboard.js";

let token = 0;
let offs = [];
let clock = null;
let typing = null;

function countdown(ms) {
  if (ms <= 0) return "ended";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return (d ? `${d}d ` : "") + `${p(h)}:${p(m)}:${p(sec)}`;
}

function podium(w) {
  if (!w || !w.winners || !w.winners.length) {
    return `<div class="wk-podium-empty">no winners last week (${esc(w ? w.week : "")}). be the first on this week's podium.</div>`;
  }
  const byRank = (r) => w.winners.find((x) => x.rank === r);
  const step = (r) => {
    const x = byRank(r);
    return `<div class="wk-step wk-step${r}">${x
      ? `<div class="wk-who">${profileLink(x.name)}</div><div class="wk-wpm">${x.wpm.toFixed(1)}<small>wpm</small></div>`
      : `<div class="wk-who wk-none">—</div>`}<div class="wk-block">${r}</div></div>`;
  };
  return `<div class="wk-podium-title">last week · ${esc(w.week)}</div><div class="wk-podium">${step(2)}${step(1)}${step(3)}</div>`;
}

function standingsHtml(data, user) {
  const meName = user && user.name.toLowerCase();
  const rows = data.standings || [];
  const table = rows.length
    ? `<table class="lb-table"><thead><tr><th class="num">#</th><th>name</th><th class="num">wpm</th><th class="num">acc</th>
        <th class="num">tries</th><th class="date">date</th><th></th></tr></thead><tbody>${rows.map((r) =>
        `<tr class="${meName && r.name.toLowerCase() === meName ? "me" : ""}${r.rank <= 3 ? " top" + r.rank : ""}">
          <td class="num rank">${r.rank}</td><td>${profileLink(r.name)}</td><td class="num wpm">${r.wpm.toFixed(1)}</td>
          <td class="num">${Math.round(r.acc)}%</td><td class="num">${r.attempts}</td><td class="date">${esc(fmtDate(r.ts))}</td>
          <td class="act">${raceLink(r.resultId)}</td></tr>`).join("")}</tbody></table>`
    : `<p class="lb-empty">nobody has entered this week yet.</p>`;
  let me = "";
  if (user && data.me) {
    me = data.me.rank
      ? `<div class="lb-me">you: <b>#${data.me.rank}</b> of ${data.players} · best ${data.me.wpm.toFixed(1)} wpm · ${data.me.attempts} attempt${data.me.attempts === 1 ? "" : "s"}</div>`
      : `<div class="lb-me">you haven't entered this week yet.</div>`;
  }
  return table + me;
}

async function mount(root, ctx) {
  const my = ++token;
  await loadCss("css/leaderboard.css");
  if (my !== token) return;
  document.title = "weekly challenge · typetrack";
  root.innerHTML = `<section class="lb wk">${tabsHtml("weekly")}<div class="lb-signin-slot"></div>
    <div class="wk-body"><div class="lb-loading">loading…</div></div></section>`;
  const body = root.querySelector(".wk-body");
  const slot = root.querySelector(".lb-signin-slot");

  let data, win;
  try {
    [data, win] = await Promise.all([
      ctx.api.get("/api/weekly"),
      ctx.api.get("/api/weekly/winners").catch(() => null),
    ]);
  } catch (err) {
    if (my === token) body.innerHTML = errorHtml(err);
    return;
  }
  if (my !== token) return;
  const skew = data.now - Date.now(); // trust the server's clock for the countdown

  body.innerHTML = `<header class="wk-head">
      <div><div class="wk-title">weekly challenge <span>${esc(data.week)}</span></div>
      <div class="wk-sub">${data.target} seconds · english ${esc(data.list || "common-1k")} · same words for everybody · best run counts</div></div>
      <div class="wk-clock"><span class="wk-clock-label">ends in</span><span class="wk-clock-value"></span></div>
    </header>
    <div class="wk-grid">
      <div class="wk-main">
        <div class="wk-play"></div>
        <h2 class="wk-h">standings <small class="wk-players"></small></h2>
        <div class="wk-standings"></div>
      </div>
      <aside class="wk-side">${podium(win)}</aside>
    </div>`;
  const clockEl = body.querySelector(".wk-clock-value");
  const play = body.querySelector(".wk-play");
  const standingsEl = body.querySelector(".wk-standings");
  const playersEl = body.querySelector(".wk-players");

  const tickClock = () => {
    const left = data.ends - (Date.now() + skew);
    clockEl.textContent = countdown(left);
    if (left <= 0 && clock) { clearInterval(clock); clock = null; }
  };
  tickClock();
  clock = setInterval(tickClock, 1000);

  function renderStandings() {
    standingsEl.innerHTML = standingsHtml(data, ctx.auth.user);
    playersEl.textContent = data.players ? `${data.players} player${data.players === 1 ? "" : "s"}` : "";
  }

  async function refresh() {
    try {
      const d = await ctx.api.get("/api/weekly");
      if (my !== token) return;
      if (d.week !== data.week) { unmount(); return mount(root, ctx); } // the week rolled over
      data = { ...d, words: data.words };
      renderStandings();
    } catch { /* keep the old standings */ }
  }

  function renderIdle() {
    if (typing) { typing.destroy(); typing = null; }
    slot.innerHTML = signInBar(ctx.auth.user, ctx.auth.online);
    const user = ctx.auth.user;
    play.innerHTML = user
      ? `<div class="wk-cta"><button type="button" class="wk-start">start the challenge</button>
         <span>unlimited attempts; your best run this week counts.</span></div>`
      : `<div class="wk-cta"><a class="wk-start" href="#/login">sign in to enter</a>
         <span>the standings are open to everybody.</span></div>`;
    const b = play.querySelector("button.wk-start");
    if (b) b.addEventListener("click", start);
  }

  function start() {
    if (!ctx.auth.user || !Array.isArray(data.words) || !data.words.length) return;
    play.innerHTML = `<div class="wk-typing"></div><div class="wk-actions"><button type="button" class="wk-restart">restart</button>
      <button type="button" class="wk-cancel">cancel</button></div><div class="wk-result" hidden></div>`;
    const resultEl = play.querySelector(".wk-result");
    play.querySelector(".wk-cancel").addEventListener("click", renderIdle);
    play.querySelector(".wk-restart").addEventListener("click", () => { resultEl.hidden = true; typing && typing.restart(); });
    typing = createTyping(play.querySelector(".wk-typing"), {
      mode: "time", duration: data.target, words: data.words, ordered: true, lang: data.lang,
      onFinish: (r) => submit(r, resultEl),
    });
  }

  async function submit(r, resultEl) {
    resultEl.hidden = false;
    resultEl.innerHTML = `<span class="wk-res-wpm">${r.wpm.toFixed(1)} <small>wpm</small></span>
      <span class="wk-res-acc">${Math.round(r.acc)}% <small>acc</small></span><span class="wk-res-msg">submitting…</span>`;
    const msg = resultEl.querySelector(".wk-res-msg");
    try {
      await ctx.api.post("/api/results", { ...r, challenge: data.challenge });
      if (my !== token) return;
      await refresh();
      if (my !== token) return;
      const me = data.me;
      msg.textContent = me && me.rank ? `submitted · you're #${me.rank} this week` : "submitted";
      toast(`weekly: ${r.wpm.toFixed(1)} wpm submitted`);
    } catch (err) {
      if (my !== token) return;
      msg.textContent = err && err.status === 0 ? "offline: this run was not submitted" : `not accepted: ${(err && err.error) || "error"}`;
      msg.classList.add("err");
    }
  }

  renderStandings();
  renderIdle();
  offs.push(ctx.bus.on("auth:changed", () => { if (my === token) { renderIdle(); refresh(); } }));
}

function unmount() {
  token++;
  if (clock) { clearInterval(clock); clock = null; }
  if (typing) { typing.destroy(); typing = null; }
  offs.forEach((off) => off());
  offs = [];
}

export default { mount, unmount };
