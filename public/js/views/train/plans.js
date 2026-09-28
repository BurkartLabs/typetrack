// Training plans: pick one; each day lists 3-4 drills whose boxes tick themselves when a matching result
// is saved that day (views/train.js listens on result:saved). State: store key train.plan.
import { esc } from "../../core/ui.js";
import * as L from "./lib.js";

export const PLAN_KEY = "train.plan";

export function itemHref(item) {
  return item.drill ? "#/train/" + item.drill : "#/test";
}

// Today's list; used by the plans page and the hub.
export function todayHtml(t) {
  return `<ul class="plan-items">${t.items.map((item, i) => `
    <li class="${t.done[i] ? "done" : ""}">
      <label><input type="checkbox" data-tick="${i}" ${t.done[i] ? "checked" : ""}><span class="box"></span>${esc(item.label)}</label>
      <a class="go" href="${itemHref(item)}">${t.done[i] ? "again" : "go"} &rarr;</a>
    </li>`).join("")}</ul>`;
}

export function bindTicks(container, ctx, rerender) {
  container.addEventListener("change", (e) => {
    const box = e.target.closest("input[data-tick]");
    if (!box) return;
    const state = ctx.store.get(PLAN_KEY, null);
    const t = state && L.planToday(state, Date.now());
    if (!t) return;
    ctx.store.set(PLAN_KEY, L.setTick(state, t.today, Number(box.dataset.tick), box.checked));
    rerender();
  });
}

let off = null;

function mount(root, ctx) {
  const { store, bus } = ctx;
  root.innerHTML = `<section class="view view-train"><div class="train-head">
      <a class="back-link" href="#/train">&larr; train</a><div class="train-title">training plans</div>
      <div class="train-sub">a fixed set of drills a day. boxes tick themselves when you finish the drill.</div></div>
    <div data-el="body"></div></section>`;
  const body = root.querySelector("[data-el=body]");

  function render() {
    let state = store.get(PLAN_KEY, null);
    const now = Date.now();
    if (state && L.planById(state.id)) {
      const synced = L.syncFromResults(state, store.results(), now);
      if (synced !== state) store.set(PLAN_KEY, (state = synced));
    }
    const t = state && L.planToday(state, now);
    let html = "";
    if (t) {
      const done = L.daysComplete(state);
      const tomorrow = t.plan.cycle[t.day % t.plan.cycle.length];
      html += `<div class="plan-active">
        <div class="plan-top"><div><div class="plan-name">${esc(t.plan.name)}</div>
          <div class="train-sub">${t.over ? `plan finished (${t.plan.days} days). keep going or pick another.` : `day ${t.day} of ${t.plan.days}`} &middot; ${done} day${done === 1 ? "" : "s"} complete</div></div>
          <button class="danger" data-act="stop">stop plan</button></div>
        <div class="plan-progress"><i style="width:${Math.min(100, (done / t.plan.days) * 100).toFixed(1)}%"></i></div>
        <div class="err-block"><span class="label">today${t.done.every(Boolean) ? " &middot; all done" : ""}</span>${todayHtml(t)}</div>
        <div class="err-block"><span class="label">tomorrow</span><div class="chips">${tomorrow.map((x) => `<span class="chip">${esc(x.label)}</span>`).join("")}</div></div>
      </div>`;
    }
    html += `<div class="train-grid plans-grid">${L.PLANS.map((p) => `
      <div class="train-card plan-card${t && t.plan.id === p.id ? " current" : ""}">
        <div class="card-name">${esc(p.name)}</div>
        <div class="card-desc">${esc(p.desc)}</div>
        <div class="card-meta">${p.days} days &middot; ${Math.min(...p.cycle.map((d) => d.length))}-${Math.max(...p.cycle.map((d) => d.length))} drills a day</div>
        ${t && t.plan.id === p.id ? `<span class="card-tag">current</span>` : `<button data-start="${p.id}">${t ? "switch to this" : "start"} &rarr;</button>`}
      </div>`).join("")}</div>`;
    body.innerHTML = html;
  }

  body.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.start) {
      store.set(PLAN_KEY, L.startPlan(b.dataset.start, Date.now()));
      render();
    } else if (b.dataset.act === "stop") {
      if (b.dataset.sure) { store.remove(PLAN_KEY); render(); }
      else { b.dataset.sure = "1"; b.textContent = "sure? click again"; }
    }
  });
  bindTicks(body, ctx, render);
  off = bus.on("plan:changed", render);
  render();
}

function unmount() {
  if (off) off();
  off = null;
}

export default { mount, unmount };
