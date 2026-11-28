// Accounts: pick a username + password once, then play from any browser.
// The session is remembered on this device, so players only log in again on a new one.

import { h, esc, fmt } from './util.js?v=e08da9841def';
import { icon } from './icons.js?v=e08da9841def';
import { engine, MODE } from './engine.js?v=e08da9841def';
import { store } from './store.js?v=e08da9841def';
import { sfx } from './sound.js?v=e08da9841def';
import { toast } from './ui.js?v=e08da9841def';

const USER_RE = /^[A-Za-z0-9_]{3,16}$/;

function message(r) {
  switch (r?.error) {
    case 'bad_username':
      return 'Usernames are 3–16 letters, numbers or underscores.';
    case 'bad_password':
      return 'Passwords need at least 6 characters.';
    case 'taken':
      return 'That username is taken. Pick another, or log in if it’s yours.';
    case 'too_many_signups':
      return 'Too many new accounts from your network today. Log in instead, or try again tomorrow.';
    case 'bad_login':
      return 'Wrong username or password.';
    case 'locked':
      return `Too many wrong passwords. Try again in ${Math.max(1, Math.ceil((r.wait || 60) / 60))} min.`;
    case 'network':
      return 'Can’t reach the casino. Check your connection and try again.';
    case 'not_installed':
      return 'The casino server isn’t set up yet. (Owner: run supabase/schema.sql.)';
    default:
      return 'Something went wrong. Try again in a moment.';
  }
}

let current = null;

/**
 * Sign-up / log-in sheet. Resolves true once the player is signed in.
 * @param {{mode?: 'signup'|'login', reason?: string}} opts
 */
export function openAccount({ mode = 'signup', reason = '' } = {}) {
  if (store.signedIn) return Promise.resolve(true);
  if (current) {
    current.focus();
    return current.promise;
  }
  let resolveFn;
  const promise = new Promise((r) => (resolveFn = r));
  const root = h(`
    <div class="modal-root acct-root" role="dialog" aria-modal="true" aria-labelledby="acct-title">
      <div class="modal-scrim"></div>
      <div class="modal acct">
        <button class="icon-btn close-x" type="button" aria-label="Close">${icon('close')}</button>
        <div class="acct-card" aria-hidden="true">
          <span class="acct-chip chip-ico lg"></span>
          <span class="acct-neon neon">MEMBERS</span>
          <span class="acct-no tnum">Nº ${String(Math.floor(1000 + Math.random() * 9000))}</span>
        </div>
        <h2 id="acct-title" data-title></h2>
        <p class="acct-lede" data-lede></p>
        <div class="seg acct-tabs" role="tablist">
          <button type="button" role="tab" data-mode="signup">New player</button>
          <button type="button" role="tab" data-mode="login">I have an account</button>
        </div>
        <form class="acct-form" novalidate autocomplete="on">
          <label class="field">
            <span class="field-label"><span>Username</span><span class="dim" data-uhint>3–16 letters, numbers, _</span></span>
            <span class="input-group acct-input">${icon('at')}<input name="username" type="text" inputmode="text" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="16" required placeholder="highroller_22"></span>
          </label>
          <label class="field">
            <span class="field-label"><span>Password</span><span class="dim">6+ characters</span></span>
            <span class="input-group acct-input">${icon('lock')}<input name="password" type="password" autocomplete="new-password" maxlength="72" required placeholder="••••••••"><button type="button" class="mini acct-eye" data-eye aria-label="Show password">${icon('eye')}</button></span>
          </label>
          <p class="acct-err" role="alert" aria-live="assertive"></p>
          <button type="submit" class="btn btn-primary btn-block btn-lg acct-go"><span data-go></span></button>
        </form>
        <ul class="acct-perks">
          <li>${icon('shield')}<span><strong>Your chips follow you.</strong> Log in on any phone or computer with the same username.</span></li>
          <li>${icon('refresh')}<span><strong>No resets.</strong> Clearing your browser history can’t wipe or refill your stack.</span></li>
          <li>${icon('trophy')}<span><strong>On the board.</strong> Your username shows on the live leaderboard.</span></li>
        </ul>
        ${MODE === 'device' ? `<p class="acct-note">${icon('device')}<span>Offline mode: the casino server isn’t connected yet, so this account is saved on this device only.</span></p>` : ''}
      </div>
    </div>`);
  const title = root.querySelector('[data-title]');
  const lede = root.querySelector('[data-lede]');
  const form = root.querySelector('form');
  const user = form.elements.username;
  const pass = form.elements.password;
  const errEl = root.querySelector('.acct-err');
  const go = root.querySelector('.acct-go');
  const goLabel = root.querySelector('[data-go]');
  const tabs = [...root.querySelectorAll('[data-mode]')];
  let busy = false;

  const setMode = (m) => {
    mode = m;
    tabs.forEach((t) => {
      t.setAttribute('aria-pressed', String(t.dataset.mode === m));
      t.setAttribute('aria-selected', String(t.dataset.mode === m));
    });
    title.textContent = m === 'signup' ? 'Grab a seat' : 'Welcome back';
    lede.textContent =
      reason ||
      (m === 'signup' ? 'Pick a username to play. New players start with 1,000 chips, saved to your name.' : 'Log in to pick up your stack where you left it, on this browser or any other.');
    goLabel.textContent = m === 'signup' ? 'Create account · 1,000 chips' : 'Log in';
    pass.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    root.querySelector('[data-uhint]').hidden = m !== 'signup';
    errEl.textContent = '';
  };
  setMode(mode);

  const close = (ok = false) => {
    if (!current) return;
    current = null;
    root.classList.add('is-closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 240);
    resolveFn(ok);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !busy) close(false);
  };
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-scrim').addEventListener('click', () => !busy && close(false));
  root.querySelector('.close-x').addEventListener('click', () => !busy && close(false));
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      if (busy) return;
      sfx.click();
      setMode(t.dataset.mode);
      user.focus();
    }),
  );
  root.querySelector('[data-eye]').addEventListener('click', (e) => {
    const shown = pass.type === 'text';
    pass.type = shown ? 'password' : 'text';
    e.currentTarget.innerHTML = icon(shown ? 'eye' : 'eyeOff');
    e.currentTarget.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
  });
  user.addEventListener('input', () => {
    const v = user.value.replace(/[^A-Za-z0-9_]/g, '');
    if (v !== user.value) user.value = v;
    errEl.textContent = '';
  });
  pass.addEventListener('input', () => (errEl.textContent = ''));

  const fail = (text, field) => {
    errEl.textContent = text;
    const g = (field || form).closest?.('.input-group') || form;
    g.classList.remove('is-error');
    void g.offsetWidth;
    g.classList.add('is-error');
    sfx.lose();
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    const u = user.value.trim();
    const p = pass.value;
    if (mode === 'signup' && !USER_RE.test(u)) return fail(message({ error: 'bad_username' }), user);
    if (!u) return fail('Type your username.', user);
    if (mode === 'signup' && p.length < 6) return fail(message({ error: 'bad_password' }), pass);
    if (!p) return fail('Type your password.', pass);
    busy = true;
    go.disabled = true;
    goLabel.innerHTML = `<span class="spinner" style="display:inline-block;vertical-align:-5px;border-top-color:var(--ink-on-gold)"></span>`;
    const r = mode === 'signup' ? await engine.signup(u, p) : await engine.login(u, p);
    busy = false;
    go.disabled = false;
    setMode(mode);
    if (!r?.ok) {
      if (r?.error === 'taken') fail(message(r), user);
      else if (r?.error === 'bad_login' || r?.error === 'bad_password') fail(message(r), pass);
      else fail(message(r));
      return;
    }
    store.load(r.me);
    sfx.jackpot();
    close(true);
    import('./fx.js?v=e08da9841def').then(({ coinRain }) => coinRain(mode === 'signup' ? 110 : 40));
    if (mode === 'signup') toast(`Welcome, ${r.me.username}! ${fmt(r.me.balance).replace(/\.00$/, '')} chips are on the house.`, { type: 'win', iconName: 'sparkle', timeout: 4600 });
    else toast(`Welcome back, ${r.me.username}. Your stack: ${fmt(r.me.balance)}.`, { type: 'win', iconName: 'coins', timeout: 4200 });
  });

  document.body.append(root);
  current = { promise, focus: () => user.focus() };
  setTimeout(() => user.focus(), 60);
  return promise;
}

/** Ask for an account before a bet. Returns true when the player may bet. */
export function needAccount() {
  if (store.signedIn) return true;
  openAccount({ reason: 'Make a username to start betting. New players get 1,000 chips, saved to your name on any browser.' });
  return false;
}

export async function signOut() {
  await engine.logout();
  store.signOut();
  toast('Signed out. Your chips are safe on your account.', { iconName: 'logout' });
}

export const accountName = () => (store.username ? esc(store.username) : '');
