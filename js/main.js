// App shell: header, cashier, drawer, theme, footer and the hash router.

import { $, $$, esc, fmt, signed, storage } from './util.js?v=a65f52998e3f';
import { icon } from './icons.js?v=a65f52998e3f';
import { store, on } from './store.js?v=a65f52998e3f';
import { engine, MODE } from './engine.js?v=a65f52998e3f';
import { CONFIG } from './config.js?v=a65f52998e3f';
import { sfx, unlockAudio, setSound, soundOn, music, musicOn, setMusic } from './sound.js?v=a65f52998e3f';
import { countTo, floatFrom } from './fx.js?v=a65f52998e3f';
import { toast, confirmDialog, promoTicket } from './ui.js?v=a65f52998e3f';
import { openAccount, signOut } from './account.js?v=a65f52998e3f';
import { adButton } from './ads.js?v=a65f52998e3f';

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
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0d0507' : '#f4e9d3';
  window.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
}
applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark');

// ---------------------------------------------------------------- connection status
let online = true;
function statusLine() {
  if (!store.signedIn) return { icon: 'user', text: 'Not signed in' };
  if (MODE === 'device') return { icon: 'device', text: 'Saved on this device (offline mode)' };
  if (!online) return { icon: 'info', text: 'Can’t reach the casino. Retrying…' };
  return { icon: 'cloud', text: 'Saved to your account · any browser' };
}
engine.on((type) => {
  if (type === 'offline' && online) {
    online = false;
    renderAuth();
  }
  if (type === 'online' && !online) {
    online = true;
    renderAuth();
  }
  if (type === 'signedout') {
    // handled below (session expired or signed out elsewhere)
  }
});

// ---------------------------------------------------------------- balance pill
const balBtn = $('#balanceBtn');
const balNum = $('#balanceNum');
let shownBalance = store.balance;
let stopCount = () => {};
let flashTimer = 0;

function renderPill() {
  const inn = store.signedIn;
  balBtn.classList.toggle('is-out', !inn);
  balBtn.setAttribute('aria-label', inn ? 'Open cashier' : 'Create an account to play');
  if (!inn) {
    stopCount();
    balNum.textContent = 'Join';
    shownBalance = 0;
  }
}
on('balance', ({ delta, balance, silent }) => {
  if (!store.signedIn) return renderPill();
  stopCount();
  const from = balNum.textContent === 'Join' ? 0 : shownBalance;
  shownBalance = balance;
  stopCount = countTo(balNum, from, balance, { duration: silent ? 1 : 650 });
  if (!wallet.hidden) renderWalletNumbers();
  if (silent || !delta) return;
  balBtn.classList.remove('is-up', 'is-down');
  void balBtn.offsetWidth;
  balBtn.classList.add(delta > 0 ? 'is-up' : 'is-down');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => balBtn.classList.remove('is-up', 'is-down'), 700);
  if (delta > 0) floatFrom(balBtn, signed(delta), 'var(--win)');
});

// ---------------------------------------------------------------- cashier popover
const wallet = $('#wallet');
let walletAd = null;
function renderWallet() {
  walletAd?.destroy();
  const s = statusLine();
  wallet.innerHTML = `
    <div class="wallet-head"><span class="kicker">Cashier</span><button class="icon-btn" type="button" data-act="close" aria-label="Close cashier">${icon('close')}</button></div>
    <div class="wallet-bal"><span class="chip-ico lg"></span><div><div class="dim" style="font-size:11px;font-weight:750;letter-spacing:.14em;text-transform:uppercase">${esc(store.username)}’s stack</div><div class="big neon tnum" data-w="bal">${fmt(store.balance)}</div></div></div>
    <div data-w="ad"></div>
    <div class="ticket-glow" data-w="promo"></div>
    <div class="wallet-meta" data-w="meta"></div>
    <div class="wallet-sync" data-w="sync">${icon(s.icon)}<span>${esc(s.text)}</span></div>
    <a class="link-arrow" href="#/profile" data-act="profile">Your profile & stats ${icon('arrowRight')}</a>`;
  walletAd = adButton();
  wallet.querySelector('[data-w="ad"]').append(walletAd.el);
  wallet.querySelector('[data-w="promo"]').append(promoTicket({ title: 'Promo code', sub: 'One-time bonus chips' }));
  renderWalletNumbers();
}
function renderWalletNumbers() {
  const st = store.state.stats;
  const bal = wallet.querySelector('[data-w="bal"]');
  if (bal) bal.textContent = fmt(store.balance);
  const meta = wallet.querySelector('[data-w="meta"]');
  if (meta)
    meta.innerHTML = `
      <div><span>Wagered</span><strong>${fmt(st.wagered)}</strong></div>
      <div><span>Net profit</span><strong class="${st.profit >= 0 ? 'win-text' : 'loss-text'}">${signed(st.profit)}</strong></div>
      <div><span>Biggest win</span><strong>${fmt(st.biggestWin)}</strong></div>
      <div><span>Bets played</span><strong>${st.bets.toLocaleString('en-US')}</strong></div>`;
}
function openWallet({ focusPromo = false } = {}) {
  if (!store.signedIn) {
    openAccount();
    return;
  }
  renderWallet();
  wallet.hidden = false;
  if (focusPromo) setTimeout(() => wallet.querySelector('.ticket input')?.focus(), 80);
}
function closeWallet() {
  wallet.hidden = true;
  walletAd?.destroy();
  walletAd = null;
}
balBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.chip();
  if (!store.signedIn) return openAccount();
  wallet.hidden ? openWallet() : closeWallet();
});
const promoBtn = $('#promoBtn');
promoBtn.innerHTML = icon('ticket');
promoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  sfx.click();
  if (!store.signedIn) return openAccount({ reason: 'Make a username first, then your promo code pays out to your account.' });
  if (wallet.hidden) openWallet({ focusPromo: true });
  else wallet.querySelector('.ticket input')?.focus();
});
wallet.addEventListener('click', (e) => {
  e.stopPropagation();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'close') closeWallet();
  if (act === 'profile') closeWallet();
});
document.addEventListener('click', (e) => {
  if (!wallet.hidden && !wallet.contains(e.target) && e.target.isConnected) closeWallet();
});
const updatePromoBadge = () => {
  promoBtn.querySelector('.badge')?.remove();
  if (!store.hasPromo('MAXWIN')) promoBtn.insertAdjacentHTML('beforeend', '<span class="badge"></span>');
};
updatePromoBadge();
on('promo', updatePromoBadge);
on('reset', updatePromoBadge);

// ---------------------------------------------------------------- account button
const ghBtn = $('#ghBtn');
const syncDot = $('#syncDot');
const initial = () => esc((store.username || '?').slice(0, 1));
function renderAuth() {
  if (store.signedIn) {
    ghBtn.innerHTML = `<span class="initial">${initial()}</span>`;
    ghBtn.setAttribute('aria-label', `Signed in as ${store.username}. Open menu`);
  } else {
    ghBtn.innerHTML = icon('user');
    ghBtn.setAttribute('aria-label', 'Create an account or log in');
  }
  syncDot.dataset.state = !store.signedIn ? '' : MODE === 'device' ? 'device' : online ? 'synced' : 'offline';
  syncDot.title = statusLine().text;
  renderPill();
  if (!wallet.hidden) {
    if (store.signedIn) renderWallet();
    else closeWallet();
  }
  renderDrawer();
}
ghBtn.addEventListener('click', () => {
  sfx.click();
  if (store.signedIn) openDrawer();
  else openAccount();
});
on('account', renderAuth);

// ---------------------------------------------------------------- drawer
const drawer = $('#drawer');
const drawerPanel = $('.drawer-panel', drawer);
const menuBtn = $('#menuBtn');
menuBtn.innerHTML = icon('menu');
const NAV = [
  ['', 'Lobby', '★'],
  ['blackjack', 'Blackjack', '♠'],
  ['roulette', 'Roulette', '♦'],
  ['slots', 'Slots', '♥'],
  ['crash', 'Crash', '♣'],
  ['plinko', 'Plinko', '♦'],
  ['mines', 'Mines', '♠'],
  ['rooster', 'Road Rooster', '♥'],
  ['flight', 'Night Flight', '♣'],
  ['leaderboard', 'Leaderboard', '♛'],
  ['profile', 'Profile', '☺'],
];
let drawerAd = null;
function renderDrawer() {
  const route = currentRoute();
  const st = statusLine();
  drawerAd?.destroy();
  drawerPanel.innerHTML = `
    <div class="drawer-top">
      <span class="kicker">The floor</span>
      <button class="icon-btn" type="button" data-close aria-label="Close menu">${icon('close')}</button>
    </div>
    <nav class="drawer-nav" aria-label="Main">
      ${NAV.map(
        ([r, label, suit]) =>
          `<a href="#/${r}" ${r === route ? 'aria-current="page"' : ''}><span class="suit" aria-hidden="true">${suit}</span>${label}<span class="go">${icon('arrowUpRight')}</span></a>`,
      ).join('')}
    </nav>
    <div class="drawer-card">
      <div class="account">
        ${store.signedIn ? `<span class="avatar-initial">${initial()}</span>` : `<span class="avatar-fallback">${icon('user')}</span>`}
        <div class="who"><strong>${store.signedIn ? esc(store.username) : 'Not signed in'}</strong><span>${esc(st.text)}</span></div>
      </div>
      ${
        store.signedIn
          ? `<div data-ad></div><button class="btn btn-outline btn-block" type="button" data-act="signout">${icon('logout')}<span>Sign out</span></button>`
          : `<button class="btn btn-primary btn-block" type="button" data-act="signup">${icon('sparkle')}<span>Create account · 1,000 chips</span></button>
             <button class="btn btn-outline btn-block" type="button" data-act="login">${icon('user')}<span>Log in</span></button>`
      }
    </div>
    <div class="drawer-card" style="margin-top:12px">
      <button class="drawer-row" type="button" data-act="promo" style="text-align:left"><span>Redeem a promo code<div class="sub">One-time bonus, if you know the word</div></span><span style="color:var(--gold)">${icon('ticket')}</span></button>
    </div>
    <div class="drawer-card" style="margin-top:12px">
      <label class="drawer-row"><span>Sound effects<div class="sub">Synth bleeps, no downloads</div></span><span class="switch"><input type="checkbox" data-set="sound" ${soundOn() ? 'checked' : ''}><span></span></span></label>
      <label class="drawer-row"><span>Music<div class="sub">Quiet loops while you play</div></span><span class="switch"><input type="checkbox" data-set="music" ${musicOn() ? 'checked' : ''}><span></span></span></label>
      <label class="drawer-row"><span>Daylight mode<div class="sub">Champagne instead of velvet</div></span><span class="switch"><input type="checkbox" data-set="light" ${root.dataset.theme === 'light' ? 'checked' : ''}><span></span></span></label>
      <label class="drawer-row"><span>Reduce motion</span><span class="switch"><input type="checkbox" data-set="motion" ${root.dataset.motion === 'reduced' ? 'checked' : ''}><span></span></span></label>
    </div>
    <div class="drawer-foot">
      <p>Chips are pretend. No deposits, no withdrawals, no prizes.</p>
      <p><a href="${esc(CONFIG.repoUrl)}" target="_blank" rel="noopener">Source on GitHub</a></p>
    </div>`;
  drawerPanel.querySelectorAll('.drawer-row svg').forEach((s) => s.setAttribute('width', '22'));
  const slot = drawerPanel.querySelector('[data-ad]');
  if (slot) {
    drawerAd = adButton();
    slot.replaceWith(drawerAd.el);
  }
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
drawer.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) return closeDrawer();
  if (e.target.closest('.drawer-nav a')) return closeDrawer();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'signup' || act === 'login') {
    closeDrawer();
    openAccount({ mode: act });
  }
  if (act === 'signout') {
    closeDrawer();
    confirmDialog({ title: 'Sign out?', text: `Your chips stay on ${store.username}. Log back in with your username and password on any browser.`, confirm: 'Sign out' }).then((ok) => ok && signOut());
  }
  if (act === 'promo') {
    closeDrawer();
    setTimeout(() => openWallet({ focusPromo: true }), 120);
  }
});
drawer.addEventListener('change', (e) => {
  const k = e.target.dataset.set;
  if (k === 'sound') {
    setSound(e.target.checked);
    if (e.target.checked) sfx.bet();
  }
  if (k === 'music') setMusic(e.target.checked);
  if (k === 'light') {
    const next = e.target.checked ? 'light' : 'dark';
    if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) quiet(document.startViewTransition(() => applyTheme(next)));
    else applyTheme(next);
  }
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
    <div class="foot-sign" aria-hidden="true">
      <span class="neon">OP<span class="off">E</span>N</span>
      <span class="hours gold-text">24 / 7<br>All night</span>
    </div>
    <div class="foot-grid">
      <div class="foot-links">
        <a href="#/blackjack">Blackjack</a><a href="#/roulette">Roulette</a><a href="#/slots">Slots</a><a href="#/crash">Crash</a>
        <a href="#/plinko">Plinko</a><a href="#/mines">Mines</a><a href="#/rooster">Road Rooster</a><a href="#/flight">Night Flight</a><a href="#/leaderboard">Leaderboard</a><a href="#/profile">Profile</a>
        <a href="${esc(CONFIG.repoUrl)}" target="_blank" rel="noopener">GitHub</a>
      </div>
      <p class="foot-note">CrankedCasino is a free game that uses fake chips with no cash value. Nothing can be bought, won or withdrawn. If real-money gambling ever stops being fun, talk to someone. <a href="https://www.begambleaware.org/" target="_blank" rel="noopener">BeGambleAware</a> can help.</p>
    </div>
  </div>`;

// ---------------------------------------------------------------- router
const routes = {
  '': () => import('./pages/lobby.js?v=a65f52998e3f'),
  blackjack: () => import('./games/blackjack.js?v=a65f52998e3f'),
  roulette: () => import('./games/roulette.js?v=a65f52998e3f'),
  mines: () => import('./games/mines.js?v=a65f52998e3f'),
  plinko: () => import('./games/plinko.js?v=a65f52998e3f'),
  slots: () => import('./games/slots.js?v=a65f52998e3f'),
  crash: () => import('./games/crash.js?v=a65f52998e3f'),
  rooster: () => import('./games/rooster.js?v=a65f52998e3f'),
  flight: () => import('./games/flight.js?v=a65f52998e3f'),
  leaderboard: () => import('./pages/leaderboard.js?v=a65f52998e3f'),
  profile: () => import('./pages/profile.js?v=a65f52998e3f'),
};
// Background music: a mood per game, quiet in the lobby and on the other pages.
const MOODS = { blackjack: 'lounge', roulette: 'lounge', mines: 'lounge', plinko: 'lounge', slots: 'lounge', crash: 'lounge', rooster: 'rooster', flight: 'night' };
document.addEventListener('visibilitychange', () => (document.hidden ? music.pause() : music.resume()));
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
    music.play(MOODS[name] || null);
    document.title = mod.title ? `${mod.title} · CrankedCasino` : 'CrankedCasino · After hours, fake chips';
    window.scrollTo({ top: 0, behavior: 'instant' });
    $$('[data-nav]').forEach((a) => (a.dataset.nav === name ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    $$('[data-reveal]', view).forEach((el) => revealObserver.observe(el));
  };
  if (document.startViewTransition && current && !matchMedia('(prefers-reduced-motion: reduce)').matches && root.dataset.motion !== 'reduced') {
    quiet(document.startViewTransition(swap));
  } else swap();
}
window.addEventListener('hashchange', navigate);

$('.skip-link').addEventListener('click', (e) => {
  e.preventDefault();
  app.focus();
});

// Audio can only start after a user gesture (iOS).
window.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// ---------------------------------------------------------------- session
const GAME_NAMES = { mines: 'Mines', blackjack: 'Blackjack', crash: 'Crash' };
function noticeRounds() {
  for (const g of ['blackjack', 'mines', 'crash']) {
    if (store.state.rounds?.[g] && currentRoute() !== g) {
      toast(`Your ${GAME_NAMES[g]} round is still open. Head back to finish it.`, { iconName: 'refresh', timeout: 5000 });
      break;
    }
  }
}

engine.on((type, data) => {
  if (type !== 'signedout') return;
  if (store.signedIn) store.signOut();
  if (data?.expired) {
    toast('Your session ended. Log in again to keep playing.', { iconName: 'user', timeout: 4500 });
    openAccount({ mode: 'login' });
  }
});

async function boot() {
  renderAuth();
  if (engine.signedIn) {
    const me = await engine.me();
    if (me?.ok) {
      store.load(me, { silent: true });
      noticeRounds();
    } else if (me?.error !== 'auth') {
      // Server unreachable: keep the session and try again when the connection returns.
      toast('Can’t reach the casino right now. Retrying…', { type: 'loss', iconName: 'info', timeout: 4000 });
      const retry = async () => {
        const r = await engine.me();
        if (r?.ok) {
          store.load(r, { silent: true });
          window.removeEventListener('online', retry);
          clearInterval(timer);
        }
      };
      const timer = setInterval(retry, 8000);
      window.addEventListener('online', retry);
    }
  } else {
    // First visit in this tab: invite them to grab a username.
    let seen = false;
    try {
      seen = sessionStorage.getItem('cc:invited') === '1';
      sessionStorage.setItem('cc:invited', '1');
    } catch {
      /* ignore */
    }
    if (!seen) setTimeout(() => !store.signedIn && !['rooster', 'flight'].includes(currentRoute()) && !document.querySelector('.modal-root') && openAccount(), 1400);
  }
  navigate();
}

// Pick up anything that changed on another device when the player comes back.
let lastRefresh = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || !store.signedIn || store.busy) return;
  if (Date.now() - lastRefresh < 15000) return;
  lastRefresh = Date.now();
  store.refresh();
});

boot();

window.__cc = { store, engine, confirmDialog, openWallet, openAccount };
