// Shared UI: toasts, modals, bet input, segmented controls, game page frame.

import { h, esc, fmt, round2, storage, signed, fmtMult } from './util.js';
import { icon } from './icons.js';
import { store, on, BetError } from './store.js';
import { sfx } from './sound.js';

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
export function betInput(game, { label = 'Bet amount', min = 0.01 } = {}) {
  const key = `cc:bet:${game}`;
  let value = storage.get(key, 10);
  const el = h(`
    <div class="field">
      <div class="field-label"><span>${esc(label)}</span><span class="dim tnum" data-usd></span></div>
      <div class="input-group">
        <span class="chip-ico" aria-hidden="true"></span>
        <input type="number" inputmode="decimal" step="0.01" min="${min}" aria-label="${esc(label)}">
        <button type="button" class="mini" data-act="half" aria-label="Halve bet">½</button>
        <button type="button" class="mini" data-act="double" aria-label="Double bet">2×</button>
        <button type="button" class="mini" data-act="max" aria-label="Max bet">Max</button>
      </div>
    </div>`);
  const input = el.querySelector('input');
  const group = el.querySelector('.input-group');
  const set = (v, save = true) => {
    v = round2(Math.max(0, Number(v) || 0));
    value = v;
    input.value = v.toFixed(2);
    if (save) storage.set(key, v);
  };
  set(value, false);
  input.addEventListener('change', () => set(input.value));
  input.addEventListener('focus', () => input.select());
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    sfx.click();
    if (b.dataset.act === 'half') set(Math.max(min, value / 2));
    if (b.dataset.act === 'double') set(Math.min(store.balance, value * 2) || min);
    if (b.dataset.act === 'max') set(Math.floor(store.balance * 100) / 100);
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
export function tryBet(game, input, opts) {
  try {
    const amount = input.value;
    const t = store.placeBet(game, amount, opts);
    sfx.bet();
    return t;
  } catch (e) {
    if (e instanceof BetError) {
      input.error?.();
      if (store.balance < 1 && store.canRefill()) toast('Out of chips. Tap your balance to refill.', { iconName: 'coins' });
      else toast(e.message, { type: 'loss' });
      return null;
    }
    throw e;
  }
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
const GAME_COLORS = { mines: 'var(--mines)', plinko: 'var(--plinko)', slots: 'var(--slots)', crash: 'var(--crash)' };

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
          <h1 class="game-title display">${esc(title)}</h1>
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
      <div class="wrap">
        <div class="game-history panel">
          <div class="gh-head"><h2>Your ${esc(title)} bets</h2><span class="dim" data-hist-count></span></div>
          <div class="table-scroll"><table class="bets"><thead><tr><th>Bet</th><th>Multiplier</th><th>Payout</th></tr></thead><tbody data-hist></tbody></table></div>
        </div>
      </div>
    </section>`);
  root.append(el);

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
