import { esc, fmt, reducedMotion } from '../util.js?v=0f27056399f9';
import { soundOn, setSound, haptic } from '../sound.js?v=0f27056399f9';
import { caseItem, CASE_ROUND_MS } from './cases-data.js?v=0f27056399f9';
import { caseVictorySound } from './cases-audio.js?v=0f27056399f9';

// A decisive score victory, independent of wager size or which player is watching.
export function dominantWin(scores) {
  if (!Array.isArray(scores) || scores.length !== 2 || scores.some(n => !Number.isFinite(n) || n < 0)) return null;
  const winner = scores[0] > scores[1] ? 0 : 1;
  const margin = scores[winner] - scores[1 - winner];
  return margin >= 150 && scores[winner] >= scores[1 - winner] * 1.75 ? { winner, margin } : null;
}

function firstViewing(battle) {
  const key = `${battle.id}:${battle.started}`;
  try {
    const seen = JSON.parse(sessionStorage.getItem('cc:cases:celebrations') || '[]');
    if (seen.includes(key)) return false;
    sessionStorage.setItem('cc:cases:celebrations', JSON.stringify([...seen.slice(-39), key]));
  } catch { /* An unavailable session store must not prevent the result screen. */ }
  return true;
}

export function caseVictory(battle, { clock = Date.now(), onClose } = {}) {
  const win = dominantWin(battle.totals);
  if (!win || battle.state !== 'complete' || clock - battle.started > CASE_ROUND_MS * 3 + 15000 || !firstViewing(battle)) return null;
  const player = battle.players[win.winner];
  const items = battle.pulls.map((pull, round) => caseItem(battle.cases[round], pull[win.winner]));
  const best = items.reduce((a, b) => a.value >= b.value ? a : b);
  const reduced = reducedMotion();
  const dialog = document.createElement('dialog');
  dialog.className = `cv-takeover${reduced ? ' cv-reduced' : ''}`;
  dialog.setAttribute('aria-label', `${player.name} wins by ${win.margin} points`);
  dialog.style.setProperty('--victory-color', best.color);
  dialog.innerHTML = `<div class="cv-fx" aria-hidden="true"><div class="cv-rays"></div><div class="cv-shockwave"></div></div>
    <div class="cv-confetti" aria-hidden="true">${Array.from({length:36},(_,i)=>`<i style="--i:${i};--left:${(i*37)%101}%;--drift:${(i%7-3)*45}px;--delay:${i%9*.065}s;--spin:${i*79}deg"></i>`).join('')}</div>
    <header class="cv-top"><span>CRANKED · CASE BATTLES</span><button class="cv-sound" type="button" aria-pressed="${soundOn()}">Sound ${soundOn()?'on':'off'}</button></header>
    <div class="cv-center"><div class="cv-emblem" aria-hidden="true"><span class="cv-orbit"></span><svg viewBox="0 0 160 120"><defs><linearGradient id="cv-gold" x2=".7" y2="1"><stop stop-color="#fff3c6"/><stop offset=".5" stop-color="#ffd179"/><stop offset="1" stop-color="#a65d20"/></linearGradient></defs><path d="M26 39 51 60 80 20 109 60 134 39 123 94H37Z" fill="url(#cv-gold)" stroke="#fff0be" stroke-width="3"/><path d="M39 104H121" stroke="#ffe4a2" stroke-width="8" stroke-linecap="round"/><circle cx="26" cy="34" r="8" fill="#fff0be"/><circle cx="80" cy="14" r="9" fill="#fff0be"/><circle cx="134" cy="34" r="8" fill="#fff0be"/><path d="m80 53 10 13-10 13-10-13Z" fill="#462441"/></svg></div>
    <p class="cv-kicker">ABSOLUTE DOMINATION</p><h2 class="cv-name">${esc(player.name)}</h2><p class="cv-wins">TAKES THE CROWN${player.bot?' · BOT':''}</p>
    <div class="cv-score"><span>${battle.totals[win.winner]}</span><small>TO</small><span>${battle.totals[1-win.winner]}</span></div><div class="cv-margin">+${win.margin} POINT VICTORY</div>
    <div class="cv-relic"><img src="assets/cases/${best.id}.webp?v=2" alt=""><div><small>WINNING COLLECTION</small><strong>${esc(best.name)}</strong><span>${battle.practice ? 'Practice · no chips wagered' : `${fmt(battle.pot)} chip pot awarded`}</span></div></div></div>
    <footer class="cv-bottom"><button class="cv-continue" type="button" autofocus>View results <span aria-hidden="true">↗</span></button><span class="cv-duration" aria-hidden="true"><i></i></span></footer>`;
  const before = document.activeElement;
  const oldOverflow = document.documentElement.style.overflow;
  let closed = false, timeout;
  function cleanup() {
    if (closed) return;
    closed = true;
    clearTimeout(timeout);
    dialog.getAnimations({subtree:true}).forEach(animation=>animation.cancel());
    if (dialog.open) dialog.close();
    dialog.remove();
    document.documentElement.style.overflow = oldOverflow;
    if (before?.isConnected) before.focus({preventScroll:true});
    onClose?.();
  }
  dialog.querySelector('.cv-continue').addEventListener('click', cleanup);
  dialog.querySelector('.cv-sound').addEventListener('click', event => {
    setSound(!soundOn());
    event.currentTarget.textContent = `Sound ${soundOn()?'on':'off'}`;
    event.currentTarget.setAttribute('aria-pressed',String(soundOn()));
  });
  dialog.addEventListener('close',cleanup);
  document.body.append(dialog);
  document.documentElement.style.overflow = 'hidden';
  dialog.showModal();
  timeout = setTimeout(cleanup, 7200);
  if (!reduced) { caseVictorySound(); if (battle.seat === win.winner) haptic([20,45,30]); }
  return cleanup;
}
