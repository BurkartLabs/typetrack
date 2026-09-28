// Daily gauntlet: the same five challenges for everyone each UTC day (seeded by the date), played back to back,
// one attempt per day. Total score = sum of wpm × accuracy over the five; streak of consecutive days played and a
// calendar strip of the last 14 days. The attempt is spent on the first challenge's start: no restarts.
import { createTyping } from "../../core/typing.js";
import { esc, toast } from "../../core/ui.js";
import { streak } from "../../core/progress.js";
import {
  utcDateKey, addDays, seededRand, pick, pickN, commonWords, rareWords, quotes, codeSnippets, loadPack3Css, bestScore,
} from "./pack3-kit.js";

const ID = "daily-gauntlet";

// ── pure ──────────────────────────────────────────────────────────────────
const flat = (s) => String(s).split(/\s+/).filter(Boolean).join(" ");

// The five challenges for a UTC day. pools: { common: string[], rare: string[], quotes: [{text, source}], code: string[] }.
// Only the date seeds it, so everyone with the same word data gets the same gauntlet.
export function gauntletPlan(dateKey, pools) {
  const rand = seededRand("gauntlet:" + dateKey);
  const common = pools.common && pools.common.length ? pools.common : ["the"];
  const rare = pools.rare && pools.rare.length ? pools.rare : common;
  const q = pools.quotes && pools.quotes.length ? pick(pools.quotes, rand) : { text: pickN(common, 20, rand).join(" "), source: "" };
  const code = pools.code && pools.code.length ? pick(pools.code, rand) : "const x = 1;";
  return [
    { id: "sprint", name: "sprint phrase", mode: "text", text: pickN(common, 8, rand).join(" ") },
    { id: "common", name: "30 s common words", mode: "time", duration: 30, words: pickN(common, 200, rand) },
    { id: "quote", name: "quote", mode: "text", text: flat(q.text), source: q.source || "" },
    { id: "rare", name: "rare words", mode: "text", text: pickN(rare, 12, rand).join(" ") },
    { id: "code", name: "code snippet", mode: "text", text: flat(code) },
  ];
}

export const challengeScore = (r) => Math.round((Number(r.wpm) || 0) * (Number(r.acc) || 0) / 100);
export const gauntletTotal = (parts) => parts.reduce((a, p) => a + (Number(p.score) || 0), 0);

// Consecutive UTC days played, counting back from today (or yesterday while today is unplayed).
export function gauntletStreak(days, today) {
  return streak(days, today);
}

// The last n days, oldest first: [{date, played, total, today}]. records: {date: {total}}.
export function calendarStrip(today, records, n = 14) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const r = records[date];
    out.push({ date, played: !!r, total: r ? Number(r.total) || 0 : 0, today: i === 0 });
  }
  return out;
}

export function msToNextDay(now = Date.now()) {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

// ── view ──────────────────────────────────────────────────────────────────
let alive = false, typing = null, removeKeys = null;

function stop() {
  if (typing) { typing.destroy(); typing = null; }
  if (removeKeys) { removeKeys(); removeKeys = null; }
}

async function mount(root, ctx) {
  alive = true;
  await loadPack3Css();
  const { store, settings, keys } = ctx;
  const lang = settings.get("lang") || "en";
  const today = utcDateKey();
  root.innerHTML = `<section class="p3 p3-daily-gauntlet">
    <div class="p3-head"><div><div class="p3-title">daily gauntlet</div>
    <div class="p3-sub">${today} (utc) · five challenges, the same for everyone · one attempt</div></div></div>
    <div class="p3-body"></div></section>`;
  const body = root.querySelector(".p3-body");
  const [common, rare, qs, code] = await Promise.all([commonWords(lang), rareWords(lang), quotes(lang), codeSnippets("js")]);
  if (!alive) return;
  const plan = gauntletPlan(today, { common, rare, quotes: qs, code });
  const recKey = "gauntlet." + today;

  function setKeys(fn) { if (removeKeys) removeKeys(); removeKeys = keys.set(fn); }
  const days = () => { const d = store.get("gauntlet.days", []); return Array.isArray(d) ? d : []; };

  function history() {
    const recs = {};
    for (let i = 0; i < 14; i++) { const d = addDays(today, -i); const r = store.get("gauntlet." + d, null); if (r) recs[d] = r; }
    const st = gauntletStreak(days(), today);
    const strip = calendarStrip(today, recs);
    return `<div class="p3-streak">
        <div><span class="p3-label">streak</span><span>${st.current} day${st.current === 1 ? "" : "s"}</span></div>
        <div><span class="p3-label">best streak</span><span>${st.best}</span></div>
        <div><span class="p3-label">best total</span><span>${bestScore(store, ID) ?? "&#8212;"}</span></div></div>
      <div class="p3-label">last 14 days</div>
      <div class="p3-cal">${strip.map((d) => `<div class="p3-day${d.played ? " played" : ""}${d.today ? " today" : ""}" title="${d.date}${d.played ? " · " + d.total : ""}">
        ${Number(d.date.slice(8))}<i>${d.played ? d.total : ""}</i></div>`).join("")}</div>`;
  }

  function steps(parts, current) {
    return `<div class="p3-gauntlet-steps">${plan.map((c, i) => {
      const p = parts[i];
      return `<div class="p3-step${p ? " done" : ""}${i === current ? " current" : ""}">${i + 1}. ${esc(c.name)}<b>${p ? p.score : i === current ? "now" : "&#8212;"}</b></div>`;
    }).join("")}</div>`;
  }

  function showIntro() {
    stop();
    body.innerHTML = `${steps([], -1)}
      <div class="p3-note">five challenges back to back. each scores <b>wpm × accuracy</b>. the attempt counts from your first keystroke &#8212; <b>no restarts</b>, and leaving midway ends it.</div>
      <div class="p3-actions"><button class="p3-btn primary" data-act="go">start today's gauntlet</button></div>
      <div class="p3-hint">enter: start</div>
      <div style="margin-top:28px">${history()}</div>`;
    body.querySelector('[data-act="go"]').onclick = begin;
    setKeys((e) => { if (e.key === "Enter") { e.preventDefault(); begin(); } });
  }

  function begin() {
    const rec = { started: Date.now(), done: false, parts: [], total: 0 };
    store.set(recKey, rec);
    const d = days();
    if (!d.includes(today)) store.set("gauntlet.days", [...d, today].slice(-400));
    ready(rec, 0);
  }

  function ready(rec, i) {
    stop();
    const c = plan[i];
    body.innerHTML = `${steps(rec.parts, i)}
      <div class="p3-banner">challenge ${i + 1} of 5 · ${esc(c.name)}${c.mode === "time" ? " · 30 seconds" : ""}</div>
      <div class="p3-typing"></div>
      ${c.source ? `<div class="p3-hint">&#8212; ${esc(c.source)}</div>` : ""}
      <div class="p3-hint">starts on your first key · esc does nothing here: one attempt</div>`;
    typing = createTyping(body.querySelector(".p3-typing"), {
      keys: false, mode: c.mode, duration: c.duration, text: c.text, words: c.words, ordered: true, lang, width: 900,
      onFinish(r) {
        rec.parts.push({ id: c.id, wpm: r.wpm, acc: r.acc, score: challengeScore(r) });
        rec.total = gauntletTotal(rec.parts);
        store.set(recKey, rec);
        if (i + 1 < plan.length) setTimeout(() => { if (alive) ready(rec, i + 1); }, 900);
        else complete(rec);
      },
    });
    setKeys((e) => {
      if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); if (!e.repeat) toast("one attempt a day: no restarts"); return; }
      if (typing) typing.handleKey(e);
    });
  }

  function complete(rec) {
    stop();
    rec.done = true;
    rec.total = gauntletTotal(rec.parts);
    store.set(recKey, rec);
    const st = gauntletStreak(days(), today);
    store.addGameScore(ID, rec.total, { date: today, parts: rec.parts, streak: st.current, lang, complete: rec.parts.length === plan.length });
    showDone(rec, true);
  }

  function showDone(rec, fresh) {
    stop();
    const ms = msToNextDay();
    const hrs = Math.floor(ms / 3600000), mins = Math.floor((ms % 3600000) / 60000);
    const abandoned = rec.parts.length < plan.length;
    body.innerHTML = `${steps(rec.parts, -1)}
      <div class="p3-end">
        <div class="p3-label">${fresh ? "today's total" : abandoned ? "today's attempt (abandoned)" : "you've played today"}</div>
        <div class="p3-score">${rec.total}<small>pts</small></div>
        <div class="p3-stats">${rec.parts.map((p) => `<div><span class="p3-label">${esc(plan.find((c) => c.id === p.id)?.name || p.id)}</span><span>${Math.round(p.wpm)} wpm · ${Math.round(p.acc)}%</span></div>`).join("")}</div>
        <div class="p3-best">next gauntlet in ${hrs}h ${mins}m</div>
        <div class="p3-actions"><a class="p3-btn primary" href="#/games">all games</a></div>
      </div>
      <div style="margin-top:12px">${history()}</div>`;
    setKeys((e) => { if (e.key === "Escape" || e.key === "Enter") e.preventDefault(); });
  }

  const rec = store.get(recKey, null);
  if (rec && rec.done) showDone(rec, false);
  else if (rec) {
    // left midway: the attempt is spent; bank what was finished
    rec.done = true;
    rec.total = gauntletTotal(rec.parts || []);
    rec.parts = rec.parts || [];
    store.set(recKey, rec);
    store.addGameScore(ID, rec.total, { date: today, parts: rec.parts, streak: gauntletStreak(days(), today).current, lang, complete: false });
    showDone(rec, false);
  } else showIntro();
}

function unmount() {
  alive = false;
  stop();
}

export default { mount, unmount };
