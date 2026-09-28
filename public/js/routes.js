// THE route registry. Order of nav:'main' entries is the order of the header nav.
// { path, title, nav?: 'main'|'right'|false, load: () => import('./views/x.js') }
// Contributors: replace your placeholder entry, or append; keep each entry on its own lines.
export default [
  { path: "test", title: "test", nav: "main", load: () => import("./views/test.js") },
  { path: "train", title: "train", nav: "main", load: () => import("./views/placeholder.js") },
  { path: "games", title: "games", nav: "main", load: () => import("./views/games.js") },
  { path: "stats", title: "stats", nav: "main", load: () => import("./views/stats.js") },
  { path: "leaderboard", title: "leaderboard", nav: "main", load: () => import("./views/placeholder.js") },
  { path: "profile", title: "profile", nav: "main", load: () => import("./views/placeholder.js") },
  { path: "settings", title: "settings", nav: "right", load: () => import("./views/settings.js") },
  { path: "login", title: "sign in", nav: false, load: () => import("./views/login.js") },
  { path: "register", title: "register", nav: false, load: () => import("./views/register.js") },
  { path: "tools", title: "tools", nav: false, load: () => import("./views/tools.js") },
];
