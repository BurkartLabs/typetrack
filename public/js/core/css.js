// Views load their own stylesheet. Idempotent; resolves when loaded (or failed), so a view can await it.
const loaded = new Map();

export function loadCss(href) {
  const url = new URL(href, document.baseURI).href;
  if (loaded.has(url)) return loaded.get(url);
  const existing = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href === url);
  const p = new Promise((resolve) => {
    if (existing) return resolve();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = url;
    link.onload = () => resolve();
    link.onerror = () => { console.warn("[css] could not load", url); resolve(); };
    document.head.appendChild(link);
  });
  loaded.set(url, p);
  return p;
}

// Read a CSS custom property from :root (never hard-code colours in JS).
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default loadCss;
