// Leaderboard: the biggest stacks on the casino, refreshed live.

import { esc, fmt } from '../util.js?v=7dd2455b7c8d';
import { icon } from '../icons.js?v=7dd2455b7c8d';
import { store, on } from '../store.js?v=7dd2455b7c8d';
import { engine, MODE } from '../engine.js?v=7dd2455b7c8d';
import { openAccount } from '../account.js?v=7dd2455b7c8d';
import { banner } from '../ads.js?v=7dd2455b7c8d';

const POLL_MS = 10000;
const initial = (name, cls = '') => `<span class="ph initial-ph ${cls}">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`;

export default {
  title: 'Leaderboard',
  mount(view) {
    let destroyed = false;
    let prev = new Map(); // username → balance, to flash rows that moved
    view.innerHTML = `
      <section class="wrap page-head">
        <span class="kicker">Hall of fame</span>
        <h1 class="page-title display">Leader<em>board</em></h1>
        <p class="page-lede">The biggest stacks of fake chips on CrankedCasino. <span class="live-pill"><i></i>Live</span> updates every few seconds.</p>
      </section>
      <section class="wrap" data-me></section>
      <section class="wrap" data-body><div class="panel empty"><span class="spinner" style="margin:0 auto"></span></div></section>
      <div class="wrap" data-ad></div>`;
    const body = view.querySelector('[data-body]');
    const meEl = view.querySelector('[data-me]');
    view.querySelector('[data-ad]').append(banner());

    const renderMe = async () => {
      if (!store.signedIn) {
        meEl.innerHTML = `<div class="panel lb-me"><div><strong>Want your name up here?</strong><p class="dim" style="font-size:14px">Make a username and start with 1,000 chips.</p></div><button class="btn btn-primary" data-join>${icon('sparkle')}<span>Create account</span></button></div>`;
        return;
      }
      const r = await engine.rank();
      if (destroyed || !r?.ok) return;
      meEl.innerHTML = `<div class="panel lb-me"><div style="display:flex;align-items:center;gap:14px"><span class="rk neon tnum">#${r.rank.toLocaleString('en-US')}</span><div><strong>${esc(store.username)}</strong><p class="dim" style="font-size:14px">of ${r.players.toLocaleString('en-US')} players · ${fmt(store.balance)} chips</p></div></div><a class="link-arrow" href="#/profile">Your stats ${icon('arrowRight')}</a></div>`;
    };

    const render = async () => {
      const data = await engine.leaderboard(50);
      if (destroyed) return;
      if (!Array.isArray(data)) {
        if (!body.querySelector('table')) body.innerHTML = `<div class="panel empty">Couldn’t load the leaderboard right now. <button class="link-arrow" data-retry style="margin-left:6px">Try again ${icon('refresh')}</button></div>`;
        return;
      }
      const me = store.username;
      const top = data.slice(0, 3);
      const podium = top.length
        ? `<div class="podium">${top
            .map(
              (p, i) => `<div class="pod p${i + 1}">
                <span class="rk">${i + 1}</span>
                ${initial(p.username)}
                <span class="nm">${esc(p.username)}</span>
                <span class="bl">${fmt(p.balance)}</span>
              </div>`,
            )
            .join('')}</div>`
        : '';
      const rows = data
        .map((p) => {
          const moved = prev.has(p.username) && prev.get(p.username) !== p.balance;
          return `<tr class="${me && p.username === me ? 'me' : ''} ${moved ? 'bump' : ''}">
            <td>${p.rank}</td>
            <td><span class="who">${initial(p.username)}<span>${esc(p.username)}</span></span></td>
            <td class="tnum hide-sm">${fmt(p.biggest_win)}</td>
            <td class="tnum hide-sm">${Number(p.bets || 0).toLocaleString('en-US')}</td>
            <td class="tnum"><strong>${fmt(p.balance)}</strong></td>
          </tr>`;
        })
        .join('');
      prev = new Map(data.map((p) => [p.username, p.balance]));
      body.innerHTML = `
        ${podium}
        <div class="panel lb-table">
          <div class="gh-head" style="padding-top:12px"><h2>Top ${data.length}</h2><button class="btn btn-outline btn-sm" data-retry>${icon('refresh')}<span>Refresh</span></button></div>
          ${
            data.length
              ? `<div class="table-scroll"><table class="bets"><thead><tr><th>#</th><th>Player</th><th class="hide-sm">Biggest win</th><th class="hide-sm">Bets</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table></div>`
              : `<div class="empty">Nobody’s here yet. Make a username and claim the top spot.</div>`
          }
        </div>
        ${MODE === 'device' ? `<p class="dim" style="margin-top:14px;font-size:14px">${icon('device').replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px;margin-right:6px"')}Offline mode: this board only shows players on this device until the casino server is connected.</p>` : ''}`;
    };

    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) {
        render();
        renderMe();
      }
    });
    meEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-join]')) openAccount();
    });
    render();
    renderMe();
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      render();
      renderMe();
    }, POLL_MS);
    const offs = [on('account', () => (render(), renderMe())), on('bet', () => setTimeout(renderMe, 300))];
    return () => {
      destroyed = true;
      clearInterval(timer);
      offs.forEach((f) => f());
    };
  },
};
