// Tower climb: floors of rising difficulty. Floor 1 is 15 common words at 60 % of your average wpm; later floors
// bring longer words, rare words, punctuation, numbers and code, and the required speed rises. Miss the speed on
// a floor and the climb is over. Score = floors cleared.
import { createTyping } from "../../core/typing.js";
import { esc } from "../../core/ui.js";
import {
  Eng, pick, pickN, avgRecentWpm, commonWords, rareWords, codeSnippets, loadPack3Css, bestScore, endPanel,
} from "./pack3-kit.js";

const ID = "tower-climb";
const DEFAULT_AVG = 80;
const CYCLE = ["rare punctuation", "numbers", "code", "rare numbers"];
const KIND_NAMES = {
  common: "common words", long: "longer words", rare: "rare words", punctuation: "punctuation",
  numbers: "numbers", code: "code", "rare punctuation": "rare words + punctuation", "rare numbers": "rare words + numbers",
};

// ── pure ──────────────────────────────────────────────────────────────────
// Floor n (1-based) for a player averaging avgWpm: { floor, kind, count, req, pct }.
export function floorSpec(n, avgWpm) {
  const floor = Math.max(1, Math.floor(n));
  const base = ["common", "long", "rare", "punctuation", "numbers", "code"];
  const kind = floor <= base.length ? base[floor - 1] : CYCLE[(floor - base.length - 1) % CYCLE.length];
  const pct = Math.min(0.6 + 0.05 * (floor - 1), 1.5);
  const count = Math.min(15 + 2 * (floor - 1), 45);
  const avg = Number(avgWpm) > 0 ? Number(avgWpm) : DEFAULT_AVG;
  return { floor, kind, count, pct, req: Math.round(avg * pct) };
}

export const floorPassed = (wpm, req) => Number(wpm) >= Number(req);

const PUNCT = [",", ",", ".", ".", ";", ":", "?", "!"];

// Sentence-style punctuation over words: capitals after a full stop, trailing marks, the odd quote or bracket.
export function punctuate(words, rand) {
  const out = [];
  let cap = true;
  words.forEach((w, i) => {
    let t = cap ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    cap = false;
    const r = rand();
    if (r < 0.06) t = `"${t}"`;
    else if (r < 0.1) t = `(${t})`;
    const last = i === words.length - 1;
    if (last) t += ".";
    else if (rand() < 0.28) {
      const p = pick(PUNCT, rand);
      t += p;
      cap = p === "." || p === "?" || p === "!";
    }
    out.push(t);
  });
  return out;
}

export function numberToken(rand) {
  const r = rand();
  const n = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  if (r < 0.2) return String(n(1900, 2099));
  if (r < 0.4) return `${n(0, 99)}.${String(n(0, 99)).padStart(2, "0")}`;
  if (r < 0.55) return `${n(1, 100)}%`;
  if (r < 0.7) return `${n(0, 23)}:${String(n(0, 59)).padStart(2, "0")}`;
  if (r < 0.8) return `#${n(1, 999)}`;
  return String(n(0, 99999));
}

// Every third word becomes a number.
export function withNumbers(words, rand) {
  return words.map((w, i) => (i % 3 === 1 ? numberToken(rand) : w));
}

// The text for a floor. pools: { common, rare, code } (arrays of strings).
export function floorText(spec, pools, rand) {
  const common = pools.common && pools.common.length ? pools.common : ["the"];
  const rare = pools.rare && pools.rare.length ? pools.rare : common;
  const long = common.filter((w) => w.length >= 5);
  const n = spec.count;
  let words;
  switch (spec.kind) {
    case "common": words = pickN(common.filter((w) => w.length <= 6).length >= 20 ? common.filter((w) => w.length <= 6) : common, n, rand); break;
    case "long": words = pickN(long.length >= 20 ? long : common, n, rand); break;
    case "rare": words = pickN(rare, n, rand); break;
    case "punctuation": words = punctuate(pickN(common, n, rand), rand); break;
    case "numbers": words = withNumbers(pickN(common, n, rand), rand); break;
    case "rare punctuation": words = punctuate(pickN(rare, n, rand), rand); break;
    case "rare numbers": words = withNumbers(pickN(rare, n, rand), rand); break;
    case "code": {
      const code = pools.code && pools.code.length ? pools.code : ["const x = 1;"];
      words = [];
      let guard = 0;
      while (words.length < Math.ceil(n * 0.8) && guard++ < 20) words.push(...pick(code, rand).split(/\s+/).filter(Boolean));
      break;
    }
    default: words = pickN(common, n, rand);
  }
  return words.join(" ");
}

// ── view ──────────────────────────────────────────────────────────────────
let alive = false, typing = null, removeKeys = null, timer = null;

function stop() {
  clearTimeout(timer); timer = null;
  if (typing) { typing.destroy(); typing = null; }
  if (removeKeys) { removeKeys(); removeKeys = null; }
}

async function mount(root, ctx) {
  alive = true;
  await loadPack3Css();
  const { store, settings, keys } = ctx;
  const lang = settings.get("lang") || "en";
  root.innerHTML = `<section class="p3 p3-tower-climb">
    <div class="p3-head"><div><div class="p3-title">tower climb</div>
    <div class="p3-sub">every floor harder and faster. miss the speed once and you fall.</div></div></div>
    <div class="p3-tower-wrap"><div class="p3-tower"></div><div class="p3-main"></div></div></section>`;
  const towerEl = root.querySelector(".p3-tower"), main = root.querySelector(".p3-main");
  const [common, rare, code] = await Promise.all([commonWords(lang), rareWords(lang), codeSnippets("js")]);
  if (!alive) return;
  const pools = { common, rare, code };
  const recent = avgRecentWpm(store.results());
  const avg = recent == null ? DEFAULT_AVG : Math.round(recent);
  let cleared = 0, current = 1, failedAt = 0, rand = Eng().mulberry32(Date.now() >>> 0);

  function setKeys(fn) { if (removeKeys) removeKeys(); removeKeys = keys.set(fn); }

  function drawTower() {
    const top = Math.max(cleared + 4, 8);
    let html = "";
    for (let f = 1; f <= top; f++) {
      const cls = f <= cleared ? "done" : f === failedAt ? "failed" : f === current ? "current" : "ahead";
      html += `<div class="p3-floor ${cls}">F${f} · ${floorSpec(f, avg).req}</div>`;
    }
    towerEl.innerHTML = html;
  }

  function info(spec) {
    return `<div class="p3-floor-info">
      <div><span class="p3-label">floor</span><span>${spec.floor}</span></div>
      <div><span class="p3-label">challenge</span><span>${esc(KIND_NAMES[spec.kind] || spec.kind)}</span></div>
      <div><span class="p3-label">need</span><span class="need">${spec.req} wpm</span></div>
      <div><span class="p3-label">cleared</span><span>${cleared}</span></div></div>`;
  }

  function showStart() {
    stop();
    cleared = 0; current = 1; failedAt = 0; rand = Eng().mulberry32(Date.now() >>> 0);
    drawTower();
    const best = bestScore(store, ID);
    main.innerHTML = `
      <div class="p3-note">floor 1 needs <b>${floorSpec(1, avg).req} wpm</b>: 60 % of ${recent == null ? `an assumed ${DEFAULT_AVG}` : "your recent average of " + avg} wpm.
        each floor adds 5 % and a harder kind of text. best: <b>${best == null ? "&#8212;" : best + " floors"}</b></div>
      <div class="p3-actions"><button class="p3-btn primary" data-act="go">start climbing</button></div>
      <div class="p3-hint">enter: start · esc: back to floor 1</div>`;
    main.querySelector('[data-act="go"]').onclick = () => playFloor();
    setKeys((e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playFloor(); } });
  }

  function playFloor() {
    stop();
    const spec = floorSpec(current, avg);
    const text = floorText(spec, pools, rand);
    drawTower();
    main.innerHTML = `${info(spec)}<div class="p3-typing"></div><div class="p3-hint">esc: restart from floor 1</div>`;
    typing = createTyping(main.querySelector(".p3-typing"), {
      mode: "text", text, lang, hideCounter: false, width: 820,
      onRestart() { showStart(); },
      onFinish(r) { afterFloor(spec, r); },
    });
  }

  function afterFloor(spec, r) {
    if (typing) { typing.destroy(); typing = null; }
    if (floorPassed(r.wpm, spec.req)) {
      cleared = spec.floor;
      current = spec.floor + 1;
      drawTower();
      const next = floorSpec(current, avg);
      main.innerHTML = `${info(next)}
        <div class="p3-banner">floor ${spec.floor} cleared · ${Math.round(r.wpm)} wpm (needed ${spec.req})</div>
        <div class="p3-note">next: <b>${esc(KIND_NAMES[next.kind])}</b> at <b>${next.req} wpm</b></div>
        <div class="p3-actions"><button class="p3-btn primary" data-act="next">climb to floor ${current}</button></div>
        <div class="p3-hint">enter or space: next floor · esc: start over</div>`;
      main.querySelector('[data-act="next"]').onclick = () => playFloor();
      setKeys((e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); playFloor(); }
        else if (e.key === "Escape" && !e.repeat) { e.preventDefault(); showStart(); }
      });
      return;
    }
    failedAt = spec.floor;
    drawTower();
    const prevBest = bestScore(store, ID);
    store.addGameScore(ID, cleared, { reached: spec.floor, avgWpm: avg, lastWpm: r.wpm, lastReq: spec.req, kind: spec.kind, lang });
    main.innerHTML = endPanel({
      title: "floors cleared", score: cleared, unit: cleared === 1 ? "floor" : "floors", best: prevBest,
      isBest: cleared > 0 && (prevBest == null || cleared > prevBest),
      stats: [["fell on", `floor ${spec.floor}`], ["needed", `${spec.req} wpm`], ["you typed", `${Math.round(r.wpm)} wpm`], ["accuracy", `${Math.round(r.acc)}%`]],
      extra: `<div class="p3-banner bad">${esc(KIND_NAMES[spec.kind])} got you</div>`,
      retry: "climb again",
    });
    main.querySelector('[data-act="retry"]').onclick = () => showStart();
    setKeys((e) => { if (e.key === "Enter" || (e.key === "Escape" && !e.repeat)) { e.preventDefault(); showStart(); } });
  }

  showStart();
}

function unmount() {
  alive = false;
  stop();
}

export default { mount, unmount };
