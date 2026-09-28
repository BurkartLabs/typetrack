// Game registry pack 1. Entries: { id, name, desc, tags: [], load: () => import('./<id>.js') }
// Shared code for these games: pack1-kit.js (shell, keys, stream), pack1-logic.js (pure maths, tested).
export default [
  { id: "sprint", name: "sprint", desc: "One short phrase, as fast as you can. Instant retry, chase your best.", tags: ["speed", "short"], load: () => import("./sprint.js") },
  { id: "treadmill", name: "treadmill", desc: "A pace wall from 80 wpm, +5 every 10 seconds. Stay ahead of it.", tags: ["speed", "stamina"], load: () => import("./treadmill.js") },
  { id: "word-bomb", name: "word bomb", desc: "Every word on a fuse set to your average speed. Three lives.", tags: ["speed", "pressure"], load: () => import("./word-bomb.js") },
  { id: "word-ladder", name: "word ladder", desc: "Each rung's window is 3% shorter. One miss and you fall.", tags: ["speed", "pressure"], load: () => import("./word-ladder.js") },
  { id: "survival", name: "survival", desc: "Endless words. One wrong key ends it.", tags: ["accuracy", "stamina"], load: () => import("./survival.js") },
];
