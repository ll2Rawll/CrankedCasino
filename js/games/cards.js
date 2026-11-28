// Playing cards: SVG faces (ivory stock, real pip layouts, art-deco court cards),
// lacquered backs, and a crypto-shuffled multi-deck shoe.

import { randInt } from '../rng.js?v=2ed58281572d';

export const SUITS = ['spade', 'heart', 'diamond', 'club'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RED = new Set(['heart', 'diamond']);
export const isRed = (suit) => RED.has(suit);
export const SUIT_CHAR = { spade: '♠', heart: '♥', diamond: '♦', club: '♣' };

const SHAPES = {
  spade: '<path d="M50 4C30 25 6 40 6 60c0 14 11 22 23 22 8 0 15-4 18-10-1 10-6 18-13 23h32c-7-5-12-13-13-23 3 6 10 10 18 10 12 0 23-8 23-22 0-20-24-35-44-56Z"/>',
  heart: '<path d="M50 92C20 68 4 50 4 31 4 16 16 5 30 5c9 0 16 5 20 12 4-7 11-12 20-12 14 0 26 11 26 26 0 19-16 37-46 61Z"/>',
  diamond: '<path d="M50 2Q68 30 90 50 68 70 50 98 32 70 10 50 32 30 50 2Z"/>',
  club: '<circle cx="50" cy="27" r="20"/><circle cx="27" cy="57" r="20"/><circle cx="73" cy="57" r="20"/><circle cx="50" cy="52" r="10"/><path d="M47 58c-1 18-5 28-13 37h32c-8-9-12-19-13-37Z"/>',
};

const pip = (suit, x, y, size, flip = false) =>
  `<g transform="translate(${x} ${y}) ${flip ? 'rotate(180)' : ''} scale(${size / 100}) translate(-50 -50)">${SHAPES[suit]}</g>`;

// Pip positions on a 200×280 card. [x, y, upside-down?]
const L = { l: 64, c: 100, r: 136 };
const LAYOUT = {
  2: [[L.c, 68], [L.c, 212, 1]],
  3: [[L.c, 68], [L.c, 140], [L.c, 212, 1]],
  4: [[L.l, 68], [L.r, 68], [L.l, 212, 1], [L.r, 212, 1]],
  5: [[L.l, 68], [L.r, 68], [L.c, 140], [L.l, 212, 1], [L.r, 212, 1]],
  6: [[L.l, 68], [L.r, 68], [L.l, 140], [L.r, 140], [L.l, 212, 1], [L.r, 212, 1]],
  7: [[L.l, 68], [L.r, 68], [L.c, 104], [L.l, 140], [L.r, 140], [L.l, 212, 1], [L.r, 212, 1]],
  8: [[L.l, 68], [L.r, 68], [L.c, 104], [L.l, 140], [L.r, 140], [L.c, 176, 1], [L.l, 212, 1], [L.r, 212, 1]],
  9: [[L.l, 68], [L.r, 68], [L.l, 116], [L.r, 116], [L.c, 140], [L.l, 164, 1], [L.r, 164, 1], [L.l, 212, 1], [L.r, 212, 1]],
  10: [[L.l, 68], [L.r, 68], [L.c, 92], [L.l, 116], [L.r, 116], [L.l, 164, 1], [L.r, 164, 1], [L.c, 188, 1], [L.l, 212, 1], [L.r, 212, 1]],
};

const COURT_ICON = {
  K: '<path d="M-30 12V-10l15 11L0-20l15 21 15-11v22Z"/><rect x="-30" y="14" width="60" height="7" rx="2"/>',
  Q: '<path d="M-26 12-30-8l14 8L0-18l16 18 14-8-4 20Z"/><circle cx="-30" cy="-11" r="4"/><circle cx="0" cy="-22" r="4.5"/><circle cx="30" cy="-11" r="4"/><rect x="-26" y="14" width="52" height="6" rx="2"/>',
  J: '<path d="M0-24 6-10H2v26h-4v-26h-4Z"/><rect x="-14" y="-12" width="28" height="5" rx="2"/><circle cy="20" r="5"/>',
};

const cache = new Map();

/** SVG markup for a card face. */
export function faceSVG(rank, suit) {
  const key = rank + suit;
  if (cache.has(key)) return cache.get(key);
  const red = isRed(suit);
  const ink = red ? '#d21a42' : '#17111c';
  const idx = `
    <text x="24" y="44" text-anchor="middle" class="cr">${rank}</text>
    ${pip(suit, 24, 64, 22)}`;
  let center = '';
  if (rank === 'A') {
    center = `
      <circle cx="100" cy="140" r="58" fill="none" stroke="url(#cc-gold)" stroke-width="2.5"/>
      <circle cx="100" cy="140" r="52" fill="none" stroke="url(#cc-gold)" stroke-width="0.8" stroke-dasharray="2 4"/>
      ${pip(suit, 100, 142, suit === 'spade' ? 82 : 70)}`;
  } else if (LAYOUT[rank]) {
    center = LAYOUT[rank].map(([x, y, f]) => pip(suit, x, y, 34, !!f)).join('');
  } else {
    // Court card: mirrored deco panel with a crown/tiara/blade emblem.
    const panel = red ? 'url(#cc-red)' : 'url(#cc-ink)';
    const half = `
      <g fill="url(#cc-gold)" transform="translate(100 86)">${COURT_ICON[rank]}</g>
      <text x="100" y="138" text-anchor="middle" class="cc-letter">${rank}</text>
      ${pip(suit, 70, 74, 16)}`;
    center = `
      <rect x="44" y="50" width="112" height="180" rx="12" fill="${panel}"/>
      <rect x="50" y="56" width="100" height="168" rx="8" fill="none" stroke="url(#cc-gold)" stroke-width="2"/>
      <path d="M50 140H150" stroke="url(#cc-gold)" stroke-width="1.5"/>
      <g clip-path="url(#cc-top)">${half}</g>
      <g transform="rotate(180 100 140)" clip-path="url(#cc-top)">${half}</g>`;
  }
  const svg = `<svg viewBox="0 0 200 280" class="card-svg" aria-hidden="true" style="color:${ink}">
    <rect x="1.5" y="1.5" width="197" height="277" rx="15" fill="url(#cc-paper)" stroke="#d8c9a6" stroke-width="1.5"/>
    <rect x="1.5" y="1.5" width="197" height="277" rx="15" fill="url(#cc-linen)"/>
    <g fill="currentColor">${idx}<g transform="rotate(180 100 140)">${idx}</g>${center}</g>
  </svg>`;
  cache.set(key, svg);
  return svg;
}

// Shared SVG defs (paper, linen, gold, court panels) injected once.
if (!document.getElementById('card-defs')) {
  const defs = document.createElement('div');
  defs.id = 'card-defs';
  defs.setAttribute('aria-hidden', 'true');
  defs.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  defs.innerHTML = `
    <svg width="0" height="0"><defs>
      <linearGradient id="cc-paper" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fffdf6"/><stop offset=".6" stop-color="#fbf5e6"/><stop offset="1" stop-color="#f1e6cc"/></linearGradient>
      <pattern id="cc-linen" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 .5H4M.5 0V4" stroke="rgba(140,110,60,.07)" stroke-width="1"/></pattern>
      <linearGradient id="cc-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1c1"/><stop offset=".35" stop-color="#e0a83a"/><stop offset=".6" stop-color="#ffe39a"/><stop offset="1" stop-color="#a8700f"/></linearGradient>
      <linearGradient id="cc-red" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8304f"/><stop offset=".5" stop-color="#a80f2e"/><stop offset="1" stop-color="#e8304f"/></linearGradient>
      <linearGradient id="cc-ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a2a48"/><stop offset=".5" stop-color="#140d1a"/><stop offset="1" stop-color="#3a2a48"/></linearGradient>
      <clipPath id="cc-top"><rect x="44" y="50" width="112" height="90"/></clipPath>
    </defs></svg>`;
  document.body.append(defs);
}

/** DOM element for a card. Starts face-down if `down`. */
export function cardEl(card, { down = false } = {}) {
  const el = document.createElement('div');
  el.className = `pcard${down ? ' is-down' : ''}${isRed(card.s) ? ' red' : ''}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', down ? 'Face-down card' : `${card.r} of ${card.s}s`);
  el.innerHTML = `<div class="pc-inner"><div class="pc-face pc-front">${faceSVG(card.r, card.s)}</div><div class="pc-face pc-back card-back-art"><span class="cb-medal"><span class="chip-ico"></span></span></div></div>`;
  return el;
}

/** Paint a face onto a card that was dealt face-down before its value was known. */
export function setFace(el, card) {
  el.classList.toggle('red', isRed(card.s));
  el.querySelector('.pc-front').innerHTML = faceSVG(card.r, card.s);
}

export function reveal(el, card) {
  el.classList.remove('is-down');
  el.setAttribute('aria-label', `${card.r} of ${card.s}s`);
}

// ------------------------------------------------------------------ shoe
export class Shoe {
  constructor(decks = 6) {
    this.decks = decks;
    this.cards = [];
    this.cutAt = 0;
    this.fresh = false;
    this.shuffle();
  }
  shuffle() {
    const cards = [];
    let id = 0;
    for (let d = 0; d < this.decks; d++) for (const s of SUITS) for (const r of RANKS) cards.push({ r, s, id: id++ });
    for (let i = cards.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [cards[i], cards[j]] = [cards[j], cards[i]];
    }
    this.cards = cards;
    // Cut card somewhere between 70% and 80% of the way through.
    this.cutAt = Math.floor(cards.length * (0.2 + randInt(1000) / 10000));
    this.fresh = true;
  }
  get needsShuffle() {
    return this.cards.length <= this.cutAt;
  }
  get decksLeft() {
    return this.cards.length / 52;
  }
  draw() {
    if (!this.cards.length) this.shuffle();
    this.fresh = false;
    return this.cards.pop();
  }
}

export const cardValue = (c) => (c.r === 'A' ? 11 : ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r));

/** Best blackjack total: { total, soft } (soft = an ace is still counting as 11). */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.r === 'A') aces++;
  }
  while (total > 21 && aces) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
