// Game registry pack 3. Entries: { id, name, desc, tags: [], load: () => import('./<id>.js') }
// Shared helpers for these games live in ./pack3-kit.js; styles in css/games-pack3.css.
export default [
  { id: "ghost-race", name: "ghost race", desc: "Race a replay of a run, keystroke by keystroke: your personal best, any recent run, or another player's.", tags: ["ghost", "online"], load: () => import("./ghost-race.js") },
  { id: "ghost-league", name: "ghost league", desc: "Ten of your own runs at once. Finish as high in the pack as you can.", tags: ["ghost"], load: () => import("./ghost-league.js") },
];
