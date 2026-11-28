// Ads: banners between sections, and rewarded "watch an ad for chips" breaks.
//
// With an AdSense publisher ID in js/config.js the site shows real Google ads:
// display units for banners and the H5 Games Ads API for rewarded breaks. Without
// one it shows house ads for its own games, so every placement already works.
// Either way the chips come from the server (cc_ad_reward), which enforces the
// cooldown and the daily cap, so the button can't be farmed.

import { CONFIG } from './config.js?v=cc44f0172e88';
import { h, esc, fmt, loadScript } from './util.js?v=cc44f0172e88';
import { icon } from './icons.js?v=cc44f0172e88';
import { store, on } from './store.js?v=cc44f0172e88';
import { engine, errorText } from './engine.js?v=cc44f0172e88';
import { sfx, setSound, soundOn } from './sound.js?v=cc44f0172e88';
import { toast } from './ui.js?v=cc44f0172e88';
import { needAccount } from './account.js?v=cc44f0172e88';

const A = CONFIG.ads || {};
const CLIENT = String(A.adsenseClient || '').trim();
export const REAL_ADS = /^ca-pub-\d{10,20}$/.test(CLIENT);
const DEMO_SECONDS = 15;

// ---------------------------------------------------------------- loader
let ready = null;
function loadAdsense() {
  if (!REAL_ADS) return Promise.reject(new Error('no adsense'));
  if (ready) return ready;
  ready = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
    s.dataset.adClient = CLIENT;
    if (A.testMode !== false) s.dataset.adbreakTest = 'on';
    s.dataset.adFrequencyHint = '30s';
    s.onload = resolve;
    s.onerror = () => reject(new Error('blocked'));
    document.head.append(s);
    window.adsbygoogle = window.adsbygoogle || [];
    window.adBreak = window.adConfig = (o) => window.adsbygoogle.push(o);
    window.adConfig({ preloadAdBreaks: 'on', sound: 'on' });
  });
  return ready;
}

// ---------------------------------------------------------------- house ads
const HOUSE = [
  { g: 'slots', neon: 'LUCKY CRANK', line: 'Three stars unlock free spins. Every win pays double.', cta: 'Spin the slots' },
  { g: 'crash', neon: 'RIDE THE ROCKET', line: 'Cash out before it blows. Up to 10,000×.', cta: 'Launch Crash' },
  { g: 'plinko', neon: 'DROP IT', line: 'Sixteen rows of pegs. The edges pay up to 1,000×.', cta: 'Play Plinko' },
  { g: 'blackjack', neon: 'PAYS 3 TO 2', line: 'Six decks, dealer stands on all 17s. Beat the house.', cta: 'Take a seat' },
  { g: 'roulette', neon: 'SINGLE ZERO', line: 'European wheel, 97.3% back. Pick your number.', cta: 'Spin roulette' },
  { g: 'mines', neon: 'DIG FOR GEMS', line: 'Dodge the bombs, cash out whenever you like.', cta: 'Play Mines' },
];
let houseIdx = Math.floor(Math.random() * HOUSE.length);
const nextHouse = (skip) => {
  let ad = HOUSE[houseIdx++ % HOUSE.length];
  if (ad.g === skip) ad = HOUSE[houseIdx++ % HOUSE.length];
  return ad;
};

/**
 * A banner slot. Real AdSense unit when configured, otherwise a house ad.
 * @param {string} [skipGame] don't advertise the game the player is already on
 */
export function banner(skipGame) {
  const el = h(`<aside class="ad-slot" aria-label="Advertisement"><span class="ad-tag">Ad</span></aside>`);
  if (REAL_ADS && A.bannerSlot) {
    el.classList.add('is-real');
    el.insertAdjacentHTML('beforeend', `<ins class="adsbygoogle" style="display:block" data-ad-client="${esc(CLIENT)}" data-ad-slot="${esc(A.bannerSlot)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`);
    loadAdsense()
      .then(() => {
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch {
          /* unit already filled */
        }
      })
      .catch(() => el.remove());
    return el;
  }
  const ad = nextHouse(skipGame);
  el.classList.add('is-house');
  el.style.setProperty('--accent', `var(--${ad.g})`);
  el.insertAdjacentHTML(
    'beforeend',
    `<a class="house" href="#/${ad.g}">
      <span class="house-neon neon">${esc(ad.neon)}</span>
      <span class="house-line">${esc(ad.line)}</span>
      <span class="house-cta">${esc(ad.cta)} ${icon('arrowRight')}</span>
    </a>`,
  );
  return el;
}

// ---------------------------------------------------------------- rewarded
function rewardedGoogle() {
  return new Promise((resolve) => {
    let shown = false;
    let viewed = false;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    // No ad offered within 8 s: nothing is available right now.
    const t = setTimeout(() => !shown && done('unavailable'), 8000);
    const wasOn = soundOn();
    try {
      window.adBreak({
        type: 'reward',
        name: 'free-chips',
        beforeAd() {
          if (wasOn) setSound(false);
        },
        afterAd() {
          if (wasOn) setSound(true);
        },
        beforeReward(showAdFn) {
          shown = true;
          clearTimeout(t);
          showAdFn();
        },
        adDismissed() {
          viewed = false;
        },
        adViewed() {
          viewed = true;
        },
        adBreakDone() {
          clearTimeout(t);
          done(viewed ? true : shown ? false : 'unavailable');
        },
      });
    } catch {
      done('unavailable');
    }
  });
}

/** In-house commercial break: a 15-second spot for one of the games. */
function rewardedHouse(reward) {
  return new Promise((resolve) => {
    const ad = nextHouse();
    const root = h(`
      <div class="adbreak" role="dialog" aria-modal="true" aria-label="Sponsored break" style="--accent:var(--${ad.g})">
        <div class="ab-top">
          <span class="ab-tag">Sponsored · ${DEMO_SECONDS}s</span>
          <button class="icon-btn ab-x" type="button" aria-label="Close ad">${icon('close')}</button>
        </div>
        <div class="ab-stage">
          <div class="ab-beams" aria-hidden="true"></div>
          <div class="ab-chips" aria-hidden="true">${'<i class="chip-ico"></i>'.repeat(7)}</div>
          <div class="ab-kicker">Tonight only at CrankedCasino</div>
          <div class="ab-neon neon">${esc(ad.neon)}</div>
          <p class="ab-line">${esc(ad.line)}</p>
          <a class="btn btn-outline ab-cta" href="#/${ad.g}" tabindex="-1">${esc(ad.cta)} ${icon('arrowRight')}</a>
        </div>
        <div class="ab-bottom">
          <div class="ab-ring" aria-hidden="true"><svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17"/><circle class="p" cx="20" cy="20" r="17"/></svg><b class="tnum" data-left>${DEMO_SECONDS}</b></div>
          <button class="btn btn-primary ab-claim" type="button" disabled>${icon('coins')}<span data-claim>Reward in ${DEMO_SECONDS}s</span></button>
        </div>
      </div>`);
    const leftEl = root.querySelector('[data-left]');
    const claim = root.querySelector('.ab-claim');
    const claimLabel = root.querySelector('[data-claim]');
    const ring = root.querySelector('.p');
    const start = performance.now();
    let raf = 0;
    let finished = false;
    const tick = (now) => {
      const el = (now - start) / 1000;
      const left = Math.max(0, DEMO_SECONDS - el);
      ring.style.strokeDashoffset = String(106.8 * (left / DEMO_SECONDS));
      leftEl.textContent = String(Math.ceil(left));
      if (left <= 0) {
        finished = true;
        claim.disabled = false;
        claimLabel.textContent = `Claim +${fmt(reward).replace(/\.00$/, '')} chips`;
        root.classList.add('is-done');
        sfx.win(1);
        claim.focus();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const close = (v) => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      root.classList.add('is-closing');
      setTimeout(() => root.remove(), 260);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(finished);
    };
    document.addEventListener('keydown', onKey);
    root.querySelector('.ab-x').addEventListener('click', () => {
      if (finished) return close(true);
      close(false);
      toast('Ad closed early, so no chips this time.', { iconName: 'info' });
    });
    claim.addEventListener('click', () => finished && close(true));
    root.querySelector('.ab-cta').addEventListener('click', (e) => e.preventDefault());
    document.body.append(root);
    sfx.whoosh();
  });
}

// ---------------------------------------------------------------- watch → chips
let watching = false;
export const adWait = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`);

/** Show a rewarded ad and, if it was watched, collect the chips from the server. */
export async function watchAdForChips(fromEl) {
  if (watching || !needAccount()) return false;
  const st = store.adStatus();
  if (st.left <= 0) {
    toast('That’s every ad reward for today. More tomorrow!', { iconName: 'tv' });
    return false;
  }
  if (st.wait > 0) {
    toast(`Next ad reward in ${adWait(st.wait)}.`, { iconName: 'tv' });
    return false;
  }
  watching = true;
  document.documentElement.classList.add('is-watching');
  try {
    let viewed;
    if (REAL_ADS) {
      try {
        await loadAdsense();
        viewed = await rewardedGoogle();
      } catch {
        toast('Ads are blocked in this browser. Allow ads on this site to earn free chips.', { type: 'loss', iconName: 'tv', timeout: 5000 });
        return false;
      }
    } else viewed = await rewardedHouse(st.reward);
    if (viewed === 'unavailable') {
      toast('No ads available right now. Try again in a minute.', { iconName: 'tv' });
      return false;
    }
    if (!viewed) return false;
    const r = await engine.adReward();
    if (!r?.ok) {
      store.sync(r);
      if (r?.error === 'cooldown') toast(`Next ad reward in ${adWait(r.ads?.wait || 60)}.`, { iconName: 'tv' });
      else if (r?.error === 'daily_cap') toast('That’s every ad reward for today. More tomorrow!', { iconName: 'tv' });
      else toast(errorText(r), { type: 'loss' });
      return false;
    }
    store.sync(r);
    sfx.jackpot();
    const { coinRain, burstAt, PALETTES } = await import('./fx.js?v=cc44f0172e88');
    coinRain(90);
    if (fromEl?.isConnected) burstAt(fromEl, { count: 70, colors: PALETTES.gold, speed: [4, 13] });
    toast(`+${fmt(r.chips).replace(/\.00$/, '')} chips. Thanks for watching!`, { type: 'win', iconName: 'coins', timeout: 3800 });
    return true;
  } finally {
    watching = false;
    document.documentElement.classList.remove('is-watching');
  }
}

/**
 * "Watch an ad · +250" button that keeps its own countdown fresh.
 * Returns { el, destroy }.
 */
export function adButton({ block = true, compact = false } = {}) {
  const el = h(`<button type="button" class="btn btn-ghost ad-btn ${block ? 'btn-block' : ''} ${compact ? 'btn-sm' : ''}">${icon('tv')}<span data-l></span></button>`);
  const label = el.querySelector('[data-l]');
  const render = () => {
    const st = store.adStatus();
    const reward = fmt(st.reward).replace(/\.00$/, '');
    if (!store.signedIn) {
      label.textContent = `Watch an ad · +${reward} chips`;
      el.disabled = false;
    } else if (st.left <= 0) {
      label.textContent = 'Ad rewards are back tomorrow';
      el.disabled = true;
    } else if (st.wait > 0) {
      label.textContent = `Next ad reward in ${adWait(st.wait)}`;
      el.disabled = true;
    } else {
      label.textContent = compact ? `Watch ad · +${reward}` : `Watch an ad · +${reward} chips`;
      el.disabled = false;
    }
  };
  el.addEventListener('click', async () => {
    sfx.click();
    el.disabled = true;
    await watchAdForChips(el);
    render();
  });
  render();
  const timer = setInterval(() => (el.isConnected ? !watching && render() : destroy()), 1000);
  const offs = [on('ads', render), on('account', render)];
  function destroy() {
    clearInterval(timer);
    offs.forEach((f) => f());
  }
  return { el, destroy, render };
}
