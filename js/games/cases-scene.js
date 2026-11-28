import { caseVictory } from './cases-victory.js?v=c5acb968c265';
import { CASE_ROUND_MS, caseById, drawCase, itemsForCase, caseItem, caseEntries } from './cases-data.js?v=c5acb968c265';
import { random } from '../rng.js?v=c5acb968c265';
import { esc, reducedMotion, fmt } from '../util.js?v=c5acb968c265';
import { sfx, soundOn, setSound, haptic } from '../sound.js?v=c5acb968c265';

import { caseCover, warmCasePreview, caseEffectMarkup } from './cases-showcase.js?v=c5acb968c265';

import { caseOpeningSound, itemRevealSound, previewItemSound, caseCue } from './cases-audio.js?v=c5acb968c265';
import { arenaFx, GOLD } from './cases-fx.js?v=c5acb968c265';

const art = (name) => `assets/cases/${name}.webp?v=2`;
const STOP = 25;
const COUNT_MS = 820;
const TIER_LABEL = { Special: '✦ SPECIAL DROP', Legendary: '✦ LEGENDARY', Epic: '✦ EPIC' };
const turntables = new Set();
const turnFrame = (el, frame) => { el.style.backgroundPosition = `${frame % 6 * 20}% ${Math.floor(frame / 6) * 100 / 3}%`; };
const warmJobs = new Map();
export function warmCaseArt(ids = ['after-hours']) {
  const items = [...new Map(ids.flatMap(itemsForCase).map(item => [item.id, item])).values()];
  return Promise.all(items.map(({id}) => {
    if (!warmJobs.has(id)) warmJobs.set(id, (async () => {
      const still = new Image(); still.src = art(id);
      try { await still.decode(); } catch { return; }
      const turn = new Image(); turn.src = art(`${id}-turn`);
      try { await turn.decode(); turntables.add(id); } catch { /* Sharp still art remains usable. */ }
    })());
    return warmJobs.get(id);
  }));
}

function playerMarkup(player, side, seat, entry) {
  const name = player?.name || 'Open seat';
  return `<article class="cb-player" data-player="${side}" aria-label="${esc(name)} openings">
    <div class="cb-player-head"><span class="cb-avatar">${esc(name[0])}</span><div class="cb-identity"><b>${esc(name)}</b><span class="cb-player-state">${player?.bot ? 'Bot' : side === seat ? 'You' : 'Opponent'}</span></div><span class="cb-total">0<span> points</span></span></div>
    <div class="cb-player-wager"><span>${entry == null ? 'PRACTICE' : `BET <strong>${fmt(entry)}</strong> chips`}</span><span class="ca-seat">0${side + 1}</span></div><div class="cb-window">
      <div class="ca-chamber" aria-hidden="true"><div class="ca-horizon"></div><svg class="ca-gate" viewBox="0 0 240 240" fill="none"><circle class="ca-gate-rim" cx="120" cy="120" r="108"/><circle class="ca-gate-ticks" cx="120" cy="120" r="101"/><g class="ca-gate-rotor"><path d="M37 67A98 98 0 0 1 203 67M203 173A98 98 0 0 1 37 173"/><path d="M59 43 67 53M181 43 173 53M59 197 67 187M181 197 173 187"/></g><path class="ca-gate-inner" d="M64 173A77 77 0 1 1 176 173"/></svg><div class="ca-speed">${Array.from({length:5},(_,i)=>`<i style="--streak:${i}"></i>`).join('')}</div><div class="ca-plinth"><i></i><b></b></div><div class="ca-lock"><i></i><i></i></div></div>
      <div class="cb-track" aria-hidden="true"></div><div class="cb-pointer" aria-hidden="true"></div><div class="cb-impact" aria-hidden="true"></div><div class="cb-particles" aria-hidden="true"></div><span class="cb-drop-badge" aria-hidden="true"></span><span class="cb-score-flight" aria-hidden="true"></span></div>
    <div class="cb-result"><span class="cb-result-tier">NEXT PULL</span><strong class="cb-result-name">Opening soon</strong><span class="cb-result-value">—</span></div>
    <div class="ca-collection-label"><span>COLLECTION</span><i></i></div><div class="cb-history" aria-label="Collected items">${Array.from({ length: 3 }, (_, i) => `<button class="cb-past" type="button" disabled aria-label="Round ${i + 1} unopened"><span class="ca-empty">0${i + 1}</span></button>`).join('')}</div>
  </article>`;
}

export function caseScene(container, initial, { onBack, onFinish }) {
  const root = document.createElement('section');
  root.id = 'case-openings';
  root.setAttribute('aria-label', 'Case battle');
  root.innerHTML = `<header class="cb-header"><div><div class="cb-brand"><i aria-hidden="true"></i> CRANKED ORIGINALS</div><h2>Case battle<span class="ca-title-mark" aria-hidden="true"> / </span><small>THE REVEAL</small></h2></div><span class="cb-mode">${initial.practice ? 'Practice' : '1 vs 1'}</span></header>
    <div class="cb-case-stage"><div class="cb-case-copy"><span class="cb-caption"></span><strong class="cb-round-label">Getting ready</strong><div class="cb-rounds" aria-label="Three cases"><span></span><span></span><span></span></div></div>
    ${caseEffectMarkup()}<div class="cb-case-rays" aria-hidden="true"></div><div class="cb-case-halo" aria-hidden="true"></div><div class="cb-case-sparks" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => `<i style="--spark:${i}"></i>`).join('')}</div><img class="cb-case-art" src="${caseCover(initial.cases[0])}" alt="Cranked item case"><span class="cb-case-art cb-case-film" aria-hidden="true"></span><div class="cb-case-status"></div></div>
    <div class="cb-duel"><div class="cb-duel-caption"><span class="cb-momentum" role="status">Three cases. One winner.</span><span class="cb-pot">${initial.practice ? 'FREE PRACTICE' : `${fmt(initial.pot ?? 100)} CHIP POT`}</span></div><div class="cb-balance" aria-hidden="true"><i></i><b></b></div></div>
    <div class="cb-battle"><span class="ca-versus" aria-hidden="true">VS</span>${initial.players.map((player, i) => playerMarkup(player, i, initial.seat, initial.practice ? null : caseEntries(initial)[i])).join('')}</div>
    <div class="cb-finale" hidden><span class="cb-finale-crown" aria-hidden="true">♛</span><div><span class="cb-finale-kicker"></span><strong></strong><p></p></div><div class="cb-confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--n:${i};--drift:${(i % 5 - 2) * 32}px"></i>`).join('')}</div></div>
    <div class="cb-footer"><div class="cb-verdict" role="status">${initial.practice ? 'Practice · no chips wagered' : `${fmt(initial.pot ?? 100)} chip pot · highest score wins`}</div><div class="cb-actions"><button class="cb-sound" type="button" aria-pressed="${soundOn()}">Sound ${soundOn() ? 'on' : 'off'}</button><button class="cb-start" type="button">Back to battles</button></div></div>`;
  container.replaceChildren(root);
  const fx = arenaFx(root);
  const battleEl = root.querySelector('.cb-battle');
  const players = [...root.querySelectorAll('.cb-player')];
  const windows = players.map((player) => player.querySelector('.cb-window'));
  const tracks = players.map((player) => player.querySelector('.cb-track'));
  const totals = players.map((player) => player.querySelector('.cb-total'));
  const verdict = root.querySelector('.cb-verdict');
  const caseArt = root.querySelector('img.cb-case-art');
  const caseFilm = root.querySelector('.cb-case-film');
  const openingArt = new Map();
  const status = root.querySelector('.cb-case-status');
  const roundLabel = root.querySelector('.cb-round-label');
  const momentum = root.querySelector('.cb-momentum');
  const balance = root.querySelector('.cb-balance');
  const finale = root.querySelector('.cb-finale');
  battleEl.append(finale);
  let closeVictory = null, tensionAt = -1, geo = null;
  const leaders = [];
  let battle = initial, serverTime = Date.now(), receivedAt = performance.now(), hasClock = false;
  let round = -1, phaseName = '', cards = [], orbitRadii = [];
  const trackPositions = [];
  const orbitCards = [[], []], orbitVisible = [new Set(), new Set()];
  let orbitDirty = true, currentTravel = 0;
  let raf = 0, destroyed = false, complete = false, lastFrame = -1, lastTick = -1, lastCountdown = -1;
  let lastVisible = -1, shownTotals = [0, 0], countFrom = [0, 0], countTo = [0, 0], countAt = 0;
  let hadPull = false;
  let leader = -1, revealSprites = [], spriteFrame = -1, inspector = null, inspectorSource = null;
  [...new Set(initial.cases)].forEach(id => warmCasePreview(id).then(image => { if (!destroyed && image) { openingArt.set(id, image); wake(); } }));

  players.forEach((player) => {
    const particles = player.querySelector('.cb-particles');
    for (let i = 0; i < 20; i++) {
      const shard = document.createElement('i');
      const angle = i * Math.PI / 10;
      shard.style.setProperty('--x', `${Math.cos(angle) * (65 + i % 3 * 20)}px`);
      shard.style.setProperty('--y', `${Math.sin(angle) * 70}px`);
      shard.style.setProperty('--rotate', `${i * 49}deg`);
      shard.style.setProperty('--delay', `${i % 4 * .025}s`);
      particles.append(shard);
    }
  });

  function cardFor(index) {
    const item = caseItem(battle.cases[round], index);
    const card = document.createElement('div');
    card.className = `cb-item${index === 5 ? ' cb-sealed' : ''}`;
    card.style.setProperty('--item-color', item.color);
    card.innerHTML = `<div class="cb-item-aura"></div><img src="${art(item.id)}" alt="" draggable="false"><span class="cb-item-name">${item.name}</span>${index === 5 ? '<div class="cb-special"><b>?</b><span>SPECIAL ITEM</span></div>' : ''}`;
    return card;
  }

  function measure() {
    tracks.forEach((track, side) => {
      // Layout size controls culling only. CSS centers the item immediately on resize.
      const width = parseFloat(getComputedStyle(track).getPropertyValue('--orbit-item-width')) || 176;
      orbitRadii[side] = Math.ceil(track.parentElement.clientWidth / (2 * (width + 6))) + 1;
    });
    orbitDirty = true;
    const box = fx.at(battleEl, 0, 0);
    geo = { box, slam: { x: box.x + box.w / 2, y: box.y + box.h * .3 }, caseArt: fx.at(caseArt, .5, .55),
      windows: windows.map((win) => fx.at(win, .5, .47)), totals: totals.map((total) => fx.at(total, .75, .4)), bar: fx.at(balance, 0, .5) };
    positionTracks(currentTravel, reducedMotion());
  }

  // Accelerate, sweep, then brake to an exact stop. Integrating the velocity keeps
  // both joins smooth; the server-selected item always lands at STOP.
  function openingTravel(p) {
    if (p < .12) return 1.5625 * p * p / .24;
    if (p < .55) return 1.5625 * (p - .06);
    return 1.5625 * (.49 + .15 * (1 - ((1 - p) / .45) ** 3));
  }
  function projectOrbit(side, travel, reduce) {
    const center = 2 + (STOP - 2) * travel;
    const radius = orbitRadii[side];
    const first = Math.max(0, Math.floor(center - radius)), last = Math.min(28, Math.ceil(center + radius));
    const visible = orbitVisible[side];
    for (const index of visible) {
      if (index < first || index > last) { orbitCards[side][index].remove(); visible.delete(index); }
    }
    for (let index = first; index <= last; index++) {
      const card = orbitCards[side][index];
      if (!visible.has(index)) card.style.left = `calc(${index} * (var(--orbit-item-width) + 6px))`;
      if (!visible.has(index)) { tracks[side].append(card); visible.add(index); }
      const distance = reduce ? 0 : Math.max(-2.5, Math.min(2.5, (index - center) / 1.65));
      const depth = Math.min(1, Math.abs(distance));
      // Transform only the handful of visible items, with no per-frame layout reads.
      card.style.transform = `perspective(650px) translateY(${(distance * distance * 17).toFixed(1)}px) rotateY(${(-distance * 32).toFixed(1)}deg) rotateZ(${(distance * 6).toFixed(1)}deg) scale(${(1 - depth * .32).toFixed(3)})${side === 1 ? ' scaleX(-1)' : ''}`;
    }
  }
  function positionTracks(travel, reduce) {
    tracks.forEach((track, side) => {
      const position = (2 + (STOP - 2) * travel).toFixed(5);
      if (trackPositions[side] !== position || orbitDirty) {
        trackPositions[side] = position;
        const offset = `calc(.5 * var(--orbit-item-width) + ${position} * (var(--orbit-item-width) + 6px))`;
        track.style.transform = side === 1 ? `translate3d(${offset},0,0) scaleX(-1)` : `translate3d(calc(-1 * ${offset}),0,0)`;
        projectOrbit(side, travel, reduce);
      }
    });
    orbitDirty = false;
  }

  function prepare(index) {
    round = index;
    phaseName = '';
    lastFrame = lastTick = -1;
    revealSprites = [];
    spriteFrame = -1;
    hadPull = false;
    currentTravel = 0;
    cards = [];
    root.classList.remove('cb-opening', 'cb-unlocking');
    fx.tension(false);
    tensionAt = -1;
    const type = caseById(battle.cases[index]);
    root.style.setProperty('--case-color', type.color);
    root.style.setProperty('--case-accent', type.color);
    root.dataset.effect = type.effect || 'classic';
    root.style.setProperty('--case-hue', `${type.hue}deg`);
    root.querySelector('.cb-caption').textContent = `${type.name.toUpperCase()} CASE`;
    root.querySelectorAll('.cb-rounds span').forEach((el, i) => { el.className = i < index ? 'cb-done' : i === index ? 'cb-current' : ''; });
    caseArt.src = caseCover(type.id);
    root.classList.remove('cb-filming');
    players.forEach((player, side) => {
      player.classList.remove('cb-rare', 'cb-hit', 'cb-winner', 'cb-show', 'cb-premium', 'cb-tell');
      player.querySelector('.cb-drop-badge').textContent = '';
      player.querySelector('.cb-score-flight').textContent = '';
      const track = tracks[side];
      track.replaceChildren();
      orbitVisible[side].clear();
      orbitCards[side] = [];
      for (let i = 0; i < 29; i++) {
        // Presentation filler has no role in the actual item selection.
        const item = drawCase(battle.cases[index], random);
        const card = cardFor(item);
        // Keep distant filler detached. Only nearby items enter the render tree.
        orbitCards[side].push(card);
        if (i === STOP) cards[side] = card;
      }
      player.querySelector('.cb-result-tier').textContent = type.name.toUpperCase();
      player.querySelector('.cb-result-tier').style.color = '';
      player.querySelector('.cb-result-name').textContent = 'Opening soon';
      player.querySelector('.cb-result-value').textContent = '—';
    });
    measure();
  }

  function applyPull() {
    if (hadPull || !battle.pulls[round]) return;
    hadPull = true;
    cards.forEach((card, side) => {
      const replacement = cardFor(battle.pulls[round][side]);
      card.replaceWith(replacement);
      cards[side] = replacement;
      orbitCards[side][STOP] = replacement;
      orbitVisible[side].delete(STOP);
    });
    orbitDirty = true;
  }

  function setPhase(next, quiet) {
    if (phaseName === next) return;
    phaseName = next;
    root.dataset.phase = next;
    if (next === 'unlock') {
      root.classList.add('cb-unlocking');
      status.textContent = 'Unlocking case';
      if (!quiet) {
        caseOpeningSound(battle.cases[round]);
        caseCue.round(round === 2);
        fx.slam(geo.slam.x, geo.slam.y, round === 2 ? 'FINAL ROUND' : `ROUND ${round + 1}`, { kind: 'round', color: caseById(battle.cases[round]).color, life: 900 });
        openCaseFx();
      }
    }
    if (next === 'spin') {
      root.classList.add('cb-opening');
      status.textContent = 'In orbit';
      if (!quiet) caseCue.riser();
      players.forEach((player) => { player.querySelector('.cb-result-name').textContent = 'Opening…'; });
    }
    if (next === 'land') {
      status.textContent = 'Pull locked';
      cards.forEach((card) => card.classList.add('cb-landed'));
      players.forEach((player) => player.classList.add('cb-hit'));
      if (!quiet) {
        sfx.reelStop();
        haptic(14);
        geo.windows.forEach((p) => fx.ring(p.x, p.y, { color: '#fff3dc', size: 120, life: 420 }));
      }
    }
    if (next === 'reveal') {
      root.classList.remove('cb-opening');
      fx.tension(false);
      status.textContent = 'Items revealed';
      players.forEach((player, side) => {
        const item = caseItem(battle.cases[round], battle.pulls[round][side]);
        player.style.setProperty('--drop-color', item.color);
        player.classList.add('cb-show');
        if (item.value >= 48) player.classList.add('cb-premium');
        player.querySelector('.cb-drop-badge').textContent = TIER_LABEL[item.tier] || '';
        player.querySelector('.cb-score-flight').textContent = `+${item.value}`;
        cards[side].classList.add('cb-landed', 'cb-revealed');
        cards[side].classList.remove('cb-sealed');
        if (item.tier === 'Special') player.classList.add('cb-rare');
        player.querySelector('.cb-result-tier').textContent = item.tier.toUpperCase();
        player.querySelector('.cb-result-tier').style.color = item.color;
        player.querySelector('.cb-result-name').textContent = item.name;
        player.querySelector('.cb-result-value').textContent = `+${item.value} points`;
        if (!quiet && turntables.has(item.id)) {
          const sprite = document.createElement('span');
          sprite.className = 'cb-turntable';
          sprite.style.backgroundImage = `url("${art(`${item.id}-turn`)}")`;
          cards[side].append(sprite);
          cards[side].classList.add('cb-has-turntable');
          revealSprites.push(sprite);
        }
      });
      if (!quiet) {
        battle.pulls[round].forEach((index, side) => { itemRevealSound(caseItem(battle.cases[round], index).id, side * .16); caseCue.stinger(index, side * .16); });
        if (battle.pulls[round].includes(5)) haptic([15, 30, 25]);
        revealFx();
      }
    }
  }

  // The case rattles, gathers light and bursts open as its lid lifts.
  function openCaseFx() {
    const type = caseById(battle.cases[round]);
    const p = geo.caseArt;
    [caseArt, caseFilm].forEach((el) => fx.shake(el, 3.5, 420));
    fx.later(0, () => fx.implode(p.x, p.y, { color: type.color, count: 16, radius: 140 }));
    fx.later(430, () => {
      caseCue.burst();
      fx.flare(p.x, p.y, { color: type.color, size: 300, peak: .9 });
      fx.ring(p.x, p.y, { color: type.color, size: 260, thick: true });
      fx.burst(p.x, p.y, { colors: [type.color, '#ffffff', GOLD], count: 26, speed: 260, kinds: ['spark', 'ember', 'shard'], life: 900 });
    });
  }
  // Rare pulls tip their hand a moment before the stop: the chamber glows the drop's colour,
  // the arena dims and a heartbeat thumps.
  function tensionFx(time) {
    const pulls = battle.pulls[round];
    if (!pulls || tensionAt === round) return;
    const top = Math.max(...pulls);
    if (top < 2 || time < (top >= 4 ? 3250 : 3700)) return;
    tensionAt = round;
    players.forEach((player, side) => {
      if (pulls[side] < 2) return;
      player.style.setProperty('--tell', caseItem(battle.cases[round], pulls[side]).color);
      player.classList.add('cb-tell');
    });
    if (top >= 4) { fx.tension(true); caseCue.heartbeat(); caseCue.heartbeat(.5); haptic(10); }
  }
  // The drop explodes from its chamber, then its points fly into the score as orbs. Each
  // player's burst lands with their reveal sound (160 ms apart) in its own task, so the
  // reveal frame itself only carries the DOM changes.
  function revealFx() {
    const id = battle.cases[round];
    battle.pulls[round].forEach((index, side) => fx.later(side * 160, () => {
      const item = caseItem(id, index), p = geo.windows[side], power = [0, 0, 3, 4, 7, 11][index];
      fx.reveal(p, index, item.color);
      if (power) fx.shake(battleEl, power, 460);
      if (index === 5) fx.flash(item.color, { strength: .45 });
      const n = Math.max(3, Math.min(14, Math.round(item.value / 14)));
      fx.later(300, () => fx.orbs(p, geo.totals[side], { color: item.color, count: n, delay: 40, onEach: (i) => {
        fx.pulse(totals[side]);
        if (i % 2 === side) caseCue.orb(i);
      } }));
    }));
  }

  function history(visible, quiet) {
    if (visible === lastVisible) return;
    lastVisible = visible;
    const next = [0, 0];
    players.forEach((player, side) => {
      [...player.querySelector('.cb-history').children].forEach((slot, i) => {
        if (i > visible || !battle.pulls[i]) return;
        const item = caseItem(battle.cases[i], battle.pulls[i][side]);
        next[side] += item.value;
        if (slot.dataset.item === item.id) return;
        slot.dataset.item = item.id;
        slot.dataset.round = i;
        slot.dataset.index = battle.pulls[i][side];
        slot.disabled = false;
        slot.style.setProperty('--item-color', item.color);
        slot.setAttribute('aria-label', `Inspect ${item.name}, ${item.value} points, round ${i + 1}`);
        slot.innerHTML = `<span class="ca-slot-number">0${i + 1}</span><img src="${art(item.id)}" alt=""><small>${item.value}</small>`;
      });
    });
    countFrom = [...shownTotals];
    countTo = next;
    countAt = performance.now() + (quiet ? 0 : 340);
    const nextLeader = next[0] === next[1] ? -1 : next[0] > next[1] ? 0 : 1;
    const changed = leader !== -1 && nextLeader !== -1 && leader !== nextLeader;
    if (visible >= 0) {
      momentum.textContent = nextLeader === -1 ? 'All square · tied battle' : `${changed ? 'Lead stolen! ' : ''}${battle.players[nextLeader].name} +${Math.abs(next[0] - next[1])} pts`;
      momentum.classList.toggle('cb-comeback', changed);
      leaders[visible] = nextLeader;
      // The final round's swing is announced by the result plaque instead.
      if (changed && !quiet && visible < 2) fx.later(1150, () => {
        caseCue.steal();
        const color = getComputedStyle(players[nextLeader]).getPropertyValue('--ca-player').trim() || GOLD;
        const { bar, slam } = geo, from = nextLeader === 0 ? bar.x + bar.w : bar.x;
        fx.streak(from, bar.y, nextLeader === 0 ? bar.x : bar.x + bar.w, bar.y, { color });
        fx.slam(slam.x, slam.y, 'LEAD STOLEN', { kind: 'steal', color, life: 1000 });
        fx.shake(players[nextLeader].querySelector('.cb-total'), 4, 380);
      });
    }
    leader = nextLeader;
    const ratio = next[0] + next[1] ? next[0] / (next[0] + next[1]) : .5;
    balance.style.setProperty('--share', ratio);
    balance.setAttribute('aria-label', `${next[0]} to ${next[1]} points`);
    players.forEach((player, side) => player.classList.toggle('cb-leading', side === leader));
    players.forEach((player, side) => {
      const tag = battle.players[side]?.bot ? 'Bot · ' : side === battle.seat ? 'You · ' : '';
      player.querySelector('.cb-player-state').textContent = `${tag}${next[side] === next[1 - side] ? 'Tied' : next[side] > next[1 - side] ? 'Leading' : 'Chasing'}`;
    });
  }

  function finish() {
    if (complete || battle.state !== 'complete') return;
    complete = true;
    const scores = battle.totals;
    const tied = scores[0] === scores[1];
    const winner = scores[0] > scores[1] ? 0 : 1;
    if (!tied) players[winner].classList.add('cb-winner');
    root.classList.add('cb-complete');
    finale.hidden = false;
    finale.querySelector('.cb-finale-kicker').textContent = tied ? 'HONORS EVEN' : 'BATTLE WINNER';
    finale.querySelector('strong').textContent = tied ? 'A perfect tie' : battle.players[winner].name;
    finale.querySelector('p').textContent = `${scores[0]} – ${scores[1]} points · ${battle.practice ? 'Practice complete' : tied ? 'Both wagers returned' : `${fmt(battle.pot ?? 100)} chip pot awarded`}`;
    root.querySelectorAll('.cb-rounds span').forEach((el) => { el.className = 'cb-done'; });
    players.forEach((player, side) => { player.querySelector('.cb-player-state').textContent = tied ? 'Draw' : side === winner ? 'Winner' : 'Battle complete'; });
    const result = tied ? 'Draw · wagers returned' : `${battle.players[winner].name}${battle.players[winner].bot ? ' (bot)' : ''} wins`;
    verdict.textContent = battle.practice ? `${result} · practice complete` : `${result}${battle.seat < 0 ? ` · ${fmt(battle.pot ?? 100)} chip pot` : ` · ${fmt(battle.payout)} chips returned`}`;
    status.textContent = 'Battle complete';
    root.querySelector('.cb-start').textContent = 'Battle again';
    if (!battle.practice && (tied || winner === battle.seat)) sfx.cashout();
    inspector?.close();
    const clock = serverTime + performance.now() - receivedAt;
    closeVictory = caseVictory(battle, { clock, onClose: () => {
      root.querySelector('.cb-sound').textContent = `Sound ${soundOn() ? 'on' : 'off'}`;
      root.querySelector('.cb-sound').setAttribute('aria-pressed', String(soundOn()));
    } });
    const won = !tied && winner === battle.seat, lost = !tied && battle.seat >= 0 && winner !== battle.seat;
    const comeback = !tied && leaders[1] != null && leaders[1] !== winner;
    finale.querySelector('.cb-finale-kicker').textContent = tied ? 'HONORS EVEN' : won ? (comeback ? 'COMEBACK VICTORY' : 'VICTORY') : lost ? 'DEFEAT' : comeback ? 'COMEBACK WIN' : 'BATTLE WINNER';
    finale.querySelector('.cb-finale-crown').textContent = tied ? '✦' : '♛';
    finale.classList.toggle('cb-finale-lost', lost);
    if (!tied) players[1 - winner].classList.add('cb-defeated');
    const fresh = clock - battle.started < CASE_ROUND_MS * 3 + 8000;
    root.classList.toggle('cb-finale-live', fresh && !reducedMotion());
    finale.style.top = `${(geo.windows[0].y - geo.box.y).toFixed(0)}px`;
    if (fresh && !reducedMotion()) {
      const color = tied ? '#d9d3e6' : getComputedStyle(players[winner]).getPropertyValue('--ca-player').trim() || GOLD;
      finale.style.setProperty('--win-color', color);
      if (!closeVictory) (tied ? caseCue.draw : lost ? caseCue.defeat : caseCue.victory)();
      fx.later(420, () => {
        const center = fx.at(finale);
        fx.flare(center.x, center.y, { color, size: 460, peak: .7, life: 900 });
        fx.ring(center.x, center.y, { color, size: 420, thick: true, life: 800 });
        if (lost || tied) return;
        const w = geo.windows[winner], { box } = geo;
        fx.twinkle(w.x, w.y, { colors: [GOLD, color, '#ffffff'], count: 12, radius: 140, life: 1400 });
        fx.cannons({ x: box.x + box.w * .03, y: box.y + box.h * .95 }, { x: box.x + box.w * .97, y: box.y + box.h * .95 }, [GOLD, color, '#ffffff', ...(battle.players[winner].bot ? [] : ['#ff8fc0', '#8ff0c8'])]);
      });
    } else finale.style.removeProperty('--win-color');
    onFinish?.();
  }

  function tick() {
    if (destroyed || document.hidden) { raf = 0; return; }
    const now = serverTime + performance.now() - receivedAt;
    const elapsed = now - battle.started;
    const index = Math.min(2, Math.max(0, Math.floor(elapsed / CASE_ROUND_MS)));
    if (index !== round) prepare(index);
    applyPull();
    const time = Math.max(0, Math.min(CASE_ROUND_MS, elapsed - index * CASE_ROUND_MS));
    const reduce = reducedMotion();
    const quiet = elapsed > CASE_ROUND_MS * 3 || reduce;
    if (elapsed < 0) {
      const countdown = Math.ceil(-elapsed / 1000);
      if (countdown !== lastCountdown) roundLabel.textContent = `Opening in ${countdown}`;
      if (countdown !== lastCountdown) {
        lastCountdown = countdown;
        if (!reduce && countdown <= 3) {
          caseCue.count(countdown);
          fx.slam(geo.slam.x, geo.slam.y, String(countdown), { kind: 'count', color: caseById(battle.cases[0]).color, life: 900 });
        }
      }
      status.textContent = 'Ready to open';
    } else {
      const label = `Round ${index + 1} of 3`;
      if (roundLabel.textContent !== label) roundLabel.textContent = label;
      if (time < 800) setPhase('unlock', quiet);
      else if (time < 4300 || !hadPull) setPhase('spin', quiet);
      else if (time < 4750) setPhase('land', quiet);
      else setPhase('reveal', quiet);
    }
    if (!hadPull && time >= 4300) status.textContent = 'Waiting for connection';
    if (!quiet && hadPull && phaseName === 'spin') tensionFx(time);
    const progress = Math.max(0, Math.min(1, (time - 160) / 540));
    const frame = reduce ? (progress === 1 ? 19 : 0) : Math.round(19 * progress * progress * (3 - 2 * progress));
    const atlas = openingArt.get(battle.cases[index]);
    root.classList.toggle('cb-filming', !!atlas && !reduce && progress > 0 && progress < 1);
    if (frame !== lastFrame) {
      lastFrame = frame;
      if (frame === 0 || frame === 19) caseArt.src = caseCover(battle.cases[index], frame === 19);
      if (atlas) { caseFilm.style.backgroundImage = `url("${atlas.src}")`; caseFilm.style.backgroundPosition = `${frame % 5 * 25}% ${Math.floor(frame / 5) * 100 / 3}%`; }
    }
    if (revealSprites.length) {
      const p = Math.max(0, Math.min(1, (time - 4750) / 950));
      const frame = Math.min(23, Math.floor((1 - (1 - p) ** 2.4) * 24));
      if (frame !== spriteFrame) { spriteFrame = frame; revealSprites.forEach(sprite => turnFrame(sprite, frame)); }
      if (p === 1 || reduce) {
        revealSprites.forEach(sprite => { sprite.parentElement.classList.remove('cb-has-turntable'); sprite.remove(); });
        revealSprites = [];
      }
    }
    let spin = Math.max(0, Math.min(1, (time - 800) / 3500));
    if (!hadPull) spin = Math.min(spin, .65);
    const travel = currentTravel = reduce ? (spin === 1 ? 1 : 0) : openingTravel(spin);
    positionTracks(travel, reduce);
    const tickIndex = Math.floor(travel * (STOP - 2));
    if (tickIndex !== lastTick && spin > 0 && spin < 1) { lastTick = tickIndex; if (!quiet) sfx.tick(tickIndex); }
    history(hadPull && time >= 4750 ? index : index - 1, quiet);
    const countProgress = reduce ? 1 : Math.max(0, Math.min(1, (performance.now() - countAt) / COUNT_MS));
    shownTotals = countTo.map((value, side) => Math.round(countFrom[side] + (value - countFrom[side]) * (1 - (1 - countProgress) ** 3)));
    totals.forEach((el, side) => { if (el.dataset.value !== String(shownTotals[side])) { el.dataset.value = shownTotals[side]; el.innerHTML = `${shownTotals[side]}<span> points</span>`; } });
    if (elapsed >= CASE_ROUND_MS * 3) {
      if (battle.state === 'complete') finish();
      else verdict.textContent = 'Confirming the battle result…';
    }
    if (!complete || countProgress < 1) raf = requestAnimationFrame(tick);
    else raf = 0;
  }
  function wake() { if (!raf && !destroyed && !document.hidden) raf = requestAnimationFrame(tick); }
  const resize = new ResizeObserver(() => { measure(); wake(); });
  tracks.forEach(track => resize.observe(track.parentElement));
  document.addEventListener('visibilitychange', wake);
  root.addEventListener('click', (event) => {
    const slot = event.target.closest('.cb-past[data-item]');
    if (!slot || inspector) return;
    const item = caseItem(battle.cases[Number(slot.dataset.round)], Number(slot.dataset.index));
    const type = caseById(battle.cases[Number(slot.dataset.round)]);
    const odds = type.weights[Number(slot.dataset.index)];
    inspector = document.createElement('dialog');
    inspector.className = 'cb-inspect';
    inspector.setAttribute('aria-label', item.name);
    inspector.style.setProperty('--item-color', item.color);
    inspector.innerHTML = `<button class="cb-inspect-close" type="button" aria-label="Close item" autofocus>×</button><span class="cb-inspect-tier">${item.tier}</span><h3>${item.name}</h3><div class="cb-inspect-art"><img src="${art(item.id)}" alt="${item.name}">${turntables.has(item.id) ? `<span class="cb-inspect-turn" style="background-image:url('${art(`${item.id}-turn`)}')"></span>` : ''}</div>${turntables.has(item.id) ? '<label class="cb-rotate-label">Rotate item<input type="range" min="0" max="23" value="23" aria-label="Rotate item"></label>' : ''}<div class="cb-inspect-stats"><strong>${item.value}<small>POINTS</small></strong><span>${type.name}<small>${odds}% drop chance · round ${Number(slot.dataset.round) + 1}</small></span></div><button class="cb-item-sound" type="button">Play item sound</button><p>Item value adds to your battle score.</p>`;
    root.append(inspector);
    inspectorSource = slot;
    const dialog = inspector;
    const sprite = dialog.querySelector('.cb-inspect-turn');
    if (sprite) {
      turnFrame(sprite, 23);
      // Load only the inspected item's larger atlas; phones keep the small reveal pack.
      const detail = new Image();
      detail.src = art(`${item.id}-inspect`);
      detail.decode().then(() => {
        if (dialog.isConnected) { sprite.style.backgroundImage = `url("${detail.src}")`; sprite.dataset.detail = 'ready'; }
      }).catch(() => {});
    }
    dialog.querySelector('input')?.addEventListener('input', event => {
      dialog.classList.add('cb-inspect-rotating');
      turnFrame(sprite, Number(event.target.value));
    });
    dialog.querySelector('.cb-item-sound').addEventListener('click', () => { setSound(true); root.querySelector('.cb-sound').textContent = 'Sound on'; root.querySelector('.cb-sound').setAttribute('aria-pressed','true'); previewItemSound(item.id); });
    dialog.querySelector('.cb-inspect-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => { dialog.remove(); inspector = null; if (!destroyed) inspectorSource?.focus(); });
    dialog.showModal();
  });
  root.querySelector('.cb-start').addEventListener('click', onBack);
  root.querySelector('.cb-sound').addEventListener('click', (event) => {
    setSound(!soundOn());
    event.currentTarget.textContent = `Sound ${soundOn() ? 'on' : 'off'}`;
    event.currentTarget.setAttribute('aria-pressed', String(soundOn()));
  });
  warmCaseArt(initial.cases);
  prepare(0);
  requestAnimationFrame(() => {
    if (destroyed || !root.isConnected) return;
    const top = root.getBoundingClientRect().top, margin = parseFloat(getComputedStyle(root).scrollMarginTop) || 0;
    if (top < margin - 2 || top > innerHeight * .3) root.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  });
  return {
    update(next, clock) {
      if (JSON.stringify(next.pulls) !== JSON.stringify(battle.pulls)) lastVisible = -1;
      battle = next;
      serverTime = hasClock ? Math.max(clock, serverTime + performance.now() - receivedAt) : clock;
      receivedAt = performance.now();
      hasClock = true;
      wake();
    },
    destroy() {
      destroyed = true;
      fx.destroy();
      closeVictory?.();
      inspector?.close();
      inspector?.remove();
      cancelAnimationFrame(raf);
      resize.disconnect();
      document.removeEventListener('visibilitychange', wake);
      root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    },
  };
}
