// Theme: presets + custom overrides + font, applied as CSS vars on :root. Pure enough to test
// (resolve/sanitizeVars/isValidColor take no DOM); apply() and loadFont() need document.
import { loadCss } from "./css.js";

// The eight tokens a theme controls (base.css also defines --error-extra and --line, left alone).
export const VARS = ["--bg", "--main", "--caret", "--text", "--sub", "--sub-alt", "--error", "--edge"];

// crimson is the shipped look (base.css tokens); the rest are original, built for this site.
export const PRESETS = {
  crimson: { "--bg": "#161618", "--main": "#b3202e", "--caret": "#d4283a", "--text": "#e6e1dc", "--sub": "#5c5b60", "--sub-alt": "#1f1f22", "--error": "#ff6b4a", "--edge": "#2a2a2e" },
  ember: { "--bg": "#171310", "--main": "#d9772e", "--caret": "#f4933d", "--text": "#f0e6da", "--sub": "#6b5d4f", "--sub-alt": "#221c17", "--error": "#e5484d", "--edge": "#2f2620" },
  oxblood: { "--bg": "#140f10", "--main": "#7a1f2b", "--caret": "#9c2c39", "--text": "#e8dcd8", "--sub": "#5a4d4e", "--sub-alt": "#1d1516", "--error": "#c1443a", "--edge": "#2a1f20" },
  graphite: { "--bg": "#17181a", "--main": "#5b7a8c", "--caret": "#7ea0b3", "--text": "#e2e6e8", "--sub": "#5c6266", "--sub-alt": "#202224", "--error": "#c76b5a", "--edge": "#2a2d30" },
  "bone-light": { "--bg": "#eee9e1", "--main": "#a3402e", "--caret": "#c04b34", "--text": "#242019", "--sub": "#8c8375", "--sub-alt": "#e2dbcf", "--error": "#b0392a", "--edge": "#d6cdbd" },
};

export const DEFAULT_PRESET = "crimson";

// name -> { stack (used as --font), google (family param for the css2 API) }
export const FONTS = {
  "JetBrains Mono": { stack: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
  "IBM Plex Mono": { stack: '"IBM Plex Mono", ui-monospace, monospace', google: "IBM+Plex+Mono:wght@400;500;700" },
  "Fira Code": { stack: '"Fira Code", ui-monospace, monospace', google: "Fira+Code:wght@400;500;700" },
  "Roboto Mono": { stack: '"Roboto Mono", ui-monospace, monospace', google: "Roboto+Mono:wght@400;500;700" },
};
export const DEFAULT_FONT = "JetBrains Mono"; // already linked in index.html, no fetch needed

export function isValidColor(v) {
  return typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
}

// Drop anything that isn't one of the eight vars with a valid hex value.
export function sanitizeVars(vars) {
  const out = {};
  if (!vars || typeof vars !== "object") return out;
  for (const k of VARS) if (isValidColor(vars[k])) out[k] = vars[k].trim().toLowerCase();
  return out;
}

// settings.theme -> { preset, vars (full 8, preset + overrides applied), font }. Never throws.
export function resolve(theme) {
  const t = theme && typeof theme === "object" ? theme : {};
  const preset = PRESETS[t.preset] ? t.preset : DEFAULT_PRESET;
  const vars = Object.assign({}, PRESETS[preset], sanitizeVars(t.vars));
  const font = FONTS[t.font] ? t.font : DEFAULT_FONT;
  return { preset, vars, font };
}

let fontLoaded = new Set([DEFAULT_FONT]);
export function loadFont(name) {
  const def = FONTS[name];
  if (!def || fontLoaded.has(name) || !def.google) return;
  fontLoaded.add(name);
  loadCss(`https://fonts.googleapis.com/css2?family=${def.google}&display=swap`);
}

// Write the resolved theme onto :root. Canvas charts read these vars via css.js#cssVar, so they
// follow with no extra wiring.
export function apply(theme) {
  if (typeof document === "undefined") return resolve(theme);
  const { vars, font } = resolve(theme);
  const root = document.documentElement.style;
  for (const k of VARS) root.setProperty(k, vars[k]);
  root.setProperty("--font", FONTS[font].stack);
  loadFont(font);
  return resolve(theme);
}

export const theme = { VARS, PRESETS, DEFAULT_PRESET, FONTS, DEFAULT_FONT, isValidColor, sanitizeVars, resolve, loadFont, apply };
export default theme;
