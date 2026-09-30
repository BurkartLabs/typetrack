// Games hub (#/games) and game host (#/games/<id>). Games come from three registries, one per games
// contributor; each exports `default [{id, name, desc, tags, load: () => import('./x.js')}]`.
// A missing or broken pack is skipped, never fatal. A game module is { mount(root, ctx), unmount?() }.
import { loadCss } from "../core/css.js";
import { esc } from "../core/ui.js";

const PACKS = [
  () => import("./games/pack1.js"),
  () => import("./games/pack2.js"),
  () => import("./games/pack3.js"),
];

let child = null, token = 0;

export async function loadGames() {
  const settled = await Promise.allSettled(PACKS.map((p) => p()));
  const out = [], seen = new Set();
  settled.forEach((s, i) => {
    if (s.status !== "fulfilled") { console.warn(`[games] pack${i + 1} unavailable`, s.reason); return; }
    const list = s.value && s.value.default;
    if (!Array.isArray(list)) return;
    for (const g of list) {
      if (!g || !g.id || typeof g.load !== "function" || seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
  });
  return out;
}

async function mount(root, ctx) {
  const my = ++token;
  await loadCss("css/games.css");
  const games = await loadGames();
  if (my !== token) return;
  const id = ctx.params.parts && ctx.params.parts[0];
  if (!id) return renderHub(root, games);

  const game = games.find((g) => g.id === id);
  if (!game) {
    root.innerHTML = `<div class="notice"><div class="notice-title">no such game</div>
      <p>"${esc(id)}" isn't in the arcade.</p><a href="#/games">all games</a></div>`;
    return;
  }
  document.title = `${game.name} · typetrack`;
  let mod;
  try {
    mod = await game.load();
  } catch (err) {
    console.error(`[games] could not load ${id}`, err);
    if (my !== token) return;
    root.innerHTML = `<div class="notice"><div class="notice-title">${esc(game.name)}</div>
      <p>this game could not be loaded.</p><a href="#/games">all games</a></div>`;
    return;
  }
  if (my !== token) return;
  const view = mod && (mod.default || mod);
  if (!view || typeof view.mount !== "function") {
    root.innerHTML = `<div class="notice"><div class="notice-title">${esc(game.name)}</div><p>coming soon.</p><a href="#/games">all games</a></div>`;
    return;
  }
  const host = document.createElement("div");
  host.className = "game-host";
  host.innerHTML = `<a class="back-link" href="#/games">&larr; games</a>`;
  const stage = document.createElement("div");
  stage.className = "game-stage";
  host.appendChild(stage);
  root.replaceChildren(host);
  child = view;
  await view.mount(stage, Object.assign({}, ctx, { game }));
}

function renderHub(root, games) {
  const tags = [...new Set(games.flatMap((g) => g.tags || []))].sort();
  root.innerHTML = `
    <section class="view view-games">
      <div class="games-head">
        <div class="games-title">games</div>
        <div class="games-sub">${games.length} game${games.length === 1 ? "" : "s"} · built to find your next 10 wpm</div>
      </div>
      ${tags.length ? `<div class="config games-filter"><div class="group">
        <button data-tag="" class="active">all</button>
        ${tags.map((t) => `<button data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
      </div></div>` : ""}
      <div class="game-grid">
        ${games.map((g) => `
          <a class="game-card" href="#/games/${encodeURIComponent(g.id)}" data-tags="${esc((g.tags || []).join(" "))}">
            <div class="game-name">${esc(g.name || g.id)}</div>
            <div class="game-desc">${esc(g.desc || "")}</div>
            <div class="game-tags">${(g.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
          </a>`).join("")}
      </div>
      ${games.length ? "" : `<p class="notice">no games yet &#8212; they're on their way.</p>`}
    </section>`;
  const filter = root.querySelector(".games-filter");
  if (filter) filter.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    filter.querySelectorAll("button").forEach((x) => x.classList.toggle("active", x === b));
    const tag = b.dataset.tag;
    root.querySelectorAll(".game-card").forEach((c) => { c.hidden = !!tag && !c.dataset.tags.split(" ").includes(tag); });
  });
}

async function unmount() {
  token++;
  const c = child;
  child = null;
  if (c && typeof c.unmount === "function") await c.unmount();
}

export default { mount, unmount };
