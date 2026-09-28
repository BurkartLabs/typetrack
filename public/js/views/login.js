// Sign-in page (#/login). Talks to POST /api/login directly so it can tell "wrong password" from
// "server offline", then lets core/auth.js pick up the new session.
import { auth } from '../core/auth.js';
import { loadCss } from '../core/css.js';

let alive = false;

export default {
  mount(root, ctx) {
    alive = true;
    loadCss('css/auth.css');
    root.innerHTML = `
      <section class="auth">
        <h1 class="auth-title">sign in</h1>
        <p class="auth-msg" data-msg hidden></p>
        <form class="auth-form" novalidate>
          <label class="auth-field"><span>email</span>
            <input name="email" type="email" autocomplete="email" required maxlength="254" autofocus></label>
          <label class="auth-field"><span>password</span>
            <input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
          <button class="auth-submit" type="submit">sign in</button>
        </form>
        <p class="auth-alt">no account? <a href="#/register">create one</a></p>
      </section>`;
    const form = root.querySelector('form');
    const msg = root.querySelector('[data-msg]');
    const btn = root.querySelector('.auth-submit');

    if (queryValue(ctx, 'registered')) setMsg(msg, 'account created — sign in', 'ok');
    else if (auth && auth.user) setMsg(msg, `signed in as ${auth.user.name}`, 'ok');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      const password = form.password.value;
      if (!email || !password) return setMsg(msg, 'enter your email and password', 'error');
      btn.disabled = true;
      setMsg(msg, 'signing in…', 'busy');
      const r = await postJson('/api/login', { email, password });
      if (!alive) return;
      btn.disabled = false;
      if (!r.ok) return setMsg(msg, r.error, 'error');
      try {
        if (auth && typeof auth.refresh === 'function') await auth.refresh();
      } catch { /* the session cookie is set either way */ }
      if (alive) ctx.navigate('#/test');
    });
  },
  unmount() {
    alive = false;
  },
};

// Shared with register.js.
// POST JSON; resolves {ok:true, data} or {ok:false, error} with a message fit to show the user.
// A network failure, or a response that is not the API's JSON (a static host with no server), is "server offline".
export async function postJson(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: 'server offline — try again later' };
  }
  let data = null;
  try {
    data = await res.json();
  } catch { /* not JSON */ }
  if (res.ok && data) return { ok: true, data };
  if (!data || typeof data.error !== 'string' || res.status >= 502) {
    return { ok: false, error: 'server offline — try again later' };
  }
  if (res.status === 429) return { ok: false, error: 'too many attempts — wait a minute' };
  return { ok: false, error: data.error };
}

// ctx.query may be a plain object or URLSearchParams.
export function queryValue(ctx, key) {
  const q = ctx && ctx.query;
  if (!q) return null;
  return typeof q.get === 'function' ? q.get(key) : q[key];
}

export function setMsg(el, text, kind) {
  el.textContent = text;
  el.className = `auth-msg ${kind || ''}`;
  el.hidden = !text;
}
