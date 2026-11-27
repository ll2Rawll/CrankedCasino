// Lobby: 3D chrome hero with a game rail, marquee, game cards, stats, cloud saves, FAQ.

import { h, esc, fmt, fmtMult, signed, reducedMotion, timeAgo } from '../util.js';
import { icon } from '../icons.js';
import { store, on } from '../store.js';
import { cloud } from '../cloud.js';
import { sfx } from '../sound.js';
import { burstAt, PALETTES } from '../fx.js';
import { toast } from '../ui.js';

const ITEMS = [
  {
    id: 'logo',
    name: 'CrankedCasino',
    caption: 'Chrome edition',
    words: ['Cranked', 'Casino'],
    sub: 'A fake-money casino with Mines, Plinko, Slots and Crash. Sign in with GitHub and your chips follow you everywhere.',
    accent: '#eeeae2',
  },
  {
    id: 'mines',
    name: 'Mines',
    caption: 'Mines · find the gems',
    words: ['Mines'],
    sub: 'Flip tiles on a 5×5 grid, collect gems and dodge the bombs. Cash out whenever your nerve runs out.',
    accent: 'var(--mines)',
  },
  {
    id: 'plinko',
    name: 'Plinko',
    caption: 'Plinko · up to 1,000×',
    words: ['Plinko'],
    sub: 'Drop a ball through the pegs and let gravity pick your multiplier. Up to 16 rows, three risk levels.',
    accent: 'var(--plinko)',
  },
  {
    id: 'slots',
    name: 'Slots',
    caption: 'Slots · wilds & free spins',
    words: ['Slots'],
    sub: 'Five reels, ten lines, chrome wilds and scatter stars that unlock free spins at double pay.',
    accent: 'var(--slots)',
  },
  {
    id: 'crash',
    name: 'Crash',
    caption: 'Crash · ride the rocket',
    words: ['Crash'],
    sub: 'The multiplier climbs until the rocket blows. Cash out before it does, or set an auto cash-out.',
    accent: 'var(--crash)',
  },
];

const CARDS = [
  { id: 'mines', title: 'Mines', desc: 'Flip tiles, dodge bombs, cash out any time.', tags: ['99% RTP', '1–24 mines'] },
  { id: 'plinko', title: 'Plinko', desc: 'Bounce through the pegs to a multiplier.', tags: ['≈99% RTP', 'Up to 1,000×'] },
  { id: 'slots', title: 'Slots', desc: 'Five reels, wilds, scatters and free spins.', tags: ['≈97.5% RTP', 'Free spins ×2'] },
  { id: 'crash', title: 'Crash', desc: 'Cash out before the rocket explodes.', tags: ['99% RTP', 'Auto cash-out'] },
];

const FAQ = [
  ['Is this real money?', 'No. Chips are pretend and have no cash value. You can’t buy them, win anything real, or withdraw. Everyone starts with 1,000 chips, there’s a daily bonus, and you can refill whenever you go broke.'],
  ['How are results decided?', 'Every outcome is drawn from your browser’s cryptographic random number generator. Each game has a small, published house edge: Mines and Crash 1%, Plinko about 1%, Slots about 2.5%.'],
  ['What does GitHub sign-in do?', 'It saves your balance, stats and history to your account so they follow you to any device, and it puts you on the leaderboard. It only reads your public username and avatar. Nothing is posted to your GitHub and no repositories are touched.'],
  ['I lost everything. Now what?', 'Tap your balance at the top. If you’re out of chips you can refill to 1,000, and the daily bonus adds another 1,000 every 24 hours.'],
];

function titleHTML(it) {
  let i = 0;
  return it.words
    .map(
      (w, wi) =>
        `<span class="w ${wi === 1 ? 'it' : ''}">${[...w].map((c) => `<span class="ch" style="--i:${i++}">${esc(c)}</span>`).join('')}</span>`,
    )
    .join('');
}

export default {
  title: '',
  mount(view) {
    const cleanups = [];
    let idx = 0;
    const lenOf = (it) => it.words.join('').length;
    const thumbs = ITEMS.map(
      (it, i) => `<button type="button" class="rail-item arch" role="tab" aria-selected="${i === 0}" aria-label="${esc(it.name)}" data-i="${i}" style="--accent:${it.accent}">
        <img src="assets/img/thumb-${it.id}.webp" alt="" width="90" height="112">
      </button>`,
    ).join('');

    view.innerHTML = `
      <section class="hero wrap">
        <div class="hero-grid">
          <div class="hero-visual">
            <div class="hero-stage">
              <div class="hero-arch arch" style="--accent:${ITEMS[0].accent}">
                <div class="arch-glow"></div>
                <div class="arch-sweep"></div>
                <img class="arch-fallback" src="assets/img/hero-logo.webp" alt="" width="480" height="600">
                <canvas class="hero-canvas" aria-hidden="true"></canvas>
                <div class="arch-sheen"></div>
              </div>
              <div class="hero-rail" role="tablist" aria-label="Featured games">${thumbs}</div>
            </div>
            <div class="hero-caption"><span class="cap-line"></span><span class="cap-text">${esc(ITEMS[0].caption)}</span></div>
          </div>
          <div class="hero-copy">
            <h1 class="hero-title display" style="--len:${lenOf(ITEMS[0])}">${titleHTML(ITEMS[0])}</h1>
            <p class="hero-sub">${esc(ITEMS[0].sub)}</p>
            <div class="hero-ctas"></div>
          </div>
        </div>
      </section>

      <div class="marquee" aria-hidden="true">
        <div class="marquee-track">
          ${Array.from({ length: 2 }, () => ['Mines', 'Plinko', 'Slots', 'Crash'].map((n, i) => `<span class="${i % 2 ? 'o' : ''}">${n}</span><i>✦</i>`).join('')).join('')}
        </div>
      </div>

      <section class="section wrap" data-games>
        <div class="section-head" data-reveal>
          <h2 class="section-title">Four ways to <em>crank it</em></h2>
          <p class="muted head-note">One balance, four games, zero real money.</p>
        </div>
        <div class="game-grid">
          ${CARDS.map(
            (c, i) => `
            <a class="game-card" href="#/${c.id}" style="--accent:var(--${c.id}); --d:${i * 0.07}s" data-reveal>
              <div class="gc-art arch-sq">
                <div class="gc-glow"></div>
                <img src="assets/img/card-${c.id}.webp" alt="" loading="lazy" width="600" height="600">
              </div>
              <div class="gc-info">
                <div class="gc-row"><h3 class="gc-title display">${c.title}</h3><span class="gc-go">${icon('arrowUpRight')}</span></div>
                <p class="gc-desc">${c.desc}</p>
                <div class="gc-tags">${c.tags.map((t) => `<span class="tag"><span class="dot"></span>${t}</span>`).join('')}</div>
              </div>
            </a>`,
          ).join('')}
        </div>
      </section>

      <section class="section wrap section-tight">
        <div class="stats-band panel" data-reveal>
          <div class="stat stat-main"><span class="kicker">Your chips</span><strong class="display tnum" data-s="balance"></strong></div>
          <div class="stat"><span>Biggest win</span><strong class="tnum" data-s="big"></strong></div>
          <div class="stat"><span>Best multiplier</span><strong class="tnum" data-s="multi"></strong></div>
          <div class="stat"><span>Net profit</span><strong class="tnum" data-s="profit"></strong></div>
          <div class="stat"><span>Bets</span><strong class="tnum" data-s="bets"></strong></div>
          <div class="stat-cta" data-s="cta"></div>
        </div>
        <div class="recent panel" data-reveal style="--d:.08s">
          <div class="gh-head"><h2>Recent action</h2><a class="link-arrow" href="#/profile">All stats ${icon('arrowRight')}</a></div>
          <ul class="recent-list" data-recent></ul>
        </div>
      </section>

      <section class="section wrap">
        <div class="cloud-band" data-reveal>
          <div class="cloud-copy">
            <span class="kicker">Saved to GitHub</span>
            <h2 class="section-title">Your chips, <em>everywhere</em></h2>
            <p class="muted">Play as a guest and everything is kept in this browser. Sign in with GitHub and your balance, stats and bet history move to your account, so you can pick up on your phone right where you left off on your laptop.</p>
            <div class="cloud-points">
              <div>${icon('cloud')}<span><strong>Auto-saved</strong> after every bet</span></div>
              <div>${icon('device')}<span><strong>Any device</strong>, same balance</span></div>
              <div>${icon('trophy')}<span><strong>Leaderboard</strong> with your GitHub avatar</span></div>
            </div>
            <div class="cloud-cta" data-cloud-cta></div>
          </div>
          <div class="leader-peek panel" data-peek>
            <div class="gh-head"><h2>Top players</h2><a class="link-arrow" href="#/leaderboard">Leaderboard ${icon('arrowRight')}</a></div>
            <ol class="peek-list" data-peek-list><li class="empty"><span class="spinner" style="margin:auto"></span></li></ol>
          </div>
        </div>
      </section>

      <section class="section wrap">
        <div class="section-head" data-reveal><h2 class="section-title">Good <em>questions</em></h2></div>
        <div class="faq" data-reveal>
          ${FAQ.map(([q, a]) => `<details><summary><span>${q}</span><i>${icon('arrowDown')}</i></summary><p>${a}</p></details>`).join('')}
        </div>
      </section>`;

    // ---------------------------------------------------------- hero
    const arch = view.querySelector('.hero-arch');
    const canvas = view.querySelector('.hero-canvas');
    const fallback = view.querySelector('.arch-fallback');
    const titleEl = view.querySelector('.hero-title');
    const subEl = view.querySelector('.hero-sub');
    const capEl = view.querySelector('.cap-text');
    const ctas = view.querySelector('.hero-ctas');
    const rail = view.querySelector('.hero-rail');
    let hero = null;
    let destroyed = false;

    const renderCtas = (it) => {
      if (it.id === 'logo') {
        ctas.innerHTML = `
          <button type="button" class="btn btn-primary btn-lg" data-cta="start">${icon('play')}<span>Start playing</span></button>
          ${
            cloud.user
              ? `<a class="btn btn-ghost" href="#/leaderboard"><span class="ring">${icon('trophy')}</span><span>Leaderboard</span></a>`
              : `<button type="button" class="btn btn-ghost" data-cta="github"><span class="ring">${icon('github')}</span><span>Save with GitHub</span></button>`
          }`;
      } else {
        ctas.innerHTML = `
          <a class="btn btn-primary btn-lg" href="#/${it.id}">${icon('play')}<span>Play ${esc(it.name)}</span></a>
          <button type="button" class="btn btn-ghost" data-cta="next"><span class="ring">${icon('arrowRight')}</span><span>Next game</span></button>`;
      }
    };
    renderCtas(ITEMS[0]);

    const select = (i, { user = false } = {}) => {
      if (i === idx) return;
      idx = (i + ITEMS.length) % ITEMS.length;
      const it = ITEMS[idx];
      rail.querySelectorAll('.rail-item').forEach((b, j) => b.setAttribute('aria-selected', String(j === idx)));
      arch.style.setProperty('--accent', it.accent);
      document.documentElement.style.setProperty('--accent', it.id === 'logo' ? '' : it.accent);
      if (hero) hero.show(it.id);
      else fallback.src = `assets/img/hero-${it.id}.webp`;
      // Title: letters drop out, new ones rise in.
      titleEl.classList.add('is-out');
      setTimeout(
        () => {
          if (destroyed) return;
          titleEl.classList.remove('is-out');
          titleEl.style.setProperty('--len', lenOf(it));
          titleEl.innerHTML = titleHTML(it);
        },
        reducedMotion() ? 0 : 260,
      );
      subEl.classList.remove('swap');
      void subEl.offsetWidth;
      subEl.classList.add('swap');
      subEl.textContent = it.sub;
      capEl.classList.remove('swap');
      void capEl.offsetWidth;
      capEl.classList.add('swap');
      capEl.textContent = it.caption;
      renderCtas(it);
      if (user) sfx.tap();
    };

    rail.addEventListener('click', (e) => {
      const b = e.target.closest('.rail-item');
      if (!b) return;
      pauseUntil = Date.now() + 20000;
      select(Number(b.dataset.i), { user: true });
    });
    rail.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      pauseUntil = Date.now() + 20000;
      select(idx + (e.key === 'ArrowDown' ? 1 : -1), { user: true });
      rail.querySelectorAll('.rail-item')[idx].focus();
    });
    ctas.addEventListener('click', (e) => {
      const act = e.target.closest('[data-cta]')?.dataset.cta;
      if (act === 'start') view.querySelector('[data-games]').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
      if (act === 'github') cloud.signIn();
      if (act === 'next') {
        pauseUntil = Date.now() + 20000;
        select(idx + 1, { user: true });
      }
    });

    // Swipe on the arch to change game.
    let sx = null;
    arch.addEventListener('pointerdown', (e) => (sx = e.clientX), { passive: true });
    arch.addEventListener(
      'pointerup',
      (e) => {
        if (sx == null) return;
        const dx = e.clientX - sx;
        sx = null;
        if (Math.abs(dx) > 40) {
          pauseUntil = Date.now() + 20000;
          select(idx + (dx < 0 ? 1 : -1), { user: true });
        }
      },
      { passive: true },
    );

    // Auto-advance while the hero is on screen.
    let pauseUntil = 0;
    let heroVisible = true;
    const io = new IntersectionObserver(([en]) => (heroVisible = en.isIntersecting));
    io.observe(arch);
    const auto = setInterval(() => {
      if (!heroVisible || document.hidden || Date.now() < pauseUntil || reducedMotion()) return;
      select(idx + 1);
    }, 6500);
    cleanups.push(() => {
      clearInterval(auto);
      io.disconnect();
    });

    // Load the 3D scene lazily; keep the still image if WebGL isn't available.
    import('../hero3d.js')
      .then(({ createHero }) => {
        if (destroyed) return;
        hero = createHero(canvas, { initial: ITEMS[idx].id });
        if (hero) {
          requestAnimationFrame(() => arch.classList.add('is-live'));
        }
      })
      .catch((e) => console.warn('[hero] 3D unavailable', e));
    cleanups.push(() => hero?.destroy());

    // ---------------------------------------------------------- card tilt
    const grid = view.querySelector('.game-grid');
    const onTilt = (e) => {
      const card = e.target.closest('.game-card');
      if (!card || e.pointerType === 'touch') return;
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.setProperty('--rx', `${(-y * 7).toFixed(2)}deg`);
      card.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`);
      card.style.setProperty('--mx', `${((x + 0.5) * 100).toFixed(1)}%`);
      card.style.setProperty('--my', `${((y + 0.5) * 100).toFixed(1)}%`);
    };
    const onLeave = (e) => {
      const card = e.target.closest?.('.game-card');
      if (card) {
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      }
    };
    grid.addEventListener('pointermove', onTilt);
    grid.addEventListener('pointerout', onLeave);

    // ---------------------------------------------------------- stats + recent
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
        ? `<button class="btn btn-primary" data-act="refill">${icon('refresh')}<span>Refill to 1,000</span></button>`
        : wait
          ? `<button class="btn btn-outline" disabled>${icon('gift')}<span>Bonus ready later</span></button>`
          : `<button class="btn btn-primary" data-act="daily">${icon('gift')}<span>Claim +1,000</span></button>`;
      const rows = store.state.history.slice(0, 6);
      recentEl.innerHTML = rows.length
        ? rows
            .map(
              (r) => `<li style="--c:var(--${esc(r.g)})">
                <span class="rg"><i></i>${esc(r.g)}</span>
                <span class="rm ${r.m >= 1 ? 'win-text' : 'dim'}">${fmtMult(r.m)}</span>
                <span class="rp ${r.p > r.a ? 'win-text' : 'dim'}">${r.p > r.a ? signed(r.p - r.a) : '−' + fmt(r.a - r.p)}</span>
                <span class="rt dim">${timeAgo(r.t)}</span>
              </li>`,
            )
            .join('')
        : `<li class="empty">Your bets will show up here. Go on, pick a game.</li>`;
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
      if (idx === 0) renderCtas(ITEMS[0]);
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
                ${p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pa"></span>`}
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
      grid.removeEventListener('pointermove', onTilt);
      grid.removeEventListener('pointerout', onLeave);
      cleanups.forEach((fn) => fn());
    };
  },
};
