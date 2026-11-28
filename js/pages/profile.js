// Profile: account, lifetime stats, per-game breakdown, history, ad rewards, promo codes.

import { esc, fmt, fmtMult, signed, timeAgo } from '../util.js?v=e08da9841def';
import { icon } from '../icons.js?v=e08da9841def';
import { store, on, GAMES } from '../store.js?v=e08da9841def';
import { MODE } from '../engine.js?v=e08da9841def';
import { confirmDialog, promoTicket } from '../ui.js?v=e08da9841def';
import { openAccount, signOut } from '../account.js?v=e08da9841def';
import { adButton } from '../ads.js?v=e08da9841def';

const TITLES = { blackjack: 'Blackjack', roulette: 'Roulette', mines: 'Mines', plinko: 'Plinko', slots: 'Slots', crash: 'Crash', rooster: 'Road Rooster', flight: 'Night Flight', cases: 'Case Battles' };
const since = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '');

export default {
  title: 'Profile',
  mount(view) {
    let timer = 0;
    const render = () => {
      const s = store.state;
      const st = s.stats;
      const winRate = st.bets ? (st.wins / st.bets) * 100 : 0;
      if (!store.signedIn) {
        view.innerHTML = `
          <section class="wrap page-head">
            <span class="kicker">Your table</span>
            <h1 class="page-title display">Pro<em>file</em></h1>
          </section>
          <section class="wrap">
            <div class="panel setup-card">
              <h2 class="section-title" style="font-size:clamp(36px,8vw,56px)">No seat <em>yet</em></h2>
              <p class="muted">Make a username to start with 1,000 chips. Your stack and stats are saved to your account and follow you to any browser.</p>
              <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary" data-act="signup">${icon('sparkle')}<span>Create account</span></button><button class="btn btn-outline" data-act="login">${icon('user')}<span>Log in</span></button></div>
            </div>
          </section>`;
        return;
      }
      view.innerHTML = `
        <section class="wrap page-head">
          <span class="kicker">Your table</span>
          <h1 class="page-title display">Pro<em>file</em></h1>
        </section>
        <section class="wrap profile-top">
          <div class="panel" style="padding:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
            <div class="profile-id">
              <span class="avatar-initial" style="width:64px;height:64px;font-size:28px">${esc(store.username.slice(0, 1))}</span>
              <div>
                <h2>${esc(store.username)}</h2>
                <p style="display:flex;align-items:center;gap:6px">${icon(MODE === 'device' ? 'device' : 'cloud').replace('<svg', '<svg width="16" height="16"')}<span>${MODE === 'device' ? 'Saved on this device (offline mode)' : 'Saved to your account · log in on any browser'}${s.created ? ` · member since ${since(s.created)}` : ''}</span></p>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <span data-ad></span>
              <button class="btn btn-outline" data-act="signout">${icon('logout')}<span>Sign out</span></button>
            </div>
          </div>
          <div class="kpis">
            <div class="kpi big"><span>Balance</span><strong class="tnum">${fmt(store.balance)}</strong></div>
            <div class="kpi"><span>Wagered</span><strong>${fmt(st.wagered)}</strong></div>
            <div class="kpi"><span>Net profit</span><strong class="${st.profit > 0 ? 'win-text' : st.profit < 0 ? 'loss-text' : ''}">${signed(st.profit)}</strong></div>
            <div class="kpi"><span>Biggest win</span><strong>${fmt(st.biggestWin)}</strong></div>
            <div class="kpi"><span>Win rate</span><strong>${winRate.toFixed(1)}%</strong></div>
          </div>
        </section>

        <section class="wrap section" style="padding-bottom:0">
          <div class="section-head"><h2 class="section-title" style="font-size:clamp(40px,8vw,60px)">By <em>game</em></h2><span class="dim">${st.bets.toLocaleString('en-US')} bets · best ${st.bestMulti ? fmtMult(st.bestMulti) : '—'}</span></div>
          <div class="per-game">
            ${GAMES.map((g) => {
              const x = st.games[g] || { bets: 0, wagered: 0, profit: 0, bestMulti: 0, biggestWin: 0 };
              return `<a class="pg" href="#/${g}" style="--accent:var(--${g})">
                <h3>${TITLES[g]}</h3>
                <dl>
                  <dt>Bets</dt><dd>${(x.bets || 0).toLocaleString('en-US')}</dd>
                  <dt>Wagered</dt><dd>${fmt(x.wagered)}</dd>
                  <dt>Profit</dt><dd class="${x.profit > 0 ? 'win-text' : x.profit < 0 ? 'loss-text' : ''}">${signed(x.profit || 0)}</dd>
                  <dt>Best</dt><dd>${x.bestMulti ? fmtMult(x.bestMulti) : '—'}</dd>
                </dl>
              </a>`;
            }).join('')}
          </div>
        </section>

        <section class="wrap section" style="padding-bottom:0">
          <div class="panel game-history" style="margin:0">
            <div class="gh-head"><h2>Recent bets</h2><span class="dim">${s.history.length ? `Last ${Math.min(20, s.history.length)}` : ''}</span></div>
            <div class="table-scroll">
              <table class="bets">
                <thead><tr><th>Game</th><th>Bet</th><th>Multiplier</th><th>When</th><th>Payout</th></tr></thead>
                <tbody>${
                  s.history.length
                    ? s.history
                        .slice(0, 20)
                        .map(
                          (r) => `<tr>
                            <td><span class="g" style="--c:var(--${esc(r.g)})"><i></i>${esc(TITLES[r.g] || r.g)}</span></td>
                            <td>${fmt(r.a)}</td>
                            <td class="${r.m >= 1 ? 'win-text' : 'dim'}">${fmtMult(r.m)}</td>
                            <td class="dim">${timeAgo(r.t)}</td>
                            <td class="${r.p > r.a ? 'win-text' : 'dim'}">${r.p > r.a ? signed(r.p - r.a) : fmt(r.p)}</td>
                          </tr>`,
                        )
                        .join('')
                    : `<tr><td colspan="5"><div class="empty">Nothing yet. The lobby’s that way.</div></td></tr>`
                }</tbody>
              </table>
            </div>
          </div>
        </section>

        <section class="wrap section" style="padding-bottom:0">
          <div class="profile-promo ticket-glow" data-promo style="max-width:520px"></div>
          <p class="dim" style="margin-top:10px;font-size:13px">${s.promos.length ? `Redeemed: ${s.promos.map((c) => esc(c)).join(', ')}` : 'No promo codes redeemed yet. Each code works once per account.'}</p>
        </section>

        <section class="wrap section">
          <div class="panel danger-zone">
            <div><strong>About your account</strong><p class="dim" style="font-size:14px">Your chips live on the casino server, so they can’t be reset, refilled or lost by clearing your browser. Free chips come from ad breaks (+${fmt(store.adStatus().reward).replace(/\.00$/, '')}) and one-time promo codes.</p></div>
          </div>
        </section>`;
    };
    // One ticket element (and ad button) that survive re-renders, so their state stays visible.
    const ticketEl = promoTicket({ title: 'Promo code', sub: 'Codes work once per account' });
    let ad = null;
    const mountExtras = () => {
      view.querySelector('[data-promo]')?.append(ticketEl);
      const slot = view.querySelector('[data-ad]');
      if (slot) {
        ad ||= adButton({ block: false });
        slot.replaceWith(ad.el);
      }
    };
    render();
    mountExtras();

    view.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'signup' || act === 'login') openAccount({ mode: act });
      if (act === 'signout') {
        const ok = await confirmDialog({ title: 'Sign out?', text: `Your chips stay on ${store.username}. Log back in with your username and password on any browser.`, confirm: 'Sign out' });
        if (ok) signOut();
      }
    });

    const rerender = () => {
      render();
      mountExtras();
    };
    const offs = [on('balance', rerender), on('reset', rerender), on('account', rerender)];
    store.refresh();
    return () => {
      ad?.destroy();
      offs.forEach((f) => f());
    };
  },
};
