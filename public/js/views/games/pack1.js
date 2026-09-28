// Game registry pack 1. Entries: { id, name, desc, tags: [], load: () => import('./<id>.js') }
// Shared code for these games: pack1-kit.js (shell, keys, stream), pack1-logic.js (pure maths, tested).
export default [
  { id: "sprint", name: "sprint", desc: "One short phrase, as fast as you can. Instant retry, chase your best.", tags: ["speed", "short"], load: () => import("./sprint.js") },
];
