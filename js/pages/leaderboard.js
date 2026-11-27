// Leaderboard: top balances among players signed in with GitHub.

import { esc, fmt, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { cloud } from '../cloud.js';
import { store } from '../store.js';
import { CONFIG } from '../config.js';

const avatar = (url, name = '', cls = '') =>
  url
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="ph ${cls}">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`;

export default {
  title: 'Leaderboard',
  mount(view) {
    let destroyed = false;
    view.innerHTML = `
      <section class="wrap page-head">
        <span class="kicker">Hall of fame</span>
        <h1 class="page-title display">Leader<em>board</em></h1>
        <p class="page-lede">The biggest stacks of fake chips on CrankedCasino. Sign in with GitHub to get your avatar up here.</p>
      </section>
      <section class="wrap" data-body></section>`;
    const body = view.querySelector('[data-body]');

    if (!cloud.enabled) {
      const st = store.state.stats;
      body.innerHTML = `
        <div class="panel setup-card" data-reveal>
          <h2 class="section-title" style="font-size:clamp(36px,8vw,56px)">Coming <em>soon</em></h2>
          <p class="muted">The leaderboard goes live once GitHub sign-in is switched on for this site. Until then your progress is saved in this browser.</p>
          <div class="kpis" style="margin-top:6px">
            <div class="kpi"><span>Your balance</span><strong>${fmt(store.balance)}</strong></div>
            <div class="kpi"><span>Biggest win</span><strong>${fmt(st.biggestWin)}</strong></div>
          </div>
          <p class="dim" style="font-size:14px">Site owner? Follow “Turn on GitHub sign-in” in the <a href="${esc(CONFIG.repoUrl)}#turn-on-github-sign-in" target="_blank" rel="noopener" style="text-decoration:underline">README</a>. It takes about five minutes on the Supabase free tier.</p>
        </div>`;
      return () => {};
    }

    const render = async () => {
      body.innerHTML = `<div class="panel empty"><span class="spinner" style="margin:0 auto"></span></div>`;
      const { data, error } = await cloud.leaderboard(50);
      if (destroyed) return;
      if (error || !data) {
        body.innerHTML = `<div class="panel empty">Couldn’t load the leaderboard right now. <button class="link-arrow" data-retry style="margin-left:6px">Try again ${icon('refresh')}</button></div>`;
        return;
      }
      const me = cloud.user?.login;
      const top = data.slice(0, 3);
      const podium = top.length
        ? `<div class="podium">${top
            .map(
              (p, i) => `<div class="pod p${i + 1}">
                <span class="rk">${i + 1}</span>
                ${avatar(p.avatar_url, p.username)}
                <span class="nm">@${esc(p.username)}</span>
                <span class="bl">${fmt(p.balance)}</span>
              </div>`,
            )
            .join('')}</div>`
        : '';
      const rows = data
        .map(
          (p, i) => `<tr class="${me && p.username === me ? 'me' : ''}">
            <td>${i + 1}</td>
            <td><span class="who">${avatar(p.avatar_url, p.username)}<span>@${esc(p.username)}</span></span></td>
            <td class="tnum hide-sm">${fmt(p.biggest_win)}</td>
            <td class="tnum"><strong>${fmt(p.balance)}</strong></td>
          </tr>`,
        )
        .join('');
      body.innerHTML = `
        ${podium}
        <div class="panel lb-table">
          <div class="gh-head" style="padding-top:12px"><h2>Top ${data.length}</h2><button class="btn btn-outline btn-sm" data-retry>${icon('refresh')}<span>Refresh</span></button></div>
          ${
            data.length
              ? `<div class="table-scroll"><table class="bets"><thead><tr><th>#</th><th>Player</th><th class="hide-sm">Biggest win</th><th>Balance</th></tr></thead><tbody>${rows}</tbody></table></div>`
              : `<div class="empty">Nobody’s here yet. Sign in and claim the top spot.</div>`
          }
        </div>
        ${
          cloud.user
            ? `<p class="dim" style="margin-top:14px;font-size:14px">You’re playing as <strong>@${esc(cloud.user.login)}</strong>. Your balance syncs ${cloud.status === 'synced' ? 'automatically' : 'when you’re back online'}.</p>`
            : `<div class="panel setup-card" style="margin-top:16px"><h2 class="gh-head" style="margin:0"><span style="font-family:var(--font-display);font-size:32px;font-weight:400">Want in?</span></h2><p class="muted">Sign in with GitHub and your current chips come with you.</p><div><button class="btn btn-primary" data-signin>${icon('github')}<span>Sign in with GitHub</span></button></div></div>`
        }`;
    };
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) render();
      if (e.target.closest('[data-signin]')) cloud.signIn();
    });
    render();
    const off = cloud.onChange(() => !destroyed && cloud.ready && render());
    return () => {
      destroyed = true;
      off();
    };
  },
};
