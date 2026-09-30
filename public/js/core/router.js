// Hash router: #/<path>[/<sub>...][?query]. The parsing half is pure (tested in node); createRouter
// needs a DOM.
//
// A route is { path, title, nav?, load }. path may have ':name' segments ("profile/:name"). A route
// matches when all of its segments match the start of the hash; the remaining segments become
// params.sub ("a/b") and params.parts (["a", "b"]). The route with the most matching segments wins,
// literal segments beating ':params'.

export const DEFAULT_PATH = "test";

export function parseHash(hash) {
  let s = String(hash || "").replace(/^#/, "").replace(/^\/+/, "");
  let query = {};
  const qi = s.indexOf("?");
  if (qi >= 0) {
    query = Object.fromEntries(new URLSearchParams(s.slice(qi + 1)));
    s = s.slice(0, qi);
  }
  const segments = s.split("/").filter(Boolean).map((x) => {
    try { return decodeURIComponent(x); } catch { return x; }
  });
  return { segments, query };
}

export function matchRoute(routes, segments) {
  let best = null;
  for (const route of routes) {
    const parts = String(route.path).split("/").filter(Boolean);
    if (parts.length === 0 || parts.length > segments.length) continue;
    const params = {};
    let score = 0, ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(":")) { params[parts[i].slice(1)] = segments[i]; score += 1; }
      else if (parts[i] === segments[i]) score += 2;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (!best || score > best.score) {
      const rest = segments.slice(parts.length);
      params.parts = rest;
      params.sub = rest.length ? rest.join("/") : undefined;
      best = { route, params, score };
    }
  }
  return best && { route: best.route, params: best.params };
}

export function buildHash(path, query) {
  const q = query && Object.keys(query).length ? "?" + new URLSearchParams(query).toString() : "";
  return "#/" + String(path).replace(/^#?\/*/, "") + q;
}

// ctxBase: { keys, bus, store, settings, api, auth, words } — params, query, navigate, route are added.
export function createRouter({ routes, root, ctxBase = {}, onRoute, defaultPath = DEFAULT_PATH }) {
  let current = null; // { view, route }
  let token = 0;

  function navigate(hash, { replace = false } = {}) {
    const target = hash.startsWith("#") ? hash : buildHash(hash);
    if (replace) {
      history.replaceState(null, "", target);
      resolve();
    } else if (location.hash === target) {
      resolve();
    } else {
      location.hash = target;
    }
  }

  async function unmountCurrent() {
    const prev = current;
    current = null;
    if (ctxBase.keys) ctxBase.keys.clear();
    if (prev && prev.view && typeof prev.view.unmount === "function") {
      try { await prev.view.unmount(); } catch (err) { console.error("[router] unmount failed", err); }
    }
    document.body.classList.remove("typing-active");
    root.replaceChildren();
  }

  async function resolve() {
    const my = ++token;
    const { segments, query } = parseHash(location.hash);
    if (!segments.length) return navigate(buildHash(defaultPath), { replace: true });
    const m = matchRoute(routes, segments);
    if (!m) return navigate(buildHash(defaultPath), { replace: true });

    await unmountCurrent();
    if (my !== token) return;
    document.title = (m.route.title ? m.route.title + " · " : "") + "typetrack";
    if (onRoute) onRoute(m.route, m.params);

    let view;
    try {
      const mod = await m.route.load();
      view = mod && (mod.default || mod);
      if (!view || typeof view.mount !== "function") throw new Error("module has no mount()");
    } catch (err) {
      if (my !== token) return;
      console.error(`[router] could not load ${m.route.path}`, err);
      root.replaceChildren(errorView(m.route));
      return;
    }
    if (my !== token) return;
    current = { view, route: m.route };
    const ctx = Object.assign({}, ctxBase, { params: m.params, query, navigate, route: m.route });
    try {
      await view.mount(root, ctx);
    } catch (err) {
      console.error(`[router] mount failed for ${m.route.path}`, err);
      if (my === token) root.replaceChildren(errorView(m.route, true));
    }
  }

  function errorView(route, crashed) {
    const box = document.createElement("div");
    box.className = "notice";
    const title = document.createElement("div");
    title.className = "notice-title";
    title.textContent = crashed ? "something went wrong" : "this page isn't here yet";
    const p = document.createElement("p");
    p.textContent = crashed
      ? `the ${route.title || route.path} page hit an error. try reloading.`
      : `the ${route.title || route.path} page could not be loaded.`;
    const a = document.createElement("a");
    a.href = "#/test";
    a.textContent = "back to the test";
    box.append(title, p, a);
    return box;
  }

  window.addEventListener("hashchange", resolve);
  return { start: resolve, navigate, get current() { return current; } };
}

export default { parseHash, matchRoute, buildHash, createRouter };
