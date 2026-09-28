// Train: the hub (#/train) and the drills (#/train/<drill>). A drill module is { mount(root, ctx), unmount? }.
// Training-plan boxes tick themselves: this module listens on result:saved for as long as the page lives.
import { loadCss } from "../core/css.js";
import { esc } from "../core/ui.js";
import bus from "../core/bus.js";
import store from "../core/store.js";
import * as L from "./train/lib.js";
import { PLAN_KEY, todayHtml, bindTicks } from "./train/plans.js";
import { langName } from "./train/shell.js";

export const DRILLS = [
  { id: "pairs", name: "pair drills", desc: "words packed with your slowest letter pairs. medians before and after every round.", load: () => import("./train/pairs.js") },
  { id: "metronome", name: "metronome", desc: "type on a click at 120-200 wpm. scored on how even your keystrokes are.", load: () => import("./train/metronome.js") },
  { id: "memory", name: "memory mode", desc: "a line shows for a few seconds, then hides. type it from memory.", load: () => import("./train/memory.js") },
  { id: "blind", name: "blind run", desc: "no feedback while you type. the errors are revealed at the end.", load: () => import("./train/blind.js") },
  { id: "mirror", name: "mirror mode", desc: "words drawn backwards, or their letters scrambled. read every letter.", load: () => import("./train/mirror.js") },
  { id: "accents", name: "accent drills", desc: "words full of accented letters, with a keyboard hint for each one.", lang: true, load: () => import("./train/accents.js") },
  { id: "vocab", name: "vocabulary", desc: "a word in your target language, its meaning underneath. type it.", lang: true, load: () => import("./train/vocab.js") },
  { id: "translate", name: "translation race", desc: "see english, type the translation. 60 seconds, most correct wins.", lang: true, load: () => import("./train/race.js") },
  { id: "plans", name: "training plans", desc: "+10 wpm in 4 weeks, accuracy at speed, stamina: a daily drill set.", load: () => import("./train/plans.js") },
];

// Plan ticks: when any result is saved (a drill here, or a test elsewhere), re-sync today's boxes.
bus.on("result:saved", () => {
  const state = store.get(PLAN_KEY, null);
  if (!state || !L.planById(state.id)) return;
  const next = L.syncFromResults(state, store.results(), Date.now());
  if (next !== state) {
    store.set(PLAN_KEY, next);
    bus.emit("plan:changed", next);
  }
});

let child = null, token = 0, offs = [];

async function mount(root, ctx) {
  const my = ++token;
  await loadCss("css/train.css");
  if (my !== token) return;
  const id = ctx.params.parts && ctx.params.parts[0];
  if (!id) return renderHub(root, ctx);
  const drill = DRILLS.find((d) => d.id === id);
  if (!drill) {
    root.innerHTML = `<div class="notice"><div class="notice-title">no such drill</div><p>"${esc(id)}" isn't a drill.</p><a href="#/train">all drills</a></div>`;
    return;
  }
  document.title = `${drill.name} · typetrack`;
  let view;
  try {
    const mod = await drill.load();
    view = mod && (mod.default || mod);
  } catch (err) {
    console.error(`[train] could not load ${id}`, err);
    if (my === token) root.innerHTML = `<div class="notice"><div class="notice-title">${esc(drill.name)}</div><p>this drill could not be loaded.</p><a href="#/train">all drills</a></div>`;
    return;
  }
  if (my !== token) return;
  child = view;
  await view.mount(root, ctx);
}

function renderHub(root, ctx) {
  const { store, settings, words } = ctx;
  const E = window.Engine;
  const lang = settings.get("lang") || "en";
  const now = Date.now();
  const todayKey = L.dayKey(now);
  const results = store.results();
  const today = {};
  for (const r of results) if (r.source && L.dayKey(r.ts) === todayKey) today[r.source] = (today[r.source] || 0) + 1;
  let slow = [];
  try { slow = L.slowestPairs(E, results.filter((r) => (r.lang || "en") === lang), 3); } catch { slow = []; }

  const meta = {
    pairs: slow.length ? `your slowest: ${slow.map((p) => `<b>${esc(p)}</b>`).join(" ")}` : "needs a few tests to find your pairs",
    accents: L.ACCENTS[lang] ? `${esc(langName(lang))}: ${esc(L.ACCENTS[lang])}` : "pick a language in the drill",
    vocab: lang !== "en" ? esc(langName(lang)) : "pick a language in the drill",
    translate: lang !== "en" ? esc(langName(lang)) : "pick a language in the drill",
  };

  root.innerHTML = `
    <section class="view view-train">
      <div class="train-head hub-head">
        <div class="train-title big">train</div>
        <div class="train-sub">drills for your next 10 wpm</div>
      </div>
      <div data-el="plan"></div>
      <div class="train-grid">${DRILLS.map((d) => `
        <a class="train-card" href="#/train/${d.id}" data-drill="${d.id}">
          <div class="card-name">${esc(d.name)}</div>
          <div class="card-desc">${esc(d.desc)}</div>
          <div class="card-meta" data-meta="${d.id}">${meta[d.id] || "&nbsp;"}</div>
          ${today["train:" + d.id] ? `<span class="card-tag">&times;${today["train:" + d.id]} today</span>` : ""}
        </a>`).join("")}</div>
    </section>`;
  const planEl = root.querySelector("[data-el=plan]");

  function renderPlan() {
    let state = store.get(PLAN_KEY, null);
    if (state && L.planById(state.id)) {
      const synced = L.syncFromResults(state, store.results(), Date.now());
      if (synced !== state) store.set(PLAN_KEY, (state = synced));
    }
    const t = state && L.planToday(state, Date.now());
    planEl.innerHTML = t ? `
      <div class="plan-today">
        <div class="plan-top"><div><span class="label">today &middot; ${esc(t.plan.name)}</span>
          <span class="train-sub">day ${t.day} of ${t.plan.days} &middot; ${t.done.filter(Boolean).length}/${t.items.length} done</span></div>
          <a class="back-link" href="#/train/plans">plan &rarr;</a></div>
        ${todayHtml(t)}
      </div>` : `
      <a class="plan-cta" href="#/train/plans"><span class="label">no training plan</span> pick one: +10 wpm in 4 weeks, accuracy at speed, stamina &rarr;</a>`;
  }
  renderPlan();
  bindTicks(planEl, ctx, renderPlan);
  offs.push(bus.on("plan:changed", renderPlan));

  // Language drills: say so on the card when the data isn't there.
  const token0 = token;
  (async () => {
    if (lang !== "en") {
      const tr = await words.translations(lang);
      if (token0 !== token) return;
      if (!Array.isArray(tr) || tr.length < 5) {
        for (const id of ["vocab", "translate"]) {
          const m = root.querySelector(`[data-meta="${id}"]`);
          if (m) m.innerHTML = `no ${esc(langName(lang))} translations yet`;
        }
      }
    }
  })();
}

async function unmount() {
  token++;
  offs.forEach((f) => f());
  offs = [];
  if (child && typeof child.unmount === "function") {
    try { await child.unmount(); } catch (err) { console.error("[train] drill unmount failed", err); }
  }
  child = null;
}

export default { mount, unmount };
