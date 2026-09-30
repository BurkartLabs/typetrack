// Module entry: header nav, auth slot, settings application, router boot.
import routes from "./routes.js";
import { createRouter, parseHash } from "./core/router.js";
import keys from "./core/keys.js";
import bus from "./core/bus.js";
import store from "./core/store.js";
import settings from "./core/settings.js";
import api from "./core/api.js";
import auth from "./core/auth.js";
import words from "./core/words.js";
import { esc } from "./core/ui.js";
import "./core/sync.js";
import "./core/gamify.js";
import theme from "./core/theme.js";
import "./core/sound.js"; // side effect only: listens for bus 'key' events, plays click/error sounds

const navMain = document.getElementById("nav-main");
const navRight = document.getElementById("nav-right");
const authSlot = document.getElementById("auth-slot");

// v1 used #test / #stats; rewrite to #/test before the router reads it.
if (location.hash && !location.hash.startsWith("#/") && parseHash(location.hash).segments.length) {
  history.replaceState(null, "", "#/" + location.hash.replace(/^#\/?/, ""));
}

function navLinks(where) {
  return routes.filter((r) => r.nav === where)
    .map((r) => `<a href="#/${r.path}" data-nav="${esc(r.path)}">${esc(r.title || r.path)}</a>`).join("");
}
navMain.innerHTML = navLinks("main");
navRight.innerHTML = navLinks("right");

function markNav(route) {
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === route.path));
}

function renderAuth(user) {
  if (user) {
    authSlot.innerHTML = `<a class="auth-user" href="#/profile/${encodeURIComponent(user.name)}" title="your profile">${esc(user.name)}</a>` +
      `<button class="auth-out" type="button">sign out</button>`;
    authSlot.querySelector(".auth-out").addEventListener("click", async () => {
      await auth.logout();
      router.navigate("#/test");
    });
  } else {
    authSlot.innerHTML = `<a class="auth-in" href="#/login" data-nav="login">sign in</a>`;
  }
}

// Typing width + theme (colours and font) from settings. theme.apply() writes CSS vars on :root;
// canvas charts read them via css.js#cssVar, so they follow with no extra wiring.
function applySettings() {
  const root = document.documentElement;
  const width = Number(settings.get("width"));
  if (width) root.style.setProperty("--typing-width", width + "px");
  theme.apply(settings.get("theme"));
}

// Signed-in users' results also go to the server (it re-derives wpm from the log).
bus.on("result:saved", (r) => {
  if (!auth.user || !Array.isArray(r.log) || !r.log.length) return;
  api.post("/api/results", r).catch(() => { /* offline: the local copy is kept */ });
});
bus.on("auth:changed", renderAuth);
// Signing in or out changes whose progress every page shows (store.js), so the page on screen is drawn again.
bus.on("auth:changed", () => router.start());
bus.on("settings:changed", applySettings);

const router = createRouter({
  routes,
  root: document.getElementById("app"),
  ctxBase: { keys, bus, store, settings, api, auth, words },
  onRoute: markNav,
});

applySettings();
renderAuth(null);
router.start();
auth.refresh();
