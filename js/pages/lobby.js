// Lobby: neon marquee sign, searchlights, a hand of holographic game cards,
// the cashier (stack, daily bonus, promo ticket), recent action, GitHub saves, FAQ.

import { esc, fmt, fmtMult, signed, reducedMotion, timeAgo, clamp } from '../util.js';
import { icon } from '../icons.js';
import { store, on } from '../store.js';
import { cloud } from '../cloud.js';
import { sfx } from '../sound.js';
import { burstAt, PALETTES } from '../fx.js';
import { toast, promoTicket } from '../ui.js';

const GAMES = [
  { id: 'blackjack', name: 'Blackjack', rank: 'A', suit: '♠', red: false, line: 'Beat the dealer to 21.', tags: ['Pays 3:2', 'Split · Double'] },
  { id: 'roulette', name: 'Roulette', rank: 'K', suit: '♥', red: true, line: 'Spin the wheel, call the number.', tags: ['35:1 straight', 'European'] },
  { id: 'slots', name: 'Slots', rank: 'Q', suit: '♦', red: true, line: 'Five reels, wilds and free spins.', tags: ['≈97.5% RTP', 'Free spins ×2'] },
  { id: 'crash', name: 'Crash', rank: 'J', suit: '♣', red: false, line: 'Cash out before the rocket blows.', tags: ['Up to 10,000×', 'Auto cash-out'] },
  { id: 'plinko', name: 'Plinko', rank: '10', suit: '♥', red: true, line: 'Drop it. Watch it bounce.', tags: ['Up to 1,000×', '3 risk levels'] },
  { id: 'mines', name: 'Mines', rank: '9', suit: '♠', red: false, line: 'Find gems, dodge the bombs.', tags: ['99% RTP', '1–24 mines'] },
];

const TICKER = ['Blackjack pays 3 to 2', 'Roulette straight up 35 to 1', 'Crash up to 10,000×', 'Plinko up to 1,000×', 'Daily bonus +1,000', 'Free spins at double pay', 'Got a promo code? Cash it in', 'Saved to GitHub'];

const FAQ = [
  ['Is this real money?', 'No. Chips are pretend and have no cash value. You can’t buy them, win anything real, or withdraw. Everyone starts with 1,000 chips, there’s a daily bonus, and you can refill whenever you go broke.'],
  ['How do promo codes work?', 'Tap the ticket at the top of the page (or open the cashier) and type the code. Each code works once per player, and the chips land in your stack instantly.'],
  ['How are results decided?', 'Every card, spin and bounce comes from your browser’s cryptographic random number generator. Blackjack uses a real six-deck shoe, Roulette is a single-zero European wheel, and every game’s house edge is listed on its table.'],
  ['What does GitHub sign-in do?', 'It saves your stack, stats and history to your account so they follow you to any device, and it puts you on the leaderboard. It only reads your public username and avatar.'],
];

export default {
  title: '',
  mount(view) {
    const cleanups = [];
    let destroyed = false;
    const letters = [...'CRANKED'];

    view.innerHTML = `
      <section class="marquee-hero">
        <div class="beams" aria-hidden="true"><i></i><i></i></div>
        <div class="sunburst" aria-hidden="true"></div>
        <div class="floaters" aria-hidden="true">
          ${['c-5', 'c-100', 'c-25', 'c-500', 'c-10', 'c-1k', 'c-5', 'c-25']
            .map((c, i) => `<span class="float-chip ${c}" style="--i:${i}"></span>`)
            .join('')}
        </div>
        <div class="wrap hero-inner">
          <div class="sign bulbs" data-sign>
            <div class="sign-top"><span>★</span> Welcome to <span>★</span></div>
            <h1 class="sign-neon neon" aria-label="Cranked Casino">${letters.map((c, i) => `<span class="nl" style="--n:${i}" aria-hidden="true">${c}</span>`).join('')}</h1>
            <div class="sign-casino gold-text" aria-hidden="true">CASINO</div>
          </div>
          <p class="hero-sub">Six tables. Fake chips. Real adrenaline.<br>Your stack follows you anywhere with GitHub.</p>
          <div class="hero-ctas">
            <button type="button" class="btn btn-primary btn-lg" data-cta="seat">${icon('cards')}<span>Take a seat</span></button>
            <button type="button" class="btn btn-ghost btn-lg" data-cta="promo">${icon('ticket')}<span>Redeem code</span></button>
          </div>
        </div>
        <div class="led" aria-hidden="true"><div class="led-track">${Array.from({ length: 2 }, () => TICKER.map((t) => `<span>${t}</span><b>✦</b>`).join('')).join('')}</div></div>
      </section>

      <section class="deck-section" data-games>
        <div class="wrap section-head">
          <h2 class="section-title">Pick your <em>table.</em></h2>
          <p class="muted head-note">Six cards, six games. Tap one to deal yourself in.</p>
        </div>
        <div class="deck" data-deck>
          ${GAMES.map(
            (g, i) => `
            <a class="gcard" href="#/${g.id}" style="--i:${i}; --accent:var(--${g.id})" data-i="${i}" aria-label="Play ${g.name}">
              <span class="gc-inner">
                <span class="gc-face gc-back" aria-hidden="true"><span class="cb-medal"><span class="chip-ico"></span></span></span>
                <span class="gc-face gc-front">
                  <span class="gc-idx tl ${g.red ? 'red' : ''}"><b>${g.rank}</b><i>${g.suit}</i></span>
                  <span class="gc-idx br ${g.red ? 'red' : ''}"><b>${g.rank}</b><i>${g.suit}</i></span>
                  <span class="gc-art"><span class="gc-halo"></span><img src="assets/img/card-${g.id}.webp" alt="" loading="lazy" width="600" height="600"></span>
                  <span class="gc-text">
                    <span class="gc-name">${g.name}</span>
                    <span class="gc-line">${g.line}</span>
                    <span class="gc-tags">${g.tags.map((t) => `<span>${t}</span>`).join('')}</span>
                  </span>
                  <span class="gc-holo"></span>
                  <span class="gc-glare"></span>
                </span>
              </span>
            </a>`,
          ).join('')}
        </div>
        <div class="deck-dots" data-dots>${GAMES.map((g, i) => `<button type="button" data-dot="${i}" aria-label="${g.name}"></button>`).join('')}</div>
      </section>

      <section class="wrap section cashier-section">
        <div class="section-head" data-reveal><h2 class="section-title">The <em>cashier.</em></h2><p class="muted head-note">Daily chips, refills and promo codes. All free, all fake.</p></div>
        <div class="cashier-grid">
          <div class="stack-card panel" data-reveal>
            <span class="kicker">Your stack</span>
            <div class="stack-num neon tnum" data-s="balance"></div>
            <div class="stack-stats">
              <div><span>Biggest win</span><strong data-s="big"></strong></div>
              <div><span>Best multiplier</span><strong data-s="multi"></strong></div>
              <div><span>Net profit</span><strong data-s="profit"></strong></div>
              <div><span>Bets</span><strong data-s="bets"></strong></div>
            </div>
            <div class="stack-cta" data-s="cta"></div>
          </div>
          <div class="ticket-zone" data-reveal style="--d:.08s">
            <div class="tz-head"><span class="kicker">Promo</span><h3>Got a <span class="neon" style="--neon:#ffc94d">code?</span></h3></div>
            <div class="ticket-glow" data-promo></div>
          </div>
        </div>
        <div class="recent panel" data-reveal style="--d:.12s">
          <div class="gh-head"><h2>Recent action</h2><a class="link-arrow" href="#/profile">All stats ${icon('arrowRight')}</a></div>
          <ul class="recent-list" data-recent></ul>
        </div>
      </section>

      <section class="wrap section">
        <div class="cloud-band" data-reveal>
          <div class="cloud-copy">
            <span class="kicker">Saved to GitHub</span>
            <h2 class="section-title">Your chips, <em>everywhere.</em></h2>
            <p class="muted">Play as a guest and your stack lives in this browser. Sign in with GitHub and your balance, stats, promos and bet history move to your account, so you can pick up on your phone right where you left off.</p>
            <div class="cloud-points">
              <div>${icon('cloud')}<span><strong>Auto-saved</strong> after every bet</span></div>
              <div>${icon('device')}<span><strong>Any device</strong>, same stack</span></div>
              <div>${icon('trophy')}<span><strong>Leaderboard</strong> with your GitHub avatar</span></div>
            </div>
            <div class="cloud-cta" data-cloud-cta></div>
          </div>
          <div class="leader-peek panel" data-peek>
            <div class="gh-head"><h2>High rollers</h2><a class="link-arrow" href="#/leaderboard">Leaderboard ${icon('arrowRight')}</a></div>
            <ol class="peek-list" data-peek-list><li class="empty"><span class="spinner" style="margin:auto"></span></li></ol>
          </div>
        </div>
      </section>

      <section class="wrap section">
        <div class="section-head" data-reveal><h2 class="section-title">House <em>rules.</em></h2></div>
        <div class="faq" data-reveal>
          ${FAQ.map(([q, a]) => `<details><summary><span>${q}</span><i>${icon('arrowDown')}</i></summary><p>${a}</p></details>`).join('')}
        </div>
      </section>`;

    // ---------------------------------------------------------- neon sign
    const sign = view.querySelector('[data-sign]');
    const neonEl = sign.querySelector('.sign-neon');
    requestAnimationFrame(() => sign.classList.add('is-lit'));
    const buzz = setTimeout(() => !destroyed && sfx.tease(), 350);
    cleanups.push(() => clearTimeout(buzz));
    const onSignMove = (e) => {
      if (e.pointerType === 'touch') return;
      const r = sign.getBoundingClientRect();
      const x = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2), -1, 1);
      const y = clamp((e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2), -1, 1);
      sign.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
      sign.style.setProperty('--rx', `${(-y * 8).toFixed(2)}deg`);
      neonEl.style.fontVariationSettings = `'XROT' ${(-y * 25).toFixed(1)}, 'YROT' ${(x * 30).toFixed(1)}`;
    };
    window.addEventListener('pointermove', onSignMove, { passive: true });
    cleanups.push(() => window.removeEventListener('pointermove', onSignMove));

    view.querySelector('.hero-ctas').addEventListener('click', (e) => {
      const act = e.target.closest('[data-cta]')?.dataset.cta;
      if (act === 'seat') view.querySelector('[data-games]').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
      if (act === 'promo') {
        const t = view.querySelector('[data-promo] input');
        t?.closest('.ticket-zone')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
        setTimeout(() => t?.focus({ preventScroll: true }), 500);
      }
    });

    // ---------------------------------------------------------- the deck
    const deck = view.querySelector('[data-deck]');
    const cards = [...deck.querySelectorAll('.gcard')];
    const dots = [...view.querySelectorAll('[data-dot]')];
    const mq = matchMedia('(min-width: 900px)');
    let mode = '';

    // Dealt face-down, then flipped one by one.
    const deal = () => {
      cards.forEach((c, i) => {
        c.classList.remove('is-dealt', 'is-up');
        setTimeout(() => !destroyed && c.classList.add('is-dealt'), 80 + i * 90);
        setTimeout(
          () => {
            if (destroyed) return;
            c.classList.add('is-up');
            if (i % 2 === 0) sfx.flip();
          },
          650 + i * 120,
        );
      });
    };
    const io = new IntersectionObserver(
      ([en]) => {
        if (en.isIntersecting) {
          deal();
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(deck);
    cleanups.push(() => io.disconnect());

    // Holographic foil + tilt that follows the pointer (desktop).
    const onCardMove = (e) => {
      const c = e.target.closest('.gcard');
      if (!c || e.pointerType === 'touch') return;
      const r = c.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      c.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
      c.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      c.style.setProperty('--tx', `${((y - 0.5) * -14).toFixed(2)}deg`);
      c.style.setProperty('--ty', `${((x - 0.5) * 16).toFixed(2)}deg`);
      c.style.setProperty('--hx', `${(x * 100).toFixed(1)}%`);
      c.style.setProperty('--hy', `${(y * 100).toFixed(1)}%`);
    };
    const onCardLeave = (e) => {
      const c = e.target.closest?.('.gcard');
      if (!c) return;
      ['--tx', '--ty'].forEach((p) => c.style.removeProperty(p));
    };
    const onCardEnter = (e) => {
      if (e.target.closest?.('.gcard') && e.pointerType !== 'touch') sfx.tick(2);
    };
    deck.addEventListener('pointermove', onCardMove);
    deck.addEventListener('pointerout', onCardLeave);
    deck.addEventListener('pointerover', onCardEnter);

    // Coverflow on phones: cards turn and shrink as they leave the centre.
    let raf = 0;
    const coverflow = () => {
      raf = 0;
      if (mode !== 'flow') return;
      const mid = deck.scrollLeft + deck.clientWidth / 2;
      let best = 0;
      let bestD = Infinity;
      cards.forEach((c, i) => {
        const center = c.offsetLeft + c.offsetWidth / 2;
        const d = (center - mid) / c.offsetWidth;
        const ad = Math.min(1.6, Math.abs(d));
        c.style.setProperty('--flow-r', `${clamp(-d * 28, -40, 40).toFixed(2)}deg`);
        c.style.setProperty('--flow-s', (1 - ad * 0.14).toFixed(3));
        c.style.setProperty('--flow-z', `${(-ad * 60).toFixed(1)}px`);
        c.style.setProperty('--hx', `${(50 + d * 60).toFixed(1)}%`);
        c.style.setProperty('--hy', `${(40 + d * 25).toFixed(1)}%`);
        c.style.zIndex = String(100 - Math.round(ad * 10));
        if (Math.abs(d) < bestD) {
          bestD = Math.abs(d);
          best = i;
        }
      });
      dots.forEach((d, i) => d.setAttribute('aria-current', String(i === best)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(coverflow);
    };
    deck.addEventListener('scroll', onScroll, { passive: true });
    view.querySelector('[data-dots]').addEventListener('click', (e) => {
      const b = e.target.closest('[data-dot]');
      if (!b) return;
      const c = cards[Number(b.dataset.dot)];
      deck.scrollTo({ left: c.offsetLeft - (deck.clientWidth - c.offsetWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
    });
    const setMode = () => {
      mode = mq.matches ? 'fan' : 'flow';
      deck.dataset.mode = mode;
      cards.forEach((c) => {
        ['--flow-r', '--flow-s', '--flow-z'].forEach((p) => c.style.removeProperty(p));
        c.style.zIndex = '';
      });
      if (mode === 'flow') {
        // start on the second card so both neighbours peek in
        requestAnimationFrame(() => {
          const c = cards[1];
          deck.scrollLeft = c.offsetLeft - (deck.clientWidth - c.offsetWidth) / 2;
          coverflow();
        });
      }
    };
    setMode();
    mq.addEventListener('change', setMode);
    const onResize = () => onScroll();
    window.addEventListener('resize', onResize);
    cleanups.push(() => {
      mq.removeEventListener('change', setMode);
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(raf);
    });

    // ---------------------------------------------------------- cashier
    view.querySelector('[data-promo]').append(promoTicket({ title: 'Golden ticket', sub: 'One code, one redemption per player' }));
    const statEls = Object.fromEntries([...view.querySelectorAll('[data-s]')].map((el) => [el.dataset.s, el]));
    const recentEl = view.querySelector('[data-recent]');
    const renderStats = () => {
      const st = store.state.stats;
      statEls.balance.textContent = fmt(store.balance);
      statEls.big.textContent = fmt(st.biggestWin);
      statEls.multi.textContent = st.bestMulti ? fmtMult(st.bestMulti) : '—';
      statEls.profit.textContent = signed(st.profit);
      statEls.profit.className = `tnum ${st.profit > 0 ? 'win-text' : st.profit < 0 ? 'loss-text' : ''}`;
      statEls.bets.textContent = st.bets.toLocaleString('en-US');
      const wait = store.dailyReadyIn();
      statEls.cta.innerHTML = store.canRefill()
        ? `<button class="btn btn-primary btn-block" data-act="refill">${icon('refresh')}<span>Refill to 1,000</span></button>`
        : wait
          ? `<button class="btn btn-outline btn-block" disabled>${icon('gift')}<span>Daily bonus is recharging</span></button>`
          : `<button class="btn btn-primary btn-block" data-act="daily">${icon('gift')}<span>Claim daily +1,000</span></button>`;
      const rows = store.state.history.slice(0, 6);
      recentEl.innerHTML = rows.length
        ? rows
            .map(
              (r) => `<li style="--c:var(--${esc(r.g)})">
                <span class="rg"><i></i>${esc(r.g)}</span>
                <span class="rm ${r.m >= 1 ? 'win-text' : 'dim'}">${fmtMult(r.m)}</span>
                <span class="rp ${r.p > r.a ? 'win-text' : 'dim'}">${r.p > r.a ? signed(r.p - r.a) : r.p === r.a ? 'push' : '−' + fmt(r.a - r.p)}</span>
                <span class="rt dim">${timeAgo(r.t)}</span>
              </li>`,
            )
            .join('')
        : `<li class="empty">Your bets will show up here. Pick a card above.</li>`;
    };
    renderStats();
    statEls.cta.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'daily' && store.claimDaily()) {
        sfx.win(2);
        burstAt(e.target.closest('button'), { count: 70, colors: PALETTES.gold });
        toast('+1,000 chips. See you tomorrow!', { type: 'win', iconName: 'gift' });
      }
      if (act === 'refill' && store.refill()) {
        sfx.cashout();
        toast('Topped back up to 1,000 chips.', { type: 'win', iconName: 'coins' });
      }
      renderStats();
    });
    cleanups.push(on('balance', renderStats), on('reset', renderStats), on('bet', renderStats));

    // ---------------------------------------------------------- cloud band + leaderboard peek
    const cloudCta = view.querySelector('[data-cloud-cta]');
    const peekList = view.querySelector('[data-peek-list]');
    const renderCloud = () => {
      const u = cloud.user;
      cloudCta.innerHTML = u
        ? `<div class="signed-as">${u.avatar ? `<img src="${esc(u.avatar)}" alt="" referrerpolicy="no-referrer">` : icon('user')}<span>Signed in as <strong>@${esc(u.login)}</strong></span></div>`
        : `<button class="btn btn-primary btn-lg" type="button" data-act="signin">${icon('github')}<span>Sign in with GitHub</span></button>`;
    };
    renderCloud();
    cloudCta.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="signin"]')) cloud.signIn();
    });
    cleanups.push(cloud.onChange(renderCloud));

    const loadPeek = async () => {
      if (!cloud.enabled) {
        peekList.innerHTML = `<li class="empty">The leaderboard switches on once GitHub sign-in is set up for this site.</li>`;
        return;
      }
      const { data, error } = await cloud.leaderboard(5);
      if (destroyed) return;
      if (error || !data) {
        peekList.innerHTML = `<li class="empty">Leaderboard is taking a break. Try again soon.</li>`;
        return;
      }
      peekList.innerHTML = data.length
        ? data
            .map(
              (p, i) => `<li>
                <span class="pr">${i + 1}</span>
                ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pa">${esc((p.username || '?')[0].toUpperCase())}</span>`}
                <span class="pn">@${esc(p.username)}</span>
                <span class="pb tnum">${fmt(p.balance)}</span>
              </li>`,
            )
            .join('')
        : `<li class="empty">No one’s on the board yet. Be the first.</li>`;
    };
    loadPeek();

    return () => {
      destroyed = true;
      deck.removeEventListener('pointermove', onCardMove);
      deck.removeEventListener('pointerout', onCardLeave);
      deck.removeEventListener('pointerover', onCardEnter);
      deck.removeEventListener('scroll', onScroll);
      cleanups.forEach((fn) => fn());
    };
  },
};
