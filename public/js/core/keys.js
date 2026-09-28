// The single keydown listener. A view (or the typing surface) makes itself the active handler with
// keys.set(handler); the returned remover only clears it if it is still the active one.
let active = null;

function onKeydown(e) {
  if (!active) return;
  try { active(e); } catch (err) { console.error("[keys] handler failed", err); }
}

if (typeof document !== "undefined") document.addEventListener("keydown", onKeydown);

export function set(handler) {
  active = handler || null;
  return () => { if (active === handler) active = null; };
}

export function clear() {
  active = null;
}

export function current() {
  return active;
}

// True when the event comes from a text field, so typing handlers can leave it alone.
export function inField(e) {
  const t = e && e.target;
  if (!t || !t.tagName) return false;
  return !!t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
}

export const keys = { set, clear, current, inField };
export default keys;
