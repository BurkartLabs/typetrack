// Leaderboards (#/leaderboard, #/leaderboard/games). The weekly tab is its own route (#/weekly, weekly.js).
// Boards are readable signed out; offline shows a clear message instead of an empty table.
import { loadCss } from "../core/css.js";
import { esc } from "../core/ui.js";

const PACKS = [
  () => import("./games/pack1.js"),
  () => import("./games/pack2.js"),
  () => import("./games/pack3.js"),
];
const TARGETS = { time: [15, 30, 60, 120], words: [25, 50, 100] };
const PERIODS = [["day", "today"], ["week", "this week"], ["all", "all time"]];
const FILTERS = "lb.filters";

let offs = [];
let token = 0;

// The tab bar shared with weekly.js.
export function tabsHtml(active) {
  const tab = (id, href, label) =>
    `<a class="lb-tab${active === id ? " active" : ""}" href="${href}">${label}</a>`;
  return `<nav class="lb-tabs" aria-label="leaderboards">${tab("typing", "#/leaderboard", "typing")}` +
    `${tab("games", "#/leaderboard/games", "games")}${tab("weekly", "#/weekly", "weekly")}</nav>`;
}

export function signInBar(user, online) {
  return user || online === false ? "" : `<div class="lb-signin">boards are public. <a href="#/login">sign in</a> to appear here.</div>`;
}

export function errorHtml(err) {
  if (err && err.status === 0) {
    return `<div class="notice"><div class="notice-title">leaderboards are offline</div>
      <p>the typetrack server can't be reached right now. your tests still save on this device.</p></div>`;
  }
  return `<div class="notice"><div class="notice-title">couldn't load this board</div><p>${esc((err && err.error) || "unknown error")}</p></div>`;
}

export function fmtDate(ts) {
  const d = new Date(ts);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "2-digit" });
}

export const profileLink = (name) => `<a class="lb-name" href="#/profile/${encodeURIComponent(name)}">${esc(name)}</a>`;
export const raceLink = (id) => `<a class="lb-race" href="#/games/ghost-race?result=${encodeURIComponent(id)}" title="race this run's ghost">race</a>`;

export async function loadGameList() {
  const settled = await Promise.allSettled(PACKS.map((p) => p()));
  const out = [], seen = new Set();
  for (const s of settled) {
    const list = s.status === "fulfilled" && s.value && s.value.default;
    if (!Array.isArray(list)) continue;
    for (const g of list) if (g && g.id && !seen.has(g.id)) { seen.add(g.id); out.push(g); }
  }
  return out;
}

// Lower is better when the registry entry says so (order: 'asc', lowerIsBetter, or meta.order).
const ascending = (g) => !!g && (g.order === "asc" || g.lowerIsBetter === true || (g.meta && g.meta.order === "asc"));

async function mount(root, ctx) {
  const my = ++token;
  await loadCss("css/leaderboard.css");
  if (my !== token) return;
  const tab = ctx.params.parts && ctx.params.parts[0] === "games" ? "games" : "typing";
  document.title = (tab === "games" ? "game boards" : "leaderboard") + " · typetrack";
  root.innerHTML = `<section class="lb">${tabsHtml(tab)}<div class="lb-signin-slot"></div>
    <div class="lb-config"></div><div class="lb-body"><div class="lb-loading">loading…</div></div></section>`;
  const slot = root.querySelector(".lb-signin-slot");
  const renderSignIn = () => { slot.innerHTML = signInBar(ctx.auth.user, ctx.auth.online); };
  renderSignIn();
  const view = tab === "games" ? await gamesTab(root, ctx, my) : await typingTab(root, ctx, my);
  if (my !== token || !view) return;
  offs.push(ctx.bus.on("auth:changed", () => { renderSignIn(); view.reload(); }));
}

// ── typing ───────────────────────────────────────────────────────────────
async function typingTab(root, ctx, my) {
  const saved = ctx.store.get(FILTERS, {}) || {};
  const f = {
    mode: saved.mode === "words" ? "words" : "time",
    target: Number(saved.target) || 30,
    lang: typeof saved.lang === "string" ? saved.lang : ctx.settings.get("lang") || "en",
    period: PERIODS.some((p) => p[0] === saved.period) ? saved.period : "all",
  };
  if (!TARGETS[f.mode].includes(f.target)) f.target = TARGETS[f.mode][1];

  let langs = [{ code: "en", name: "english" }];
  try {
    const m = await ctx.words.manifest();
    const l = (m && m.languages || []).filter((x) => x && x.code).map((x) => ({ code: x.code, name: x.name || x.code }));
    if (l.length) langs = l;
  } catch { /* manifest missing: english only */ }
  if (my !== token) return null;
  if (!langs.some((l) => l.code === f.lang)) f.lang = langs[0].code;

  const config = root.querySelector(".lb-config");
  const body = root.querySelector(".lb-body");

  function renderConfig() {
    const btn = (k, v, label) =>
      `<button type="button" data-k="${k}" data-v="${esc(v)}" class="${String(f[k]) === String(v) ? "active" : ""}">${esc(label)}</button>`;
    config.innerHTML = `<div class="config lb-filters">
      <div class="group">${btn("mode", "time", "time")}${btn("mode", "words", "words")}</div><span class="sep"></span>
      <div class="group">${TARGETS[f.mode].map((t) => btn("target", t, t)).join("")}</div><span class="sep"></span>
      <div class="group"><label class="lb-lang"><span class="sr">language</span><select data-k="lang">${langs
        .map((l) => `<option value="${esc(l.code)}"${l.code === f.lang ? " selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label></div>
      <span class="sep"></span>
      <div class="group">${PERIODS.map(([v, label]) => btn("period", v, label)).join("")}</div></div>`;
  }

  config.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-k]");
    if (!b) return;
    const k = b.dataset.k;
    f[k] = k === "target" ? Number(b.dataset.v) : b.dataset.v;
    if (k === "mode") f.target = f.mode === "time" ? 30 : 50;
    changed();
  });
  config.addEventListener("change", (e) => {
    if (e.target.matches("select[data-k=lang]")) { f.lang = e.target.value; changed(); }
  });

  function changed() {
    ctx.store.set(FILTERS, { ...f });
    renderConfig();
    load();
  }

  let req = 0;
  async function load() {
    const mine = ++req;
    body.classList.add("lb-busy");
    const qs = new URLSearchParams({ mode: f.mode, target: String(f.target), lang: f.lang, period: f.period });
    let rows;
    try {
      rows = await ctx.api.get("/api/leaderboard?" + qs);
    } catch (err) {
      if (mine !== req || my !== token) return;
      body.classList.remove("lb-busy");
      body.innerHTML = errorHtml(err);
      return;
    }
    if (mine !== req || my !== token) return;
    const user = ctx.auth.user;
    const meName = user && user.name.toLowerCase();
    const label = `${f.mode} ${f.target} · ${(langs.find((l) => l.code === f.lang) || {}).name || f.lang} · ${PERIODS.find((p) => p[0] === f.period)[1]}`;
    body.classList.remove("lb-busy");
    if (!rows.length) {
      body.innerHTML = `<p class="lb-empty">no ranked results for ${esc(label)} yet. <a href="#/test">take the test</a></p>`;
    } else {
      body.innerHTML = `<table class="lb-table"><caption class="sr">${esc(label)}</caption><thead><tr>
        <th class="num">#</th><th>name</th><th class="num">wpm</th><th class="num">acc</th><th class="date">date</th><th></th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${meName && r.name.toLowerCase() === meName ? "me" : ""}${r.rank <= 3 ? " top" + r.rank : ""}">
          <td class="num rank">${r.rank}</td><td>${profileLink(r.name)}</td>
          <td class="num wpm">${r.wpm.toFixed(1)}</td><td class="num">${Math.round(r.acc)}%</td>
          <td class="date">${esc(fmtDate(r.ts))}</td><td class="act">${raceLink(r.resultId)}</td></tr>`).join("")}</tbody></table>
        <div class="lb-me"></div>`;
    }
    if (user && !rows.some((r) => r.name.toLowerCase() === meName)) {
      let me = null;
      try { me = await ctx.api.get("/api/leaderboard/me?" + qs); } catch { /* not important */ }
      if (mine !== req || my !== token) return;
      let el = body.querySelector(".lb-me");
      if (!el) { el = document.createElement("div"); el.className = "lb-me"; body.appendChild(el); }
      el.innerHTML = me && me.rank
        ? `your best: <b>#${me.rank}</b> · ${me.wpm.toFixed(1)} wpm · ${Math.round(me.acc)}%`
        : `you have no ranked result on this board yet.`;
    }
  }

  renderConfig();
  load();
  return { reload: load };
}

// ── games ────────────────────────────────────────────────────────────────
async function gamesTab(root, ctx, my) {
  const games = await loadGameList();
  if (my !== token) return null;
  const config = root.querySelector(".lb-config");
  const body = root.querySelector(".lb-body");
  if (!games.length) {
    body.innerHTML = `<p class="lb-empty">no games in this build yet. <a href="#/games">the arcade</a></p>`;
    return { reload() {} };
  }
  const saved = ctx.store.get("lb.game", {}) || {};
  let game = games.find((g) => g.id === (ctx.query.game || saved.id)) || games[0];
  let period = PERIODS.some((p) => p[0] === saved.period) ? saved.period : "all";

  function renderConfig() {
    config.innerHTML = `<div class="config lb-filters">
      <div class="group"><label class="lb-lang"><span class="sr">game</span><select data-k="game">${games
        .map((g) => `<option value="${esc(g.id)}"${g.id === game.id ? " selected" : ""}>${esc(g.name || g.id)}</option>`).join("")}</select></label></div>
      <span class="sep"></span>
      <div class="group">${PERIODS.map(([v, label]) =>
        `<button type="button" data-period="${v}" class="${period === v ? "active" : ""}">${label}</button>`).join("")}</div></div>`;
  }
  config.addEventListener("change", (e) => {
    if (!e.target.matches("select[data-k=game]")) return;
    game = games.find((g) => g.id === e.target.value) || game;
    changed();
  });
  config.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-period]");
    if (b) { period = b.dataset.period; changed(); }
  });
  function changed() {
    ctx.store.set("lb.game", { id: game.id, period });
    renderConfig();
    load();
  }

  let req = 0;
  async function load() {
    const mine = ++req;
    const asc = ascending(game);
    const qs = new URLSearchParams({ period, ...(asc ? { order: "asc" } : {}) });
    let rows;
    try {
      rows = await ctx.api.get(`/api/games/${encodeURIComponent(game.id)}/leaderboard?${qs}`);
    } catch (err) {
      if (mine === req && my === token) body.innerHTML = errorHtml(err);
      return;
    }
    if (mine !== req || my !== token) return;
    const meName = ctx.auth.user && ctx.auth.user.name.toLowerCase();
    const unit = game.unit ? ` <small>${esc(game.unit)}</small>` : "";
    body.innerHTML = rows.length
      ? `<table class="lb-table"><thead><tr><th class="num">#</th><th>name</th><th class="num">score${asc ? " ↓" : ""}</th><th class="date">date</th></tr></thead>
        <tbody>${rows.map((r) => `<tr class="${meName && r.name.toLowerCase() === meName ? "me" : ""}${r.rank <= 3 ? " top" + r.rank : ""}">
          <td class="num rank">${r.rank}</td><td>${profileLink(r.name)}</td>
          <td class="num wpm">${esc(Number.isInteger(r.score) ? r.score : r.score.toFixed(1))}${unit}</td>
          <td class="date">${esc(fmtDate(r.ts))}</td></tr>`).join("")}</tbody></table>`
      : `<p class="lb-empty">no scores for ${esc(game.name || game.id)} yet. <a href="#/games/${encodeURIComponent(game.id)}">play it</a></p>`;
  }

  renderConfig();
  load();
  return { reload: load };
}

function unmount() {
  token++;
  offs.forEach((off) => off());
  offs = [];
}

export default { mount, unmount };
