// Create-account page (#/register). On success the server has made the account (active immediately);
// the user signs in on #/login?registered=1.
import { loadCss } from '../core/css.js';
import { postJson, setMsg } from './login.js';

const NAME_RE = /^[A-Za-z0-9_-]{2,24}$/;
let alive = false;

function check(f) {
  if (!NAME_RE.test(f.name)) return 'name: 2-24 letters, digits, _ or -';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) return 'enter a valid email';
  if (f.password.length < 8) return 'password must be at least 8 characters';
  if (f.password !== f.confirm) return 'passwords do not match';
  return null;
}

export default {
  mount(root, ctx) {
    alive = true;
    loadCss('css/auth.css');
    root.innerHTML = `
      <section class="auth">
        <h1 class="auth-title">create account</h1>
        <p class="auth-msg" data-msg hidden></p>
        <form class="auth-form" novalidate>
          <label class="auth-field"><span>name</span>
            <input name="username" autocomplete="username" required minlength="2" maxlength="24"
              pattern="[A-Za-z0-9_\\-]{2,24}" spellcheck="false" autofocus></label>
          <label class="auth-field"><span>email</span>
            <input name="email" type="email" autocomplete="email" required maxlength="254"></label>
          <label class="auth-field"><span>password</span>
            <input name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="256"></label>
          <label class="auth-field"><span>confirm password</span>
            <input name="confirm" type="password" autocomplete="new-password" required minlength="8" maxlength="256"></label>
          <button class="auth-submit" type="submit">create account</button>
        </form>
        <p class="auth-alt">have an account? <a href="#/login">sign in</a></p>
      </section>`;
    const form = root.querySelector('form');
    const msg = root.querySelector('[data-msg]');
    const btn = root.querySelector('.auth-submit');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = {
        name: form.username.value.trim(),
        email: form.email.value.trim(),
        password: form.password.value,
        confirm: form.confirm.value,
      };
      const problem = check(f);
      if (problem) return setMsg(msg, problem, 'error');
      btn.disabled = true;
      setMsg(msg, 'creating account…', 'busy');
      const r = await postJson('/api/register', { name: f.name, email: f.email, password: f.password });
      if (!alive) return;
      btn.disabled = false;
      if (!r.ok) return setMsg(msg, r.error, 'error');
      ctx.navigate('#/login?registered=1');
    });
  },
  unmount() {
    alive = false;
  },
};
