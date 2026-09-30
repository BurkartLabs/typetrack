// User settings, persisted in the store. set() emits settings:changed ({key, value}).
import { get as storeGet, set as storeSet } from "./store.js";
import { emit } from "./bus.js";

const KEY = "settings.v1";

export const DEFAULTS = Object.freeze({
  lang: "en",
  list: "common-1k",
  accents: "lenient",
  layout: "qwerty",
  sound: "off",
  caret: "underline",
  hideTimer: false,
  hideLiveWpm: false,
  width: 1000,
  theme: null,
});

let cache = null;
function load() {
  if (!cache) {
    const saved = storeGet(KEY, {});
    cache = Object.assign({}, DEFAULTS, saved && typeof saved === "object" ? saved : {});
  }
  return cache;
}

export function get(k) {
  return load()[k];
}

export function all() {
  return Object.assign({}, load());
}

export function set(k, v) {
  const s = load();
  s[k] = v;
  storeSet(KEY, s);
  emit("settings:changed", { key: k, value: v });
  return v;
}

export function reset() {
  cache = Object.assign({}, DEFAULTS);
  storeSet(KEY, cache);
  emit("settings:changed", { key: null, value: null });
}

export const settings = { get, set, all, reset, DEFAULTS };
export default settings;
