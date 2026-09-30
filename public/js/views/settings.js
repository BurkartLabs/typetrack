// Settings: grouped sections writing straight to settings.set(k, v) — the typing surface, sound and
// layout hook read those keys directly, so this view has no local state beyond the DOM controls.
import { loadCss } from "../core/css.js";
import { esc } from "../core/ui.js";
import theme from "../core/theme.js";
import sound from "../core/sound.js";
import layout from "../core/layout.js";
import words from "../core/words.js";

let cleanup = [];

function field(label, controlHtml) {
  return `<div class="field"><span class="field-label">${esc(label)}</span><div class="field-control">${controlHtml}</div></div>`;
}

function group(name, options, current) {
  return `<div class="btn-group" data-field="${name}">${options.map(([v, l]) => {
    const label = l == null ? v : l;
    return `<button type="button" data-value="${esc(v)}" class="${v === current ? "active" : ""}">${esc(label)}</button>`;
  }).join("")}</div>`;
}

function toggle(name, current) {
  return `<button type="button" class="toggle-btn ${current ? "active" : ""}" data-field="${name}">${current ? "on" : "off"}</button>`;
}

function slider(name, min, max, step, value, suffix) {
  return `<div class="slider-row" data-field="${name}">` +
    `<input type="range" min="${min}" max="${max}" step="${step}" value="${value}">` +
    `<span class="slider-val">${value}${suffix || ""}</span></div>`;
}

const LIST_LABELS = { "common-200": "200", "common-1k": "1k", "common-10k": "10k" };
const SOUND_OPTIONS = [["off", "off"], ["soft", "soft click"], ["typewriter", "typewriter"], ["thock", "thock"]];
const CARET_OPTIONS = [["underline", "underline"], ["line", "line"], ["block", "block"]];

function section(title, fieldsHtml) {
  return `<section class="settings-section"><h2 class="settings-title">${esc(title)}</h2>${fieldsHtml}</section>`;
}

const MARKUP = `
  <section class="view view-settings">
    <div class="settings-head">
      <h1 class="settings-h1">settings</h1>
      <a href="#/tools" class="back-link">tools &rarr;</a>
    </div>
    <div data-el="body"></div>
    <div class="settings-actions">
      <button type="button" data-el="reset" class="danger">reset all settings</button>
    </div>
  </section>`;

async function mount(root, ctx) {
  const { settings, bus } = ctx;
  await loadCss("css/settings.css");
  root.innerHTML = MARKUP;
  const body = root.querySelector("[data-el='body']");

  const manifest = await words.manifest().catch(() => null);
  const languages = (manifest && Array.isArray(manifest.languages) && manifest.languages.length)
    ? manifest.languages : [{ code: "en", name: "english", lists: ["common-200", "common-1k"] }];

  const lang = settings.get("lang") || "en";
  const curLangDef = languages.find((l) => l.code === lang) || languages[0];
  const lists = (curLangDef.lists || ["common-1k"]).filter((n) => /^common-/.test(n));
  if (!lists.length) lists.push("common-1k");

  const th = theme.resolve(settings.get("theme"));

  body.innerHTML = [
    section("language & words", [
      field("language", `<select data-field="lang">${languages.map((l) =>
        `<option value="${esc(l.code)}" ${l.code === lang ? "selected" : ""}>${esc(l.name || l.code)}</option>`).join("")}</select>`),
      field("word list", group("list", lists.map((n) => [n, LIST_LABELS[n] || n]), settings.get("list"))),
      field("accents", group("accents", [["strict", "strict"], ["lenient", "lenient"]], settings.get("accents"))),
    ].join("")),

    section("typing", [
      field("caret", group("caret", CARET_OPTIONS, settings.get("caret"))),
      field("hide timer", toggle("hideTimer", !!settings.get("hideTimer"))),
      field("hide live wpm", toggle("hideLiveWpm", !!settings.get("hideLiveWpm"))),
      field("typing width", slider("width", 600, 1400, 20, Number(settings.get("width")) || 1000, "px")),
    ].join("")),

    section("sound", [
      field("sound", group("sound", SOUND_OPTIONS, settings.get("sound") || "off")),
      field("error sound", toggle("errorSound", settings.get("errorSound") !== false)),
      field("volume", slider("volume", 0, 100, 5, Math.round((settings.get("volume") == null ? 0.5 : settings.get("volume")) * 100), "%")),
    ].join("")),

    section("keyboard layout", [
      field("layout", group("layout", layout.LAYOUTS.map((k) => [k, layout.LABELS[k]]), settings.get("layout") || "qwerty")),
    ].join("")),

    section("theme", [
      field("preset", `<div class="preset-grid" data-field="preset">${Object.keys(theme.PRESETS).map((name) => {
        const p = theme.PRESETS[name];
        return `<button type="button" data-value="${esc(name)}" class="preset-swatch ${th.preset === name ? "active" : ""}" title="${esc(name)}" style="background:${p["--bg"]}">` +
          `<i style="background:${p["--main"]}"></i><i style="background:${p["--caret"]}"></i><i style="background:${p["--text"]}"></i></button>`;
      }).join("")}</div>`),
      field("colours", `<div class="color-grid" data-el="colors">${theme.VARS.map((v) =>
        `<label class="color-field"><span>${esc(v.replace("--", ""))}</span><input type="color" data-var="${v}" value="${th.vars[v]}"></label>`).join("")}</div>`),
      field("font", group("font", Object.keys(theme.FONTS).map((f) => [f, f]), th.font)),
    ].join("")),
  ].join("");

  function set(k, v) { settings.set(k, v); }

  // Button groups (single-select) — data-field on the group, data-value on each button.
  body.querySelectorAll(".btn-group").forEach((g) => {
    g.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn) return;
      const fieldName = g.dataset.field;
      g.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      if (fieldName === "font") {
        const t = theme.resolve(settings.get("theme"));
        set("theme", { preset: t.preset, vars: t.vars, font: btn.dataset.value });
      } else {
        set(fieldName, btn.dataset.value);
        if (fieldName === "sound") sound.play("key"); // preview the chosen click
      }
    });
  });

  // Preset swatches
  const presetGrid = body.querySelector("[data-field='preset']");
  presetGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    presetGrid.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    const name = btn.dataset.value;
    const t = theme.resolve(settings.get("theme"));
    const vars = Object.assign({}, theme.PRESETS[name]);
    set("theme", { preset: name, vars, font: t.font });
    body.querySelectorAll("[data-var]").forEach((inp) => { inp.value = vars[inp.dataset.var]; });
  });

  // Custom colour pickers
  body.querySelectorAll("[data-var]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const t = theme.resolve(settings.get("theme"));
      const vars = Object.assign({}, t.vars, { [inp.dataset.var]: inp.value });
      set("theme", { preset: null, vars, font: t.font });
      presetGrid.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
    });
  });

  // Toggles
  body.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = !btn.classList.contains("active");
      btn.classList.toggle("active", next);
      btn.textContent = next ? "on" : "off";
      set(btn.dataset.field, next);
    });
  });

  // Sliders
  body.querySelectorAll(".slider-row").forEach((row) => {
    const input = row.querySelector("input[type=range]");
    const out = row.querySelector(".slider-val");
    const name = row.dataset.field;
    const suffix = name === "volume" ? "%" : name === "width" ? "px" : "";
    input.addEventListener("input", () => {
      out.textContent = input.value + suffix;
      if (name === "volume") set("volume", Number(input.value) / 100);
      else set(name, Number(input.value));
    });
    if (name === "volume") input.addEventListener("change", () => sound.play("key")); // hear the new level
  });

  // Language select
  const langSelect = body.querySelector("select[data-field='lang']");
  langSelect.addEventListener("change", () => {
    set("lang", langSelect.value);
    const def = languages.find((l) => l.code === langSelect.value);
    const nextLists = (def && def.lists || ["common-1k"]).filter((n) => /^common-/.test(n));
    if (nextLists.length && !nextLists.includes(settings.get("list"))) set("list", nextLists[0]);
    mount(root, ctx); // relist word tiers for the new language
  });

  const resetBtn = root.querySelector("[data-el='reset']");
  resetBtn.addEventListener("click", () => {
    if (!confirm("reset every setting to its default?")) return;
    settings.reset();
    mount(root, ctx);
  });
}

function unmount() {
  cleanup.forEach((f) => f());
  cleanup = [];
}

export default { mount, unmount };
