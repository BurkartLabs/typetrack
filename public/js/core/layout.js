// Keyboard layouts: qwerty (hardware, no remap) plus six alternates. Pure data + pure functions
// (no DOM), so the remap tables are directly testable. keys.js calls remap(e, layoutName) to give
// handlers a wrapper event whose `key` matches the chosen layout for the physical key pressed
// (e.code never changes — only the letter/punctuation the layout puts there).
//
// Letter placement follows each layout's published standard. Punctuation/number-row placement is
// approximated onto the QWERTY physical slots (e.g. AZERTY's shifted digit row is not modelled) —
// good enough for typing practice, which is lowercase letters and spaces.

export const LAYOUTS = ["qwerty", "dvorak", "colemak", "colemak-dh", "workman", "azerty", "qwertz"];

export const LABELS = {
  qwerty: "QWERTY", dvorak: "Dvorak", colemak: "Colemak", "colemak-dh": "Colemak-DH",
  workman: "Workman", azerty: "AZERTY", qwertz: "QWERTZ",
};

const CODES_TOP = ["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight"];
const CODES_HOME = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote"];
const CODES_BOTTOM = ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash"];
const CODES_NUM = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0"];

const ROWS = {
  qwerty: { top: "q w e r t y u i o p [ ]", home: "a s d f g h j k l ; '", bottom: "z x c v b n m , . /" },
  dvorak: { top: "' , . p y f g c r l / =", home: "a o e u i d h t n s -", bottom: "; q j k x b m w v z" },
  colemak: { top: "q w f p g j l u y ; [ ]", home: "a r s t d h n e i o '", bottom: "z x c v b k m , . /" },
  "colemak-dh": { top: "q w f p b j l u y ; [ ]", home: "a r s t g m n e i o '", bottom: "z x c d v k h , . /" },
  workman: { top: "q d r w b j f u p ; [ ]", home: "a s h t g y n e o i '", bottom: "z x m c v k l , . /" },
  azerty: { top: "a z e r t y u i o p ^ $", home: "q s d f g h j k l m ù", bottom: "w x c v b n , ; : !" },
  qwertz: { top: "q w e r t z u i o p ü +", home: "a s d f g h j k l ö ä", bottom: "y x c v b n m , . -" },
};

function buildMap(codes, row) {
  const chars = row.split(" ");
  const m = {};
  codes.forEach((c, i) => { if (chars[i]) m[c] = chars[i]; });
  return m;
}

const MAPS = {};
for (const name of LAYOUTS) {
  if (name === "qwerty") continue; // hardware; no remap needed
  const r = ROWS[name];
  MAPS[name] = Object.assign({}, buildMap(CODES_TOP, r.top), buildMap(CODES_HOME, r.home), buildMap(CODES_BOTTOM, r.bottom));
}

const SHIFT_SYMBOLS = { ",": "<", ".": ">", "/": "?", ";": ":", "'": '"', "[": "{", "]": "}", "-": "_", "=": "+", "`": "~", "\\": "|" };
export function shiftChar(ch) {
  if (/^[a-z]$/i.test(ch)) return ch.toUpperCase();
  if (SHIFT_SYMBOLS[ch]) return SHIFT_SYMBOLS[ch];
  const upper = ch.toUpperCase();
  return upper !== ch ? upper : ch;
}

// The character a layout puts at a physical key (e.code), or null if this layout doesn't move it.
export function charFor(layoutName, code, shift) {
  const map = MAPS[layoutName];
  if (!map) return null;
  const base = map[code];
  if (base == null) return null;
  return shift ? shiftChar(base) : base;
}

// Wrap a keydown event so handlers see the remapped `key` and everything else unchanged. Returns
// the same event untouched for 'qwerty' or an unknown layout, or when this code isn't remapped.
export function remap(e, layoutName) {
  if (!layoutName || layoutName === "qwerty" || !MAPS[layoutName]) return e;
  const ch = charFor(layoutName, e.code, !!e.shiftKey);
  if (ch == null) return e;
  return new Proxy(e, {
    get(target, prop) {
      if (prop === "key") return ch;
      const v = target[prop];
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}

// Rows for an on-screen keyboard: [{code,label}] per row, number row first, then top/home/bottom.
// Labels use the layout's lower-case character; number row and other keys stay as printed on the
// physical (hardware) key since we don't model shifted-digit layouts.
export function keyboardRows(layoutName) {
  const qwertyTop = buildMap(CODES_TOP, ROWS.qwerty.top);
  const qwertyHome = buildMap(CODES_HOME, ROWS.qwerty.home);
  const qwertyBottom = buildMap(CODES_BOTTOM, ROWS.qwerty.bottom);
  const numRow = CODES_NUM.map((c, i) => ({ code: c, label: String((i + 1) % 10) }));
  const rowFor = (codes, qwertyMap) => codes.map((c) => ({ code: c, label: charFor(layoutName, c, false) || qwertyMap[c] }));
  return [numRow, rowFor(CODES_TOP, qwertyTop), rowFor(CODES_HOME, qwertyHome), rowFor(CODES_BOTTOM, qwertyBottom)];
}

export const layout = { LAYOUTS, LABELS, shiftChar, charFor, remap, keyboardRows };
export default layout;
