// Mirror mode: words drawn reversed (type them forwards), or scrambled letters (type what you see).
// Both break autopilot: you read letter by letter instead of by word shape.
import { surfaceDrill } from "./surface.js";
import { scramble } from "./lib.js";

export default surfaceDrill({
  id: "mirror",
  title: "mirror mode",
  sub: "reversed: each word is drawn backwards, type it forwards. scrambled: type the letters as shown.",
  groups: [
    { k: "variant", options: [["reversed", "reversed"], ["scrambled", "scrambled"]] },
    { k: "duration", options: [[15, "15"], [30, "30"], [60, "60"]] },
  ],
  defaults: { variant: "reversed", duration: 30 },
  opts(cfg, pool) {
    const scrambled = cfg.variant === "scrambled";
    return {
      words: scrambled ? pool.filter((w) => w.length > 2).map((w) => scramble(w)) : pool,
      mode: "time", duration: cfg.duration, mirror: !scrambled,
    };
  },
  extra: (r, cfg) => ({ variant: cfg.variant }),
});
