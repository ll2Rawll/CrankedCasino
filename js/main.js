// App shell: header, wallet, drawer, theme, footer and the hash router.

import { $, $$, h, esc, fmt, signed, storage, countdown } from './util.js';
import { icon } from './icons.js';
import { store, on, DAILY_BONUS } from './store.js';
import { cloud, syncLabel } from './cloud.js';
import { CONFIG } from './config.js';
import { sfx, unlockAudio, setSound, soundOn } from './sound.js';
import { countTo, floatFrom, burstAt, PALETTES } from './fx.js';
import { toast, confirmDialog } from './ui.js';

const app = $('#app');
const root = document.documentElement;

// A skipped view transition (e.g. fast navigation) rejects its promises; that's expected.
function quiet(vt) {
  vt?.ready?.catch(() => {});
  vt?.finished?.catch(() => {});
  vt?.updateCallbackDone?.catch(() => {});
  return vt;
}

// ---------------------------------------------------------------- theme
function applyTheme(theme) {
  root.dataset.theme = theme;
  storage.set('cc:theme', theme);
  $('#themeBtn').innerHTML = theme === 'dark' ? icon('sun') : icon('moon');
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#08080a' : '#eeebe5';
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}
applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
$('#themeBtn').addEventListener('click', () => {
  sfx.click();
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    quiet(document.startViewTransition(() => applyTheme(next)));
  } else applyTheme(next);
  renderDrawer();
});

// ---------------------------------------------------------------- balance pill
const balBtn = $('#balanceBtn');
const balNum = $('#balanceNum');
let shownBalance = store.balance;
let stopCount = () => {};
let flashTimer = 0;
balNum.textContent = fmt(shownBalance);

on('balance', ({ delta, balance, silent }) => {
  stopCount();
  const from = shownBalance;
  shownBalance = balance;
  stopCount = countTo(balNum, from, balance, { duration: silent ? 1 : 650 });
  if (silent || !delta) return;
  balBtn.classList.remove('is-up', 'is-down');
  void balBtn.offsetWidth;
  balBtn.classList.add(delta > 0 ? 'is-up' : 'is-down');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => balBtn.classList.remove('is-up', 'is-down'), 700);
  if (delta > 0) floatFrom(balBtn, signed(delta), 'var(--win)');
  if (!$('#wallet').hidden) renderWallet();
});

// ---------------------------------------------------------------- wallet popover
const wallet = $('#wallet');
let walletTimer = 0;
function renderWallet() {
  const st = store.state.stats;
  const wait = store.dailyReadyIn();
  const sync = syncLabel();
  wallet.innerHTML = `
    <div class="wallet-bal"><span class="chip-ico lg"></span><div><div class="dim" style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Balance</div><div class="big tnum">${fmt(store.balance)}</div></div></div>
    ${
      store.canRefill()
        ? `<button class="btn btn-primary btn-block" data-act="refill">${icon('refresh')}<span>Out of chips? Refill to 1,000</span></button>`
        : ''
    }
    <button class="btn ${wait ? 'btn-outline' : 'btn-primary'} btn-block" data-act="daily" ${wait ? 'disabled' : ''}>
      ${icon('gift')}<span>${wait ? `Daily bonus in ${countdown(wait)}` : `Claim daily bonus · +${fmt(DAILY_BONUS)}`}</span>
    </button>
    <div class="wallet-meta">
      <div><span>Wagered</span><strong>${fmt(st.wagered)}</strong></div>
      <div><span>Net profit</span><strong class="${st.profit >= 0 ? 'win-text' : 'loss-text'}">${signed(st.profit)}</strong></div>
      <div><span>Biggest win</span><strong>${fmt(st.biggestWin)}</strong></div>
      <div><span>Bets played</span><strong>${st.bets.toLocaleString('en-US')}</strong></div>
    </div>
    <div class="wallet-sync">${icon(sync.icon)}<span>${sync.text}</span></div>
    <a class="link-arrow" href="#/profile" data-act="profile">Your profile & stats ${icon('arrowRight')}</a>`;
}
function openWallet() {
  renderWallet();
  wallet.hidden = false;
  clearInterval(walletTimer);
  walletTimer = setInterval(() => store.dailyReadyIn() > 0 && renderWallet(), 1000);
}
function closeWallet() {
  wallet.hidden = true;
  clearInterval(walletTimer);
}
balBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.click();
  wallet.hidden ? openWallet() : closeWallet();
});
wallet.addEventListener('click', (e) => {
  e.stopPropagation();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'daily' && store.claimDaily()) {
    sfx.win(2);
    burstAt(e.target.closest('button'), { count: 70, colors: PALETTES.gold });
    toast(`+${fmt(DAILY_BONUS)} chips. See you tomorrow!`, { type: 'win', iconName: 'gift' });
    renderWallet();
  }
  if (act === 'refill' && store.refill()) {
    sfx.cashout();
    toast('Topped back up to 1,000 chips.', { type: 'win', iconName: 'coins' });
    renderWallet();
  }
  if (act === 'profile') closeWallet();
});
document.addEventListener('click', (e) => {
  if (!wallet.hidden && !wallet.contains(e.target)) closeWallet();
});

// ---------------------------------------------------------------- github button
const ghBtn = $('#ghBtn');
const syncDot = $('#syncDot');
function renderAuth() {
  const u = cloud.user;
  if (u) {
    ghBtn.innerHTML = u.avatar
      ? `<img class="avatar" src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">`
      : icon('user');
    ghBtn.setAttribute('aria-label', `Signed in as @${u.login}. Open menu`);
  } else {
    ghBtn.innerHTML = icon('github');
    ghBtn.setAttribute('aria-label', 'Sign in with GitHub');
  }
  syncDot.dataset.state = u ? cloud.status : '';
  syncDot.title = syncLabel().text.replace(/<[^>]+>/g, '');
  if (!wallet.hidden) renderWallet();
  renderDrawer();
}
ghBtn.addEventListener('click', () => {
  sfx.click();
  if (cloud.user) openDrawer();
  else cloud.signIn();
});
cloud.onChange(renderAuth);

// ---------------------------------------------------------------- drawer
const drawer = $('#drawer');
const drawerPanel = $('.drawer-panel', drawer);
const menuBtn = $('#menuBtn');
menuBtn.innerHTML = icon('menu');
const NAV = [
  ['', 'Lobby'],
  ['mines', 'Mines'],
  ['plinko', 'Plinko'],
  ['slots', 'Slots'],
  ['crash', 'Crash'],
  ['leaderboard', 'Leaderboard'],
  ['profile', 'Profile'],
];
function renderDrawer() {
  const u = cloud.user;
  const sync = syncLabel();
  const route = currentRoute();
  drawerPanel.innerHTML = `
    <div class="drawer-top">
      <span class="kicker">Menu</span>
      <button class="icon-btn" type="button" data-close aria-label="Close menu">${icon('close')}</button>
    </div>
    <nav class="drawer-nav" aria-label="Main">
      ${NAV.map(
        ([r, label], i) =>
          `<a href="#/${r}" ${r === route ? 'aria-current="page"' : ''}><span class="num">0${i + 1}</span>${label}<span class="go">${icon('arrowUpRight')}</span></a>`,
      ).join('')}
    </nav>
    <div class="drawer-card">
      <div class="account">
        ${u?.avatar ? `<img class="avatar" src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar-fallback">${icon('user')}</span>`}
        <div class="who"><strong>${u ? '@' + esc(u.login) : 'Guest player'}</strong><span>${sync.text}</span></div>
      </div>
      ${
        u
          ? `<button class="btn btn-outline btn-block" type="button" data-act="signout">${icon('logout')}<span>Sign out</span></button>`
          : `<button class="btn btn-primary btn-block" type="button" data-act="signin">${icon('github')}<span>Sign in with GitHub</span></button>`
      }
    </div>
    <div class="drawer-card" style="margin-top:12px">
      <label class="drawer-row"><span>Sound effects<div class="sub">Synth bleeps, no downloads</div></span><span class="switch"><input type="checkbox" data-set="sound" ${soundOn() ? 'checked' : ''}><span></span></span></label>
      <label class="drawer-row"><span>Light mode</span><span class="switch"><input type="checkbox" data-set="light" ${root.dataset.theme === 'light' ? 'checked' : ''}><span></span></span></label>
      <label class="drawer-row"><span>Reduce motion</span><span class="switch"><input type="checkbox" data-set="motion" ${root.dataset.motion === 'reduced' ? 'checked' : ''}><span></span></span></label>
    </div>
    <div class="drawer-foot">
      <p>Chips are pretend. No deposits, no withdrawals, no prizes.</p>
      <p><a href="${esc(CONFIG.repoUrl)}" target="_blank" rel="noopener">Source on GitHub</a></p>
    </div>`;
}
function openDrawer() {
  renderDrawer();
  drawer.classList.add('is-open');
  drawer.setAttribute('aria-hidden', 'false');
  menuBtn.setAttribute('aria-expanded', 'true');
  closeWallet();
  setTimeout(() => drawerPanel.querySelector('[data-close]')?.focus(), 50);
}
function closeDrawer() {
  drawer.classList.remove('is-open');
  drawer.setAttribute('aria-hidden', 'true');
  menuBtn.setAttribute('aria-expanded', 'false');
}
menuBtn.addEventListener('click', () => {
  sfx.click();
  drawer.classList.contains('is-open') ? closeDrawer() : openDrawer();
});
drawer.addEventListener('click', async (e) => {
  if (e.target.closest('[data-close]')) return closeDrawer();
  if (e.target.closest('.drawer-nav a')) return closeDrawer();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'signin') {
    closeDrawer();
    cloud.signIn();
  }
  if (act === 'signout') {
    closeDrawer();
    cloud.signOut();
  }
});
drawer.addEventListener('change', (e) => {
  const k = e.target.dataset.set;
  if (k === 'sound') {
    setSound(e.target.checked);
    if (e.target.checked) sfx.bet();
  }
  if (k === 'light') applyTheme(e.target.checked ? 'light' : 'dark');
  if (k === 'motion') {
    if (e.target.checked) root.dataset.motion = 'reduced';
    else delete root.dataset.motion;
    storage.set('cc:motion', e.target.checked ? 'reduced' : 'full');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDrawer();
    closeWallet();
  }
});

// ---------------------------------------------------------------- footer
$('#siteFoot').innerHTML = `
  <div class="wrap foot-inner">
    <div class="foot-big" aria-hidden="true">CrankedCasino</div>
    <div class="foot-grid">
      <div class="foot-links">
        <a href="#/mines">Mines</a><a href="#/plinko">Plinko</a><a href="#/slots">Slots</a><a href="#/crash">Crash</a>
        <a href="#/leaderboard">Leaderboard</a><a href="#/profile">Profile</a>
        <a href="${esc(CONFIG.repoUrl)}" target="_blank" rel="noopener">GitHub</a>
      </div>
      <p class="foot-note">CrankedCasino is a free game that uses fake chips with no cash value. Nothing can be bought, won or withdrawn. If real-money gambling ever stops being fun, talk to someone. <a href="https://www.begambleaware.org/" target="_blank" rel="noopener">BeGambleAware</a> can help.</p>
    </div>
  </div>`;

// ---------------------------------------------------------------- router
const routes = {
  '': () => import('./pages/lobby.js'),
  mines: () => import('./games/mines.js'),
  plinko: () => import('./games/plinko.js'),
  slots: () => import('./games/slots.js'),
  crash: () => import('./games/crash.js'),
  leaderboard: () => import('./pages/leaderboard.js'),
  profile: () => import('./pages/profile.js'),
};
function currentRoute() {
  const r = location.hash.replace(/^#\/?/, '').split(/[?/]/)[0];
  return r in routes ? r : '';
}

let current = null;
let navToken = 0;
const revealObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        e.target.classList.add('is-in');
        revealObserver.unobserve(e.target);
      }
  },
  { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
);

async function navigate() {
  const name = currentRoute();
  const token = ++navToken;
  closeDrawer();
  closeWallet();
  let mod;
  try {
    mod = (await routes[name]()).default;
  } catch (e) {
    console.error(e);
    toast('Could not load that page. Check your connection and try again.', { type: 'loss' });
    return;
  }
  if (token !== navToken) return;
  const swap = () => {
    try {
      current?.cleanup?.();
    } catch (e) {
      console.error(e);
    }
    root.style.removeProperty('--accent');
    app.innerHTML = '';
    const view = document.createElement('div');
    view.className = 'view';
    view.dataset.route = name || 'lobby';
    app.append(view);
    const cleanup = mod.mount(view);
    current = { name, cleanup };
    document.title = mod.title ? `${mod.title} · CrankedCasino` : 'CrankedCasino · Fake-money casino';
    window.scrollTo({ top: 0, behavior: 'instant' });
    $$('[data-nav]').forEach((a) => (a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $$('[data-reveal]', view).forEach((el) => revealObserver.observe(el));
  };
  if (document.startViewTransition && current && !matchMedia('(prefers-reduced-motion: reduce)').matches && root.dataset.motion !== 'reduced') {
    quiet(document.startViewTransition(swap));
  } else swap();
}
window.addEventListener('hashchange', navigate);

// Skip link focuses main without touching the hash router.
$('.skip-link').addEventListener('click', (e) => {
  e.preventDefault();
  app.focus();
});

// Audio can only start after a user gesture (iOS).
window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// Daily bonus nudge, once per visit.
setTimeout(() => {
  if (store.dailyReadyIn() === 0 && !sessionStorage.getItem('cc:nudged')) {
    try {
      sessionStorage.setItem('cc:nudged', '1');
    } catch {
      /* ignore */
    }
    toast('Your daily bonus is ready. Tap your balance to claim it.', { iconName: 'gift', timeout: 4500 });
  }
}, 2500);

renderAuth();
navigate();
cloud.init().then(renderAuth);

// Expose a tiny debug handle for testing in the console.
window.__cc = { store, cloud, confirmDialog };
