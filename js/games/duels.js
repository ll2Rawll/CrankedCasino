// 1v1 challenges for the skill games (Road Rooster, Night Flight).
//
// Asynchronous, like the server (supabase/multiplayer.sql): post a challenge and play at once
// while your score stays hidden, or accept someone's with your own bet and play the very same
// course. The higher score wins 2× its own bet, the other bet is lost, a tie refunds both. The
// server replays every run, settles each challenge once, and refunds one nobody takes in 24 h.
//
// duelPanel() is the list beside the game; the game asks it to start (post/accept) and hands it
// the finished run. It never touches the game's canvas.
import { engine, errorText, MODE } from '../engine.js?v=d846a0b4c715';
import { store } from '../store.js?v=d846a0b4c715';
import { tryBet, serverRefused, toast } from '../ui.js?v=d846a0b4c715';
import { needAccount } from '../account.js?v=d846a0b4c715';
import { esc, fmt } from '../util.js?v=d846a0b4c715';
import { sfx } from '../sound.js?v=d846a0b4c715';

const POLL_MS = 9000;
const ago = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;
};
const left = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m}m left` : `${Math.floor(m / 60)}h left`;
};

/** What a finished (or posted) challenge means for the player who just played it. */
export function duelOutcome(d, unit) {
  const mine = d.seat === 1 ? d.guest_score : d.host_score;
  const theirs = d.seat === 1 ? d.host_score : d.guest_score;
  const stake = Number(d.seat === 1 ? d.guest_bet : d.host_bet);
  const rival = d.seat === 1 ? d.host : d.guest;
  if (d.state !== 'done') return { kind: 'posted', mine, stake, title: 'Challenge posted', line: `Your score stays hidden until someone accepts · ${fmt(stake)} on the line` };
  const pay = Number(d.payout) || 0;
  if (mine === theirs) return { kind: 'tie', mine, theirs, stake, pay, rival, title: `Tie with ${rival}`, line: `${mine} to ${theirs} ${unit} · your ${fmt(stake)} is back` };
  if (mine > theirs) return { kind: 'win', mine, theirs, stake, pay, rival, title: `You beat ${rival}`, line: `${mine} to ${theirs} ${unit} · 2× your bet` };
  return { kind: 'loss', mine, theirs, stake, pay, rival, title: `${rival} wins`, line: `${mine} to ${theirs} ${unit} · bet lost` };
}

/**
 * game: 'rooster' | 'flight'; bet: the game's betInput; unit: 'rows' | 'gates';
 * onStart({ duel, ticket, role }) begins the run on duel.seed (role 'host' or 'guest');
 * canStart() says whether the game is free to start one.
 */
export function duelPanel({ game, bet, unit, onStart, canStart = () => true, label = 'run' }) {
  const el = document.createElement('section');
  el.className = 'duels';
  el.setAttribute('aria-label', '1v1 challenges');
  const online = MODE === 'server';
  el.innerHTML = `
    <div class="duels-rule"><b>1v1</b><span>Higher score wins <strong>2× their own bet</strong> · the loser loses theirs · a tie refunds both</span></div>
    <button type="button" class="btn btn-primary duels-post" data-post></button>
    <p class="duels-hint">You ${label} first and your score stays hidden. Anyone can accept with their own bet and ${label} the same course. Unaccepted challenges refund after 24 hours.</p>
    <div class="duels-block"><h4>Open challenges <span class="duels-count" data-count></span></h4><ul class="duels-list" data-open></ul></div>
    <div class="duels-block"><h4>Your challenges</h4><ul class="duels-list" data-mine></ul></div>`;
  const postBtn = el.querySelector('[data-post]');
  const openList = el.querySelector('[data-open]');
  const mineList = el.querySelector('[data-mine]');
  const countEl = el.querySelector('[data-count]');
  let open = [], mine = [], serverNow = Date.now(), at = performance.now(), timer = 0, destroyed = false, busy = false, loaded = false, visible = false, failure = '';
  const known = new Map(); // challenge id → last state seen, to announce results that land while away
  const now = () => serverNow + performance.now() - at;

  function render() {
    const amount = bet.value;
    postBtn.innerHTML = `<span>Post challenge</span><span class="sub">Bet ${fmt(amount)} · win ${fmt(amount * 2)}</span>`;
    postBtn.disabled = busy || !online;
    if (!online) {
      openList.innerHTML = '<li class="duels-empty">1v1 needs the online casino server.</li>';
      mineList.innerHTML = '';
      countEl.textContent = '';
      return;
    }
    if (!store.signedIn) {
      openList.innerHTML = '<li class="duels-empty">Log in to see and accept challenges.</li>';
      mineList.innerHTML = '';
      countEl.textContent = '';
      return;
    }
    countEl.textContent = open.length ? String(open.length) : '';
    openList.innerHTML = open.length
      ? open.map((d) => `<li class="duel-row">
          <span class="duel-avatar" aria-hidden="true">${esc((d.host || '?')[0].toUpperCase())}</span>
          <span class="duel-who"><b>${esc(d.host)}</b><small>bet ${fmt(d.host_bet)} · ${ago(now() - d.opened)}</small></span>
          <button type="button" class="btn btn-outline duel-accept" data-accept="${d.id}" ${busy ? 'disabled' : ''}>Accept<small>bet ${fmt(amount)}</small></button>
        </li>`).join('')
      : `<li class="duels-empty">${loaded ? 'No open challenges right now. Post one!' : failure ? esc(failure) : 'Loading…'}</li>`;
    mineList.innerHTML = mine.length
      ? mine.map((d) => {
          const o = duelOutcome(d, unit);
          let tag, text;
          if (d.state === 'hosting' || d.state === 'guesting') [tag, text] = ['live', `Playing… vs ${esc(d.seat === 1 ? d.host : 'anyone')}`];
          else if (d.state === 'open') [tag, text] = ['wait', `Waiting for an opponent · you scored ${o.mine ?? 0} · ${left(d.expires - now())}`];
          else if (d.state === 'expired') [tag, text] = ['back', `Nobody accepted · ${fmt(d.host_bet)} refunded`];
          else if (o.kind === 'win') [tag, text] = ['win', `Won ${fmt(o.pay)} vs ${esc(o.rival)} · ${o.mine}–${o.theirs}`];
          else if (o.kind === 'tie') [tag, text] = ['back', `Tie vs ${esc(o.rival)} · ${o.mine}–${o.theirs} · refunded`];
          else [tag, text] = ['loss', `Lost ${fmt(o.stake)} vs ${esc(o.rival)} · ${o.mine}–${o.theirs}`];
          return `<li class="duel-row is-${tag}"><span class="duel-tag">${{ live: 'LIVE', wait: 'OPEN', back: 'EVEN', win: 'WON', loss: 'LOST' }[tag]}</span><span class="duel-text">${text}</span></li>`;
        }).join('')
      : '<li class="duels-empty">Your challenges and results show up here.</li>';
  }

  async function refresh() {
    clearTimeout(timer);
    if (destroyed) return;
    if (online && store.signedIn) {
      const r = await engine.duelList(game);
      if (destroyed) return;
      if (!r?.ok && r?.error !== 'auth') failure = errorText(r, 'Challenges are unavailable right now.');
      if (r?.ok) {
        loaded = true;
        failure = '';
        serverNow = r.server_now;
        at = performance.now();
        open = r.open || [];
        mine = r.mine || [];
        // A challenge of yours settled while you were elsewhere: say so, and pick up the chips.
        let settled = false;
        for (const d of mine) {
          const before = known.get(d.id);
          if (before && before !== d.state && (d.state === 'done' || d.state === 'expired') && d.seat === 0) {
            settled = true;
            const o = duelOutcome(d, unit);
            if (d.state === 'expired') toast(`Nobody took your challenge · ${fmt(d.host_bet)} refunded`, { iconName: 'info' });
            else toast(o.kind === 'win' ? `${o.rival} took your challenge: you won ${fmt(o.pay)}! (${o.mine}–${o.theirs})`
              : o.kind === 'tie' ? `${o.rival} tied your challenge · bet refunded` : `${o.rival} beat your challenge (${o.theirs}–${o.mine})`,
              { type: o.kind === 'win' ? 'win' : o.kind === 'loss' ? 'loss' : undefined });
          }
          known.set(d.id, d.state);
        }
        if (settled) store.refresh();
        else store.sync(r);
      }
    }
    render();
    if (visible && !document.hidden) timer = setTimeout(refresh, POLL_MS);
  }

  async function start(target) {
    if (busy || !canStart()) return;
    if (!online) return toast(errorText({ error: 'multiplayer_unavailable' }));
    if (!needAccount()) return;
    const t = tryBet(game, bet);
    if (!t) return;
    busy = true;
    render();
    const r = target ? await engine.duelJoin(target, t.amount) : await engine.duelCreate(game, t.amount);
    busy = false;
    if (!r?.ok) {
      serverRefused(t, r, bet);
      render();
      refresh();
      return;
    }
    store.confirm(t, r, { debited: t.amount });
    known.set(r.duel.id, r.duel.state);
    render();
    if (destroyed) {
      // The page went away while the server answered: the run is given up (score 0).
      finish({ duel: r.duel, ticket: t }, game === 'rooster' ? { moves: [], end_ms: 0 } : { start: 0, flaps: [], frames: 0 });
      return;
    }
    onStart({ duel: r.duel, ticket: t, role: target ? 'guest' : 'host' });
  }

  /** Send a finished run. Resolves to the challenge as the server now sees it (or null). */
  async function finish(active, run) {
    const r = await engine.duelFinish(active.duel.id, run);
    if (!r?.ok) {
      store.cancel(active.ticket);
      if (r?.error !== 'auth') toast(errorText(r), { type: 'loss' });
      store.refresh();
      return null;
    }
    const d = r.duel;
    known.set(d.id, d.state);
    if (d.state === 'done') {
      store.confirm(active.ticket, r, { paid: Number(d.payout) || 0 });
      store.finish(active.ticket, d.entry);
    } else {
      // Posted: the bet stays staked until someone accepts; it settles on the server then.
      store.confirm(active.ticket, r);
      store.finish(active.ticket, null);
    }
    if (!destroyed) refresh();
    return d;
  }

  postBtn.addEventListener('click', () => start(null));
  openList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accept]');
    if (b) start(b.dataset.accept);
  });
  bet.el.addEventListener('change', render);
  bet.el.addEventListener('input', render);
  const onVisible = () => !document.hidden && visible && refresh();
  document.addEventListener('visibilitychange', onVisible);
  const offStore = engine.on((type) => type === 'signedin' && visible && refresh());
  render();

  return {
    el,
    refresh,
    finish,
    start,
    /** Show or hide the panel; polling runs only while it's shown. */
    show(on) {
      visible = on;
      el.hidden = !on;
      if (on) refresh();
      else clearTimeout(timer);
    },
    setBusy(on) {
      busy = on;
      render();
    },
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      offStore();
    },
  };
}
