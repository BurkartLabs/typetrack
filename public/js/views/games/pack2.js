// Game registry pack 2 (canvas games). Entries: { id, name, desc, tags: [], load: () => import('./<id>.js') }
export default [
  { id: "falling-words", name: "falling words", desc: "Elite tier: words rain faster and faster. Lock on, clear them, keep three lives.", tags: ["arcade", "speed"], load: () => import("./falling-words.js") },
];
