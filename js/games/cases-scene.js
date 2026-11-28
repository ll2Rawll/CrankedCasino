import { CASE_ITEMS, CASE_ROUND_MS, caseById, drawCase } from './cases-data.js?v=88d999005677';
import { random } from '../rng.js?v=88d999005677';
import { esc, reducedMotion } from '../util.js?v=88d999005677';
import { sfx, soundOn, setSound, haptic } from '../sound.js?v=88d999005677';

const art = (name) => `assets/cases/${name}.webp`;
const STOP = 25;
let warmup;
export function warmCaseArt() {
  warmup ||= Promise.all([...CASE_ITEMS.map((item) => item.id), 'case', ...Array.from({ length: 19 }, (_, i) => `caseFrame${i}`)].map((name) => {
    const image = new Image();
    image.src = art(name);
    return image.decode().catch(() => {});
  }));
  return warmup;
}

function playerMarkup(player, side, seat) {
  const name = player?.name || 'Open seat';
  return `<article class="cb-player" data-player="${side}" aria-label="${esc(name)} openings">
    <div class="cb-player-head"><span class="cb-avatar">${esc(name[0])}</span><div class="cb-identity"><b>${esc(name)}</b><span class="cb-player-state">${player?.bot ? 'Bot' : side === seat ? 'You' : 'Opponent'}</span></div><span class="cb-total">0<span> points</span></span></div>
    <div class="cb-window"><div class="cb-track" aria-hidden="true"></div><div class="cb-pointer" aria-hidden="true"></div><div class="cb-impact" aria-hidden="true"></div><div class="cb-particles" aria-hidden="true"></div></div>
    <div class="cb-result"><span class="cb-result-tier">NEXT PULL</span><strong class="cb-result-name">Opening soon</strong><span class="cb-result-value">—</span></div>
    <div class="cb-history" aria-label="Collected items">${Array.from({ length: 3 }, () => '<div class="cb-past">·</div>').join('')}</div>
  </article>`;
}

export function caseScene(container, initial, { onBack, onFinish }) {
  const root = document.createElement('section');
  root.id = 'case-openings';
  root.setAttribute('aria-label', 'Case battle');
  root.innerHTML = `<header class="cb-header"><div><div class="cb-brand">CRANKED CASINO</div><h2>Case battle</h2></div><span class="cb-mode">${initial.practice ? 'Practice' : '1 vs 1'}</span></header>
    <div class="cb-case-stage"><div class="cb-case-copy"><span class="cb-caption"></span><strong class="cb-round-label">Getting ready</strong><div class="cb-rounds" aria-label="Three cases"><span></span><span></span><span></span></div></div>
    <div class="cb-case-rays" aria-hidden="true"></div><img class="cb-case-art" src="${art('case')}" alt="Cranked item case"><div class="cb-case-status"></div></div>
    <div class="cb-battle">${initial.players.map((player, i) => playerMarkup(player, i, initial.seat)).join('')}</div>
    <div class="cb-footer"><div class="cb-verdict" role="status">${initial.practice ? 'Practice · no chips wagered' : '100 chip pot · highest score wins'}</div><div class="cb-actions"><button class="cb-sound" type="button" aria-pressed="${soundOn()}">Sound ${soundOn() ? 'on' : 'off'}</button><button class="cb-start" type="button">Back to battles</button></div></div>`;
  container.replaceChildren(root);
  const players = [...root.querySelectorAll('.cb-player')];
  const tracks = players.map((player) => player.querySelector('.cb-track'));
  const totals = players.map((player) => player.querySelector('.cb-total'));
  const verdict = root.querySelector('.cb-verdict');
  const caseArt = root.querySelector('.cb-case-art');
  const status = root.querySelector('.cb-case-status');
  const roundLabel = root.querySelector('.cb-round-label');
  let battle = initial, serverTime = Date.now(), receivedAt = performance.now(), hasClock = false;
  let round = -1, phaseName = '', cards = [], starts = [], ends = [], widths = [];
  let raf = 0, destroyed = false, complete = false, lastFrame = -1, lastTick = -1, lastCountdown = -1;
  let lastVisible = -1, shownTotals = [0, 0], countFrom = [0, 0], countTo = [0, 0], countAt = 0;
  let hadPull = false;

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
    const item = CASE_ITEMS[index];
    const card = document.createElement('div');
    card.className = `cb-item${index === 5 ? ' cb-sealed' : ''}`;
    card.style.setProperty('--item-color', item.color);
    card.innerHTML = `<div class="cb-item-aura"></div><img src="${art(item.id)}" alt="" draggable="false"><span class="cb-item-name">${item.name}</span>${index === 5 ? '<div class="cb-special"><b>?</b><span>SPECIAL ITEM</span></div>' : ''}`;
    return card;
  }

  function measure() {
    tracks.forEach((track, side) => {
      if (!track.firstElementChild) return;
      // Use layout pixels. The app's entry animation temporarily scales the view.
      const width = track.firstElementChild.offsetWidth;
      widths[side] = width + 6;
      const center = track.parentElement.clientWidth / 2 - width / 2;
      starts[side] = center - 2 * widths[side];
      ends[side] = center - STOP * widths[side];
    });
  }

  function prepare(index) {
    round = index;
    phaseName = '';
    lastFrame = lastTick = -1;
    hadPull = false;
    cards = [];
    root.classList.remove('cb-opening', 'cb-unlocking');
    const type = caseById(battle.cases[index]);
    root.style.setProperty('--case-color', type.color);
    root.style.setProperty('--case-hue', `${type.hue}deg`);
    root.querySelector('.cb-caption').textContent = `${type.name.toUpperCase()} CASE`;
    root.querySelectorAll('.cb-rounds span').forEach((el, i) => { el.className = i < index ? 'cb-done' : i === index ? 'cb-current' : ''; });
    caseArt.src = art('case');
    players.forEach((player, side) => {
      player.classList.remove('cb-rare', 'cb-hit', 'cb-winner');
      const track = tracks[side];
      track.replaceChildren();
      for (let i = 0; i < 29; i++) {
        // Presentation filler has no role in the actual item selection.
        const item = drawCase(battle.cases[index], random);
        const card = cardFor(item);
        track.append(card);
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
    });
  }

  function setPhase(next, quiet) {
    if (phaseName === next) return;
    phaseName = next;
    if (next === 'unlock') {
      root.classList.add('cb-unlocking');
      status.textContent = 'Unlocking case';
      if (!quiet) sfx.caseUnlock();
    }
    if (next === 'spin') {
      root.classList.add('cb-opening');
      status.textContent = 'Opening reels';
      players.forEach((player) => { player.querySelector('.cb-result-name').textContent = 'Opening…'; });
    }
    if (next === 'land') {
      status.textContent = 'Revealing items';
      cards.forEach((card) => card.classList.add('cb-landed'));
      players.forEach((player) => player.classList.add('cb-hit'));
      if (!quiet) { sfx.reelStop(); haptic(14); }
    }
    if (next === 'reveal') {
      root.classList.remove('cb-opening');
      status.textContent = 'Items revealed';
      players.forEach((player, side) => {
        const item = CASE_ITEMS[battle.pulls[round][side]];
        cards[side].classList.add('cb-landed', 'cb-revealed');
        cards[side].classList.remove('cb-sealed');
        if (item.id === 'blade') player.classList.add('cb-rare');
        player.querySelector('.cb-result-tier').textContent = item.tier.toUpperCase();
        player.querySelector('.cb-result-tier').style.color = item.color;
        player.querySelector('.cb-result-name').textContent = item.name;
        player.querySelector('.cb-result-value').textContent = `+${item.value} points`;
      });
      if (!quiet) {
        if (battle.pulls[round].includes(5)) { sfx.caseRare(); haptic([15, 30, 25]); }
        else sfx.gem(round);
      }
    }
  }

  function history(visible) {
    if (visible === lastVisible) return;
    lastVisible = visible;
    const next = [0, 0];
    players.forEach((player, side) => {
      [...player.querySelector('.cb-history').children].forEach((slot, i) => {
        if (i > visible || !battle.pulls[i]) return;
        const item = CASE_ITEMS[battle.pulls[i][side]];
        next[side] += item.value;
        if (slot.dataset.item === item.id) return;
        slot.dataset.item = item.id;
        slot.setAttribute('aria-label', `${item.name}, ${item.value} points`);
        slot.innerHTML = `<img src="${art(item.id)}" alt=""><small>${item.value}</small>`;
      });
    });
    countFrom = [...shownTotals];
    countTo = next;
    countAt = performance.now();
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
    root.querySelectorAll('.cb-rounds span').forEach((el) => { el.className = 'cb-done'; });
    players.forEach((player, side) => { player.querySelector('.cb-player-state').textContent = tied ? 'Draw' : side === winner ? 'Winner' : 'Battle complete'; });
    const result = tied ? 'Draw · pot split' : `${battle.players[winner].name}${battle.players[winner].bot ? ' (bot)' : ''} wins`;
    verdict.textContent = battle.practice ? `${result} · practice complete` : `${result}${battle.seat < 0 ? ' · 100 chip pot' : ` · ${battle.payout} chips returned`}`;
    status.textContent = 'Battle complete';
    root.querySelector('.cb-start').textContent = 'Battle again';
    if (!battle.practice && (tied || winner === battle.seat)) sfx.cashout();
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
      roundLabel.textContent = `Opening in ${countdown}`;
      if (countdown !== lastCountdown) { lastCountdown = countdown; if (!reduce) sfx.click(); }
    } else {
      roundLabel.textContent = `Round ${index + 1} of 3`;
      if (time < 800) setPhase('unlock', quiet);
      else if (time < 4300 || !hadPull) setPhase('spin', quiet);
      else if (time < 4750) setPhase('land', quiet);
      else setPhase('reveal', quiet);
    }
    if (!hadPull && time >= 4300) status.textContent = 'Waiting for connection';
    const progress = Math.max(0, Math.min(1, (time - 160) / 540));
    const frame = reduce ? (progress === 1 ? 18 : 0) : Math.round(18 * progress * progress * (3 - 2 * progress));
    if (frame !== lastFrame) { lastFrame = frame; caseArt.src = art(`caseFrame${frame}`); }
    let spin = Math.max(0, Math.min(1, (time - 800) / 3500));
    if (!hadPull) spin = Math.min(spin, .65);
    const travel = reduce ? (spin === 1 ? 1 : 0) : 1 - (1 - spin) ** 3.2;
    tracks.forEach((track, side) => { track.style.transform = `translate3d(${starts[side] + (ends[side] - starts[side]) * travel}px,0,0)`; });
    const tickIndex = Math.floor(travel * (STOP - 2));
    if (tickIndex !== lastTick && spin > 0 && spin < 1) { lastTick = tickIndex; if (!quiet) sfx.tick(tickIndex); }
    history(hadPull && time >= 4750 ? index : index - 1);
    const countProgress = reduce ? 1 : Math.min(1, (performance.now() - countAt) / 380);
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
  resize.observe(root);
  document.addEventListener('visibilitychange', wake);
  root.querySelector('.cb-start').addEventListener('click', onBack);
  root.querySelector('.cb-sound').addEventListener('click', (event) => {
    setSound(!soundOn());
    event.currentTarget.textContent = `Sound ${soundOn() ? 'on' : 'off'}`;
    event.currentTarget.setAttribute('aria-pressed', String(soundOn()));
  });
  prepare(0);
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
      cancelAnimationFrame(raf);
      resize.disconnect();
      document.removeEventListener('visibilitychange', wake);
      root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    },
  };
}
