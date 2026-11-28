// Shared UI: toasts, modals, bet input, segmented controls, game page frame.

import { h, esc, fmt, round2, storage, signed, fmtMult } from './util.js?v=0f27056399f9';
import { icon } from './icons.js?v=0f27056399f9';
import { store, on, BetError } from './store.js?v=0f27056399f9';
import { sfx } from './sound.js?v=0f27056399f9';
import { needAccount } from './account.js?v=0f27056399f9';
import { banner } from './ads.js?v=0f27056399f9';
import { errorText } from './engine.js?v=0f27056399f9';

// ---------------------------------------------------------------- toasts
const toastRoot = document.getElementById('toasts');
export function toast(message, { type = 'info', iconName, timeout = 3200 } = {}) {
  const ic = iconName || (type === 'win' ? 'sparkle' : type === 'loss' ? 'info' : 'info');
  const el = h(`<div class="toast ${type}">${icon(ic)}<span>${esc(message)}</span></div>`);
  toastRoot.append(el);
  while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
  setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 320);
  }, timeout);
}

// ---------------------------------------------------------------- modal
export function modal({ title, body = '', actions = [], onClose } = {}) {
  const root = h(`
    <div class="modal-root" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-scrim"></div>
      <div class="modal">
        <button class="icon-btn close-x" type="button" aria-label="Close">${icon('close')}</button>
        <h2>${esc(title)}</h2>
        <div class="modal-body"></div>
        <div class="modal-actions"></div>
      </div>
    </div>`);
  const bodyEl = root.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body) bodyEl.append(body);
  const acts = root.querySelector('.modal-actions');
  if (!actions.length) acts.remove();
  let closed = false;
  const prevFocus = document.activeElement;
  const close = () => {
    if (closed) return;
    closed = true;
    root.classList.add('is-closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => root.remove(), 240);
    onClose?.();
    prevFocus?.focus?.();
  };
  for (const a of actions) {
    const b = h(`<button type="button" class="btn ${a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-outline'}">${a.icon ? icon(a.icon) : ''}<span>${esc(a.label)}</span></button>`);
    b.addEventListener('click', async () => {
      const r = await a.onClick?.();
      if (r !== false) close();
    });
    acts.append(b);
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  root.querySelector('.modal-scrim').addEventListener('click', close);
  root.querySelector('.close-x').addEventListener('click', close);
  document.body.append(root);
  (root.querySelector('.modal-actions .btn-primary') || root.querySelector('.close-x')).focus();
  return close;
}

export function confirmDialog({ title, text, confirm = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: `<p>${esc(text)}</p>`,
      actions: [
        { label: 'Cancel', onClick: () => { answered = true; resolve(false); } },
        { label: confirm, primary: !danger, danger, onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
  });
}

// ---------------------------------------------------------------- bet input
/**
 * Bet amount field with ½ / 2× / max. Remembers the last bet per game.
 */
export const CHIP_VALUES = [1, 5, 10, 25, 100, 500];
export const chipClass = (v) => (v >= 1000 ? 'c-1k' : v >= 500 ? 'c-500' : v >= 100 ? 'c-100' : v >= 25 ? 'c-25' : v >= 10 ? 'c-10' : v >= 5 ? 'c-5' : 'c-1');
export const chipLabel = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}K` : String(v));

export function betInput(game, { label = 'Bet amount', min = 0.01, rack = true, defaultValue = 10 } = {}) {
  const key = `cc:bet:${game}`;
  let value = storage.get(key, defaultValue);
  const el = h(`
    <div class="field">
      <div class="field-label"><span>${esc(label)}</span><button type="button" class="dim tnum" data-act="clear" style="font-size:11px;letter-spacing:.1em">CLEAR</button></div>
      <div class="input-group">
        <span class="chip-ico" aria-hidden="true"></span>
        <input type="number" inputmode="decimal" step="0.01" min="${min}" aria-label="${esc(label)}">
        <button type="button" class="mini" data-act="half" aria-label="Halve bet">½</button>
        <button type="button" class="mini" data-act="double" aria-label="Double bet">2×</button>
        <button type="button" class="mini" data-act="max" aria-label="Max bet">Max</button>
      </div>
      ${
        rack
          ? `<div class="rack" aria-label="Add chips">${CHIP_VALUES.map((v) => `<button type="button" class="rack-chip ${chipClass(v)}" data-add="${v}" aria-label="Add ${v}"><span>${chipLabel(v)}</span></button>`).join('')}</div>`
          : ''
      }
    </div>`);
  const input = el.querySelector('input');
  const group = el.querySelector('.input-group');
  // A long amount shrinks to fit the box instead of being cut off.
  let measure;
  const fit = () => {
    input.style.fontSize = '';
    if (!input.clientWidth) return;
    const cs = getComputedStyle(input);
    const room = input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const size = parseFloat(cs.fontSize);
    measure ||= document.createElement('canvas').getContext('2d');
    measure.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    const text = measure.measureText(input.value).width * 1.06; // tabular digits run a touch wider
    if (text > room) input.style.fontSize = `${Math.max(10, Math.floor((size * room * 10) / text) / 10)}px`;
  };
  const set = (v, save = true) => {
    v = round2(Math.max(0, Number(v) || 0));
    value = v;
    input.value = v.toFixed(2);
    if (save) storage.set(key, v);
    fit();
  };
  set(value, false);
  new ResizeObserver(fit).observe(group);
  input.addEventListener('input', fit);
  input.addEventListener('change', () => set(input.value));
  input.addEventListener('focus', () => input.select());
  el.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (add && !add.disabled) {
      sfx.chip();
      const fresh = el.dataset.fresh === '1';
      el.dataset.fresh = '';
      set(Math.min(Math.floor(store.balance * 100) / 100, (fresh ? 0 : value) + Number(add.dataset.add)) || Number(add.dataset.add));
      add.animate([{ transform: 'translateY(-10px) rotate(-14deg)' }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.34,1.56,.64,1)' });
      group.animate([{ boxShadow: '0 0 0 3px rgba(255,201,77,.45)' }, { boxShadow: '0 0 0 0 rgba(255,201,77,0)' }], { duration: 500 });
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    sfx.click();
    if (b.dataset.act === 'half') set(Math.max(min, value / 2));
    if (b.dataset.act === 'double') set(Math.min(store.balance, value * 2) || min);
    if (b.dataset.act === 'max') set(Math.floor(store.balance * 100) / 100);
    if (b.dataset.act === 'clear') {
      set(min);
      el.dataset.fresh = '1';
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return {
    el,
    get value() {
      set(input.value);
      return value;
    },
    set value(v) {
      set(v);
    },
    disable(on) {
      el.querySelectorAll('input,button').forEach((x) => (x.disabled = on));
    },
    error() {
      group.classList.remove('is-error');
      void group.offsetWidth;
      group.classList.add('is-error');
    },
  };
}

/** Validate & place a bet, showing friendly feedback. Returns ticket or null. */
export function tryBet(game, input) {
  if (!needAccount()) return null;
  try {
    const t = store.placeBet(game, input.value);
    sfx.bet();
    return t;
  } catch (e) {
    if (e instanceof BetError) {
      input.error?.();
      betError(e.message);
      return null;
    }
    throw e;
  }
}

/** "Not enough chips" with a pointer to the free-chips button when the player is broke. */
export function betError(message = 'Not enough chips for that bet.') {
  if (store.balance < 1) toast('You’re out of chips. Tap your stack and watch an ad for more.', { iconName: 'tv', timeout: 4200 });
  else toast(message, { type: 'loss' });
}

/** The server turned a bet down: undo it on screen and say why. */
export function serverRefused(t, r, input) {
  store.cancel(t);
  store.sync(r);
  if (r?.error === 'funds') {
    input?.error?.();
    betError();
    store.refresh();
  } else if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
}

// ---------------------------------------------------------------- segmented
export function segmented(options, value, onChange, { label } = {}) {
  const el = h(`<div class="seg" role="group" ${label ? `aria-label="${esc(label)}"` : ''}></div>`);
  for (const o of options) {
    const b = h(`<button type="button" data-v="${esc(o.value)}" aria-pressed="${String(o.value) === String(value)}">${esc(o.label)}</button>`);
    b.addEventListener('click', () => {
      if (b.disabled) return;
      sfx.click();
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(o.value);
    });
    el.append(b);
  }
  return {
    el,
    disable(on) {
      el.querySelectorAll('button').forEach((x) => (x.disabled = on));
    },
    set(v) {
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === String(v))));
    },
  };
}

// ---------------------------------------------------------------- game frame
const GAME_COLORS = { mines: 'var(--mines)', plinko: 'var(--plinko)', slots: 'var(--slots)', crash: 'var(--crash)', blackjack: 'var(--blackjack)', roulette: 'var(--roulette)', rooster: 'var(--rooster)', flight: 'var(--flight, #ffbe66)' };
const GAME_SUITS = { blackjack: '♠', roulette: '♦', slots: '♥', crash: '♣', plinko: '♦', mines: '♠', rooster: '♥', flight: '♣' };

/**
 * Standard game page: title row, stage, controls, and a recent-bets table.
 * Returns the important nodes plus a cleanup function.
 */
export function gameFrame(root, { game, title, kicker, tags = [], rules }) {
  document.documentElement.style.setProperty('--accent', GAME_COLORS[game]);
  const el = h(`
    <section class="game game--${game}" style="--accent:${GAME_COLORS[game]}">
      <div class="game-head wrap">
        <div>
          <div class="kicker">${esc(kicker)}</div>
          <h1 class="game-title display"><span class="gt-suit" aria-hidden="true">${GAME_SUITS[game] || '♠'}</span>${esc(title)}</h1>
        </div>
        <div class="game-head-side">
          ${tags.map((t) => `<span class="tag"><span class="dot"></span>${esc(t)}</span>`).join('')}
          <button type="button" class="btn btn-outline btn-sm" data-rules>${icon('info')}<span>How to play</span></button>
        </div>
      </div>
      <div class="game-body wrap">
        <div class="stage" data-stage></div>
        <aside class="controls panel" data-controls></aside>
      </div>
      <div class="wrap" data-adwrap></div>
      <div class="wrap">
        <div class="game-history panel">
          <div class="gh-head"><h2>Your ${esc(title)} bets</h2><span class="dim" data-hist-count></span></div>
          <div class="table-scroll"><table class="bets"><thead><tr><th>Bet</th><th>Multiplier</th><th>Payout</th></tr></thead><tbody data-hist></tbody></table></div>
        </div>
      </div>
    </section>`);
  root.append(el);
  el.querySelector('[data-adwrap]').append(banner(game));

  el.querySelector('[data-rules]').addEventListener('click', () => {
    modal({ title: `How to play ${title}`, body: rules });
  });

  const tbody = el.querySelector('[data-hist]');
  const countEl = el.querySelector('[data-hist-count]');
  const renderHist = (fresh) => {
    const rows = store.state.history.filter((x) => x.g === game).slice(0, 10);
    countEl.textContent = rows.length ? `Last ${rows.length}` : '';
    tbody.innerHTML = rows.length
      ? rows
          .map(
            (r, i) => `<tr class="${fresh && i === 0 ? 'new' : ''}">
              <td><span class="chip-ico sm" style="display:inline-block;vertical-align:-3px;margin-right:8px"></span>${fmt(r.a)}</td>
              <td class="${r.m >= 1 ? 'win-text' : 'dim'}">${fmtMult(r.m)}</td>
              <td class="${r.p > r.a ? 'win-text' : r.p < r.a ? 'dim' : ''}">${r.p > r.a ? signed(r.p - r.a) : fmt(r.p)}</td>
            </tr>`,
          )
          .join('')
      : `<tr><td colspan="3"><div class="empty">No ${esc(title)} bets yet. Make one count.</div></td></tr>`;
  };
  renderHist(false);
  const offBet = on('bet', (e) => {
    if (e.g === game) renderHist(true);
  });
  const offReset = on('reset', () => renderHist(false));

  return {
    el,
    stage: el.querySelector('[data-stage]'),
    controls: el.querySelector('[data-controls]'),
    destroy() {
      offBet();
      offReset();
    },
  };
}

// ---------------------------------------------------------------- promo ticket
/**
 * Golden ticket with a promo-code field. Redeeming stamps the ticket and pays out.
 */
export function promoTicket({ title = 'Promo code', sub = 'Got a code? Cash it in.' } = {}) {
  const el = h(`
    <form class="ticket" autocomplete="off" novalidate>
      <div class="t-top">
        <div><div class="t-title">${esc(title)}</div><div class="t-sub">${esc(sub)}</div></div>
        <span class="t-ico" aria-hidden="true">${icon('ticket')}</span>
      </div>
      <div class="t-row">
        <input type="text" name="code" placeholder="Enter code" aria-label="Promo code" maxlength="24" spellcheck="false" autocapitalize="characters">
        <button type="submit" class="t-btn">Redeem</button>
      </div>
      <div class="t-msg" aria-live="polite"></div>
    </form>`);
  const input = el.querySelector('input');
  const msg = el.querySelector('.t-msg');
  let busy = false;
  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!needAccount()) return;
    busy = true;
    const btn = el.querySelector('.t-btn');
    btn.disabled = true;
    msg.className = 't-msg';
    msg.textContent = 'Checking…';
    const r = await store.redeem(input.value);
    busy = false;
    btn.disabled = false;
    el.querySelector('.stamp')?.remove();
    if (r?.ok) {
      msg.className = 't-msg';
      msg.textContent = `+${fmt(r.chips)} chips added. Go get 'em.`;
      el.insertAdjacentHTML('beforeend', '<span class="stamp">Redeemed</span>');
      input.value = '';
      sfx.jackpot();
      import('./fx.js?v=0f27056399f9').then(({ coinRain, burstAt, PALETTES }) => {
        coinRain(120);
        burstAt(el, { count: 90, colors: PALETTES.gold, speed: [5, 15] });
      });
      toast(`Promo ${r.code} redeemed: +${fmt(r.chips)} chips!`, { type: 'win', iconName: 'ticket', timeout: 4200 });
    } else {
      msg.className = 't-msg err';
      msg.textContent =
        r?.error === 'used'
          ? `${r.code || 'That code'} was already redeemed on your account. Codes work once.`
          : r?.error === 'empty'
            ? 'Type a code first.'
            : r?.error === 'invalid'
              ? 'That code isn’t valid. Check the spelling?'
              : errorText(r);
      el.classList.remove('is-error');
      void el.offsetWidth;
      el.classList.add('is-error');
      sfx.lose();
    }
  });
  return el;
}
