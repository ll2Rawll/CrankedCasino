// Profile: account, sync status, lifetime stats, per-game breakdown, history, reset.

import { esc, fmt, fmtMult, signed, timeAgo, countdown } from '../util.js';
import { icon } from '../icons.js';
import { store, on, GAMES, DAILY_BONUS } from '../store.js';
import { cloud, syncLabel } from '../cloud.js';
import { sfx } from '../sound.js';
import { burstAt, PALETTES } from '../fx.js';
import { toast, confirmDialog } from '../ui.js';

const TITLES = { mines: 'Mines', plinko: 'Plinko', slots: 'Slots', crash: 'Crash' };

export default {
  title: 'Profile',
  mount(view) {
    let timer = 0;
    const render = () => {
      const u = cloud.user;
      const s = store.state;
      const st = s.stats;
      const sync = syncLabel();
      const winRate = st.bets ? (st.wins / st.bets) * 100 : 0;
      const wait = store.dailyReadyIn();
      view.innerHTML = `
        <section class="wrap page-head">
          <span class="kicker">Your table</span>
          <h1 class="page-title display">Pro<em style="font-style:italic;color:var(--text-2)">file</em></h1>
        </section>
        <section class="wrap profile-top">
          <div class="panel" style="padding:20px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap">
            <div class="profile-id">
              ${u?.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : `<span class="ph">${icon('user')}</span>`}
              <div>
                <h2>${u ? '@' + esc(u.login) : 'Guest player'}</h2>
                <p style="display:flex;align-items:center;gap:6px">${icon(sync.icon).replace('<svg', '<svg width="16" height="16"')}<span>${sync.text}</span></p>
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${
                u
                  ? `<button class="btn btn-outline" data-act="signout">${icon('logout')}<span>Sign out</span></button>`
                  : `<button class="btn btn-primary" data-act="signin">${icon('github')}<span>Sign in with GitHub</span></button>`
              }
              ${
                store.canRefill()
                  ? `<button class="btn btn-primary" data-act="refill">${icon('refresh')}<span>Refill to 1,000</span></button>`
                  : `<button class="btn ${wait ? 'btn-outline' : 'btn-primary'}" data-act="daily" ${wait ? 'disabled' : ''}>${icon('gift')}<span data-daily>${wait ? `Bonus in ${countdown(wait)}` : `Claim +${fmt(DAILY_BONUS)}`}</span></button>`
              }
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
                            <td><span class="g" style="--c:var(--${esc(r.g)})"><i></i>${esc(r.g)}</span></td>
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

        <section class="wrap section">
          <div class="panel danger-zone">
            <div><strong>Start over</strong><p class="dim" style="font-size:14px">Resets balance, stats and history${u ? ' for this GitHub account' : ' on this device'}.</p></div>
            <button class="btn btn-danger" data-act="reset">${icon('refresh')}<span>Reset progress</span></button>
          </div>
        </section>`;
    };
    render();

    view.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'signin') cloud.signIn();
      if (act === 'signout') cloud.signOut();
      if (act === 'daily' && store.claimDaily()) {
        sfx.win(2);
        burstAt(b, { count: 70, colors: PALETTES.gold });
        toast(`+${fmt(DAILY_BONUS)} chips. See you tomorrow!`, { type: 'win', iconName: 'gift' });
      }
      if (act === 'refill' && store.refill()) {
        sfx.cashout();
        toast('Topped back up to 1,000 chips.', { type: 'win', iconName: 'coins' });
      }
      if (act === 'reset') {
        const ok = await confirmDialog({ title: 'Reset everything?', text: 'Your balance goes back to 1,000 and all stats and history are wiped. This can’t be undone.', confirm: 'Reset progress', danger: true });
        if (ok) {
          store.reset();
          toast('Fresh start. 1,000 chips on the table.', { iconName: 'refresh' });
        }
      }
    });

    const offs = [on('balance', render), on('reset', render), cloud.onChange(render)];
    timer = setInterval(() => {
      const el = view.querySelector('[data-daily]');
      const wait = store.dailyReadyIn();
      if (el && wait) el.textContent = `Bonus in ${countdown(wait)}`;
      else if (el && !wait && el.textContent.startsWith('Bonus in')) render();
    }, 1000);
    return () => {
      clearInterval(timer);
      offs.forEach((f) => f());
    };
  },
};
