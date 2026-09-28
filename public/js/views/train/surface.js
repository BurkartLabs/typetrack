// A drill that is the plain typing surface with options (blind, mirror/scrambled): config groups,
// then a result with tiles and the full reveal of every word.
import { createTyping } from "../../core/typing.js";
import { esc } from "../../core/ui.js";
import { drillPage, loadPool, group, SEP, bindConfig, tiles, review, actions, note, save, langName } from "./shell.js";

// spec: { id, title, sub, groups: [{k, options:[[v, label]]}], defaults, opts(cfg, pool) -> typing options,
//         extra?(r, cfg) -> fields to save, resultNote?(cfg) }
export function surfaceDrill(spec) {
  let typing = null;

  async function mount(root, ctx) {
    const { store, settings } = ctx;
    const lang = settings.get("lang") || "en";
    const key = "train." + spec.id;
    const cfg = Object.assign({}, spec.defaults, store.get(key, {}));
    const el = drillPage(root, {
      title: spec.title, sub: spec.sub,
      config: spec.groups.map((g) => group(g.k, g.options, cfg[g.k])).join(SEP),
    });
    const { common, missing } = await loadPool(ctx.words, lang, { rare: false });
    if (!root.isConnected) return;
    if (missing) note(el, `no word list for ${esc(langName(lang))} yet, so these are english words.`);

    function newRound() {
      el.result.hidden = true;
      el.typing.hidden = false;
      typing.restart(spec.opts(cfg, common));
    }

    typing = createTyping(el.typing, Object.assign({ lang }, spec.opts(cfg, common), {
      onRestart: newRound,
      onFinish(r) {
        save(store, r, spec.id, lang, spec.extra ? spec.extra(r, cfg) : null);
        const t = typing.test;
        const errs = r.chars.incorrect + r.chars.extra + r.chars.missed;
        el.typing.hidden = true;
        el.result.hidden = false;
        el.result.innerHTML = tiles([["wpm", Math.round(r.wpm)], ["acc", Math.round(r.acc) + "%"],
          ["raw", Math.round(r.raw)], ["errors", errs]]) +
          `<div class="err-block"><span class="label">${errs ? "your run, errors marked" : "your run: clean"}</span>${review(t.words, t.typed)}</div>` +
          actions();
      },
    }));

    el.result.addEventListener("click", (e) => { if (e.target.closest("[data-act=next]")) newRound(); });
    bindConfig(el.config, (k, v) => {
      cfg[k] = /^\d+$/.test(v) ? Number(v) : v;
      store.set(key, cfg);
      newRound();
    });
  }

  function unmount() {
    if (typing) typing.destroy();
    typing = null;
  }

  return { mount, unmount };
}
