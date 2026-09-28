// Tiny event bus. on(event, fn) returns an off function; emit never throws.
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const set = listeners.get(event);
  if (set) set.delete(fn);
}

export function emit(event, data) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(data); } catch (err) { console.error(`[bus] ${event} listener failed`, err); }
  }
}

export const bus = { on, off, emit };
export default bus;
