// Lobby: neon marquee sign, searchlights, a hand of holographic game cards,
// the cashier (stack, ad rewards, promo ticket), recent action, accounts, FAQ.

import { esc, fmt, fmtMult, signed, reducedMotion, timeAgo, clamp } from '../util.js?v=88d999005677';
import { icon } from '../icons.js?v=88d999005677';
import { store, on } from '../store.js?v=88d999005677';
import { engine, MODE } from '../engine.js?v=88d999005677';
import { sfx } from '../sound.js?v=88d999005677';
import { promoTicket } from '../ui.js?v=88d999005677';
import { openAccount } from '../account.js?v=88d999005677';
import { adButton, banner } from '../ads.js?v=88d999005677';

const GAMES = [
  { id: 'cases', name: 'Case Battles', rank: 'A', suit: '♦', red: true, line: 'Open cases. Pull rare items. Take the pot.', tags: ['3 rounds', '100 chip pot'] },
  { id: 'blackjack', name: 'Blackjack', rank: 'A', suit: '♠', red: false, line: 'Beat the dealer to 21.', tags: ['Pays 3:2', 'Split · Double'] },
  { id: 'roulette', name: 'Roulette', rank: 'K', suit: '♥', red: true, line: 'Spin the wheel, call the number.', tags: ['35:1 straight', 'European'] },
  { id: 'slots', name: 'Slots', rank: 'Q', suit: '♦', red: true, line: 'Five reels, wilds and free spins.', tags: ['≈97.5% RTP', 'Free spins ×2'] },
  { id: 'crash', name: 'Crash', rank: 'J', suit: '♣', red: false, line: 'Cash out before the rocket blows.', tags: ['Up to 10,000×', 'Auto cash-out'] },
  { id: 'plinko', name: 'Plinko', rank: '10', suit: '♥', red: true, line: 'Drop it. Watch it bounce.', tags: ['Up to 1,000×', '3 risk levels'] },
  { id: 'mines', name: 'Mines', rank: '9', suit: '♠', red: false, line: 'Find gems, dodge the bombs.', tags: ['99% RTP', '1–24 mines'] },
  { id: 'flight', name: 'Night Flight', rank: '7', suit: '♣', red: false, line: 'Flap through the moonlit harbor.', tags: ['Free arcade', 'Bet flights up to 30×'] },
  { id: 'rooster', name: 'Road Rooster', rank: '8', suit: '♦', red: true, line: 'Cross the river. Bet on the row you reach.', tags: ['Free score run', 'Bet runs up to 9×'] },
];

const TICKER = ['New: Case Battles, three cases and a 100-chip pot', 'New: Night Flight, tap to fly through the harbor', 'Road Rooster, reach row 200 for 9×', 'Blackjack pays 3 to 2', 'Roulette straight up 35 to 1', 'Crash up to 10,000×', 'Plinko up to 1,000×', 'Watch an ad, get +250 chips', 'Free spins at double pay', 'Got a promo code? Cash it in', 'One username, any browser'];

const FAQ = [
  ['Is this real money?', 'No. Chips are pretend and have no cash value. You can’t buy them, win anything real, or withdraw. New players start with 1,000 chips.'],
  ['How do I get more chips?', 'Win them, or tap your stack and watch a short ad for +250 chips (a few minutes apart, with a daily limit). There’s also a one-time promo code bonus. There are no daily handouts or refills.'],
  ['Why do I need a username?', 'Your username and password are your account. Your stack, stats and history are saved to it, so you can log in on any phone or computer and pick up where you left off. Clearing your browser history only logs you out; it can’t reset or refill your chips.'],
  ['How do promo codes work?', 'Tap the ticket at the top of the page (or open the cashier) and type the code. Each code works once per account, ever, and the chips land in your stack instantly.'],
  ['How are results decided?', 'The casino server decides every card, spin, bounce and crash with a cryptographic random number generator, then your screen animates the result. Blackjack uses a real six-deck shoe, Roulette is a single-zero European wheel, and every game’s house edge is listed on its table.'],
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
          <p class="hero-sub">Nine games. Fake chips. Real adrenaline.<br>One username, and your stack follows you to any browser.</p>
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
          <p class="muted head-note">Choose a card to play.</p>
        </div>
        <div class="deck" data-deck>
          ${GAMES.map(
            (g, i) => `
            <a class="gcard" href="#/${g.id}" style="--i:${i}; --n:${GAMES.length}; --accent:var(--${g.id})" data-i="${i}" aria-label="Play ${g.name}">
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

      <div class="wrap" data-ad></div>

      <section class="wrap section cashier-section">
        <div class="section-head" data-reveal><h2 class="section-title">The <em>cashier.</em></h2><p class="muted head-note">Watch an ad for chips, or cash in a promo code. All fake, all free.</p></div>
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
            <span class="kicker">Your account</span>
            <h2 class="section-title">Your chips, <em>everywhere.</em></h2>
            <p class="muted">Pick a username and password once. Your stack, stats, promo codes and bet history live on the casino server under your name, so you can log in from any phone or computer and carry on.</p>
            <div class="cloud-points">
              <div>${icon('shield')}<span><strong>No resets.</strong> Clearing history can’t wipe or refill chips</span></div>
              <div>${icon('device')}<span><strong>Any browser</strong>, same stack</span></div>
              <div>${icon('trophy')}<span><strong>Live leaderboard</strong> under your username</span></div>
            </div>
            <div class="cloud-cta" data-cloud-cta></div>
          </div>
          <div class="leader-peek panel" data-peek>
            <div class="gh-head"><h2>High rollers <span class="live-pill" style="margin-left:8px"><i></i>Live</span></h2><a class="link-arrow" href="#/leaderboard">Leaderboard ${icon('arrowRight')}</a></div>
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
    view.querySelector('[data-ad]').append(banner());
    view.querySelector('[data-promo]').append(promoTicket({ title: 'Golden ticket', sub: 'One code, one redemption per account' }));
    const statEls = Object.fromEntries([...view.querySelectorAll('[data-s]')].map((el) => [el.dataset.s, el]));
    const recentEl = view.querySelector('[data-recent]');
    let ad = null;
    const renderCta = () => {
      ad?.destroy();
      ad = null;
      if (store.signedIn) {
        ad = adButton();
        statEls.cta.replaceChildren(ad.el);
      } else statEls.cta.innerHTML = `<button class="btn btn-primary btn-block" data-act="join">${icon('sparkle')}<span>Create account · 1,000 chips</span></button>`;
    };
    const renderStats = () => {
      const st = store.state.stats;
      statEls.balance.textContent = store.signedIn ? fmt(store.balance) : '—';
      statEls.big.textContent = fmt(st.biggestWin);
      statEls.multi.textContent = st.bestMulti ? fmtMult(st.bestMulti) : '—';
      statEls.profit.textContent = signed(st.profit);
      statEls.profit.className = `tnum ${st.profit > 0 ? 'win-text' : st.profit < 0 ? 'loss-text' : ''}`;
      statEls.bets.textContent = st.bets.toLocaleString('en-US');
      const rows = store.state.history.slice(0, 6);
      recentEl.innerHTML = rows.length
        ? rows
            .map(
              (r) => `<li style="--c:var(--${esc(r.g)})">
                <span class="rg"><i></i>${esc(r.g === 'cases' ? 'case battles' : r.g === 'rooster' ? 'road rooster' : r.g === 'flight' ? 'night flight' : r.g)}</span>
                <span class="rm ${r.m >= 1 ? 'win-text' : 'dim'}">${fmtMult(r.m)}</span>
                <span class="rp ${r.p > r.a ? 'win-text' : 'dim'}">${r.p > r.a ? signed(r.p - r.a) : r.p === r.a ? 'push' : '−' + fmt(r.a - r.p)}</span>
                <span class="rt dim">${timeAgo(r.t)}</span>
              </li>`,
            )
            .join('')
        : `<li class="empty">${store.signedIn ? 'Your bets will show up here. Pick a card above.' : 'Make a username and your bets will show up here.'}</li>`;
    };
    renderCta();
    renderStats();
    statEls.cta.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="join"]')) openAccount();
    });
    cleanups.push(on('balance', renderStats), on('reset', renderStats), on('bet', renderStats), on('account', renderCta), () => ad?.destroy());

    // ---------------------------------------------------------- account band + live leaderboard peek
    const cloudCta = view.querySelector('[data-cloud-cta]');
    const peekList = view.querySelector('[data-peek-list]');
    const renderAccount = () => {
      cloudCta.innerHTML = store.signedIn
        ? `<div class="signed-as"><span class="avatar-initial" style="width:36px;height:36px;font-size:16px">${esc(store.username.slice(0, 1))}</span><span>Playing as <strong>${esc(store.username)}</strong>${MODE === 'device' ? ' · saved on this device' : ''}</span></div>`
        : `<div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn btn-primary btn-lg" type="button" data-act="signup">${icon('sparkle')}<span>Create account</span></button><button class="btn btn-outline btn-lg" type="button" data-act="login">${icon('user')}<span>Log in</span></button></div>`;
    };
    renderAccount();
    cloudCta.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'signup' || act === 'login') openAccount({ mode: act });
    });
    cleanups.push(on('account', () => (renderAccount(), loadPeek())));

    const loadPeek = async () => {
      const data = await engine.leaderboard(5);
      if (destroyed) return;
      if (!Array.isArray(data)) {
        if (!peekList.children.length || peekList.querySelector('.spinner')) peekList.innerHTML = `<li class="empty">Leaderboard is taking a break. Try again soon.</li>`;
        return;
      }
      peekList.innerHTML = data.length
        ? data
            .map(
              (p, i) => `<li class="${p.username === store.username ? 'me' : ''}">
                <span class="pr">${i + 1}</span>
                <span class="pa">${esc((p.username || '?')[0].toUpperCase())}</span>
                <span class="pn">${esc(p.username)}</span>
                <span class="pb tnum">${fmt(p.balance)}</span>
              </li>`,
            )
            .join('')
        : `<li class="empty">No one’s on the board yet. Be the first.</li>`;
    };
    loadPeek();
    const peekTimer = setInterval(() => document.visibilityState === 'visible' && loadPeek(), 15000);
    cleanups.push(() => clearInterval(peekTimer));

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
