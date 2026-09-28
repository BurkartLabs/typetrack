// Game registry pack 2 (canvas games). Entries: { id, name, desc, tags: [], load: () => import('./<id>.js') }
export default [
  { id: "falling-words", name: "falling words", desc: "Elite tier: words rain faster and faster. Lock on, clear them, keep three lives.", tags: ["arcade", "speed"], load: () => import("./falling-words.js") },
  { id: "typing-racer", name: "typing racer", desc: "Your live wpm drives the car. Beat three rivals set to your PB, PB+10 and PB-10.", tags: ["race", "pb"], load: () => import("./typing-racer.js") },
  { id: "laser-defense", name: "laser defense", desc: "Drones carry words at your base. Type to lock on, finish to fire. Elites carry long words. Waves, three hits.", tags: ["arcade", "waves"], load: () => import("./laser-defense.js") },
  { id: "boss-fight", name: "boss fight", desc: "Your live wpm is your damage. Pauses and errors let it heal; at 66% and 33% the text gets harder. Lower time wins.", tags: ["boss", "speed"], order: "asc", unit: "s", load: () => import("./boss-fight.js") },
];
