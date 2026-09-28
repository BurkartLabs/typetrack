// Blind run: nothing shows right or wrong until the end; the result reveals every error.
import { surfaceDrill } from "./surface.js";

export default surfaceDrill({
  id: "blind",
  title: "blind run",
  sub: "no red letters, no second-guessing. type through; the errors are revealed at the end.",
  groups: [{ k: "count", options: [[25, "25"], [50, "50"], [100, "100"]] }],
  defaults: { count: 50 },
  opts: (cfg, pool) => ({ words: pool, mode: "words", wordCount: cfg.count, blind: true }),
});
