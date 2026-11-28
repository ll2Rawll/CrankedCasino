import { CASE_ITEMS, CASE_ROUND_MS, caseById, drawCase } from './cases-data.js?v=cc44f0172e88';
import { random } from '../rng.js?v=cc44f0172e88';
import { esc, reducedMotion } from '../util.js?v=cc44f0172e88';
import { sfx, soundOn, setSound, haptic } from '../sound.js?v=cc44f0172e88';

import { caseCover, warmCasePreview } from './cases-showcase.js?v=cc44f0172e88';

const art = (name) => `assets/cases/${name}.webp?v=2`;
const STOP = 25;
const turntables = new Set();
const turnFrame = (el, frame) => { el.style.backgroundPosition = `${frame % 6 * 20}% ${Math.floor(frame / 6) * 100 / 3}%`; };
let warmup;
export function warmCaseArt() {
  warmup ||= (async () => {
    await Promise.all(CASE_ITEMS.map((item) => item.id).map((name) => {
      const image = new Image();
      image.src = art(name);
      return image.decode().catch(() => {});
    }));
    // Decode the small turntables after essential reel art. Mounting never awaits this.
    await Promise.all(CASE_ITEMS.map(async ({ id }) => {
      const image = new Image();
      image.src = art(`${id}-turn`);
      try { await image.decode(); turntables.add(id); } catch { /* Static art is the fallback. */ }
    }));
  })();
  return warmup;
}

function playerMarkup(player, side, seat) {
  const name = player?.name || 'Open seat';
  return `<article class="cb-player" data-player="${side}" aria-label="${esc(name)} openings">
    <div class="cb-player-head"><span class="cb-avatar">${esc(name[0])}</span><div class="cb-identity"><b>${esc(name)}</b><span class="cb-player-state">${player?.bot ? 'Bot' : side === seat ? 'You' : 'Opponent'}</span></div><span class="cb-total">0<span> points</span></span></div>
    <div class="cb-window"><div class="cb-track" aria-hidden="true"></div><div class="cb-pointer" aria-hidden="true"></div><div class="cb-impact" aria-hidden="true"></div><div class="cb-particles" aria-hidden="true"></div><span class="cb-drop-badge" aria-hidden="true"></span><span class="cb-score-flight" aria-hidden="true"></span></div>
    <div class="cb-result"><span class="cb-result-tier">NEXT PULL</span><strong class="cb-result-name">Opening soon</strong><span class="cb-result-value">—</span></div>
    <div class="cb-history" aria-label="Collected items">${Array.from({ length: 3 }, (_, i) => `<button class="cb-past" type="button" disabled aria-label="Round ${i + 1} unopened">·</button>`).join('')}</div>
  </article>`;
}

export function caseScene(container, initial, { onBack, onFinish }) {
  const root = document.createElement('section');
  root.id = 'case-openings';
  root.setAttribute('aria-label', 'Case battle');
  root.innerHTML = `<header class="cb-header"><div><div class="cb-brand">CRANKED CASINO</div><h2>Case battle</h2></div><span class="cb-mode">${initial.practice ? 'Practice' : '1 vs 1'}</span></header>
    <div class="cb-case-stage"><div class="cb-case-copy"><span class="cb-caption"></span><strong class="cb-round-label">Getting ready</strong><div class="cb-rounds" aria-label="Three cases"><span></span><span></span><span></span></div></div>
    <div class="cb-case-rays" aria-hidden="true"></div><div class="cb-case-halo" aria-hidden="true"></div><div class="cb-case-sparks" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => `<i style="--spark:${i}"></i>`).join('')}</div><img class="cb-case-art" src="${caseCover(initial.cases[0])}" alt="Cranked item case"><span class="cb-case-art cb-case-film" aria-hidden="true"></span><div class="cb-case-status"></div></div>
    <div class="cb-duel"><div class="cb-duel-caption"><span class="cb-momentum" role="status">Three cases. One winner.</span><span class="cb-pot">${initial.practice ? 'FREE PRACTICE' : '100 CHIP POT'}</span></div><div class="cb-balance" aria-hidden="true"><i></i><b></b></div></div>
    <div class="cb-battle">${initial.players.map((player, i) => playerMarkup(player, i, initial.seat)).join('')}</div>
    <div class="cb-finale" hidden><span class="cb-finale-crown" aria-hidden="true">♛</span><div><span class="cb-finale-kicker"></span><strong></strong><p></p></div><div class="cb-confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--n:${i};--drift:${(i % 5 - 2) * 32}px"></i>`).join('')}</div></div>
    <div class="cb-footer"><div class="cb-verdict" role="status">${initial.practice ? 'Practice · no chips wagered' : '100 chip pot · highest score wins'}</div><div class="cb-actions"><button class="cb-sound" type="button" aria-pressed="${soundOn()}">Sound ${soundOn() ? 'on' : 'off'}</button><button class="cb-start" type="button">Back to battles</button></div></div>`;
  container.replaceChildren(root);
  const players = [...root.querySelectorAll('.cb-player')];
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
  let battle = initial, serverTime = Date.now(), receivedAt = performance.now(), hasClock = false;
  let round = -1, phaseName = '', cards = [], starts = [], ends = [], widths = [];
  const trackPositions = [];
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
    revealSprites = [];
    spriteFrame = -1;
    hadPull = false;
    cards = [];
    root.classList.remove('cb-opening', 'cb-unlocking');
    const type = caseById(battle.cases[index]);
    root.style.setProperty('--case-color', type.color);
    root.style.setProperty('--case-hue', `${type.hue}deg`);
    root.querySelector('.cb-caption').textContent = `${type.name.toUpperCase()} CASE`;
    root.querySelectorAll('.cb-rounds span').forEach((el, i) => { el.className = i < index ? 'cb-done' : i === index ? 'cb-current' : ''; });
    caseArt.src = caseCover(type.id);
    root.classList.remove('cb-filming');
    players.forEach((player, side) => {
      player.classList.remove('cb-rare', 'cb-hit', 'cb-winner', 'cb-show', 'cb-premium');
      player.querySelector('.cb-drop-badge').textContent = '';
      player.querySelector('.cb-score-flight').textContent = '';
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
    root.dataset.phase = next;
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
        player.style.setProperty('--drop-color', item.color);
        player.classList.add('cb-show');
        if (item.value >= 48) player.classList.add('cb-premium');
        player.querySelector('.cb-drop-badge').textContent = item.tier === 'Special' ? '✦ SPECIAL DROP' : item.tier === 'Legendary' ? '✦ LEGENDARY' : '';
        player.querySelector('.cb-score-flight').textContent = `+${item.value}`;
        cards[side].classList.add('cb-landed', 'cb-revealed');
        cards[side].classList.remove('cb-sealed');
        if (item.id === 'blade') player.classList.add('cb-rare');
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
        slot.dataset.round = i;
        slot.disabled = false;
        slot.style.setProperty('--item-color', item.color);
        slot.setAttribute('aria-label', `Inspect ${item.name}, ${item.value} points, round ${i + 1}`);
        slot.innerHTML = `<img src="${art(item.id)}" alt=""><small>${item.value}</small>`;
      });
    });
    countFrom = [...shownTotals];
    countTo = next;
    countAt = performance.now();
    const nextLeader = next[0] === next[1] ? -1 : next[0] > next[1] ? 0 : 1;
    const changed = leader !== -1 && nextLeader !== -1 && leader !== nextLeader;
    if (visible >= 0) {
      momentum.textContent = nextLeader === -1 ? 'All square · tied battle' : `${changed ? 'Lead stolen! ' : ''}${battle.players[nextLeader].name} +${Math.abs(next[0] - next[1])} pts`;
      momentum.classList.toggle('cb-comeback', changed);
      if (changed && !reducedMotion()) sfx.caseLead();
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
    finale.querySelector('p').textContent = `${scores[0]} – ${scores[1]} points · ${battle.practice ? 'Practice complete' : tied ? '50 chips each' : '100 chip pot awarded'}`;
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
      if (countdown !== lastCountdown) roundLabel.textContent = `Opening in ${countdown}`;
      if (countdown !== lastCountdown) { lastCountdown = countdown; if (!reduce) sfx.click(); }
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
    const travel = reduce ? (spin === 1 ? 1 : 0) : 1 - (1 - spin) ** 3.2;
    tracks.forEach((track, side) => {
      const position = (starts[side] + (ends[side] - starts[side]) * travel).toFixed(2);
      if (trackPositions[side] !== position) { trackPositions[side] = position; track.style.transform = `translate3d(${position}px,0,0)`; }
    });
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
  root.addEventListener('click', (event) => {
    const slot = event.target.closest('.cb-past[data-item]');
    if (!slot || inspector) return;
    const item = CASE_ITEMS.find(item => item.id === slot.dataset.item);
    const type = caseById(battle.cases[Number(slot.dataset.round)]);
    const odds = type.weights[CASE_ITEMS.indexOf(item)];
    inspector = document.createElement('dialog');
    inspector.className = 'cb-inspect';
    inspector.setAttribute('aria-label', item.name);
    inspector.style.setProperty('--item-color', item.color);
    inspector.innerHTML = `<button class="cb-inspect-close" type="button" aria-label="Close item" autofocus>×</button><span class="cb-inspect-tier">${item.tier}</span><h3>${item.name}</h3><div class="cb-inspect-art"><img src="${art(item.id)}" alt="${item.name}">${turntables.has(item.id) ? `<span class="cb-inspect-turn" style="background-image:url('${art(`${item.id}-turn`)}')"></span>` : ''}</div>${turntables.has(item.id) ? '<label class="cb-rotate-label">Rotate item<input type="range" min="0" max="23" value="23" aria-label="Rotate item"></label>' : ''}<div class="cb-inspect-stats"><strong>${item.value}<small>POINTS</small></strong><span>${type.name}<small>${odds}% drop chance · round ${Number(slot.dataset.round) + 1}</small></span></div><p>Item value adds to your battle score.</p>`;
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
      inspector?.close();
      inspector?.remove();
      cancelAnimationFrame(raf);
      resize.disconnect();
      document.removeEventListener('visibilitychange', wake);
      root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    },
  };
}
