import { flightCourse, HEIGHT, FLOOR, GATE_WIDTH } from './flight-course.js?v=04dfb825af0a';
import { icon } from '../icons.js';
import { soundOn, setSound, sfx, unlockAudio } from '../sound.js';
import { storage, reducedMotion, clamp } from '../util.js';

const BEST = 'cc:flight:best';
const STEP = 1 / 120;
const landingText = {
  gate: 'You clipped a harbor gate.',
  quay: 'You landed on the quay.',
  ceiling: 'You flew above the course.',
};
const pauseIcon = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

export default {
  title: 'Night Flight',
  mount(view) {
    document.documentElement.classList.add('flight-open');
    view.innerHTML = `<section class="nf" data-phase="ready" aria-label="Night Flight arcade game" tabindex="-1">
      <div class="nf-sky" aria-hidden="true"></div>
      <div class="nf-course" aria-hidden="true"></div>
      <div class="nf-quay" aria-hidden="true"></div>
      <div class="nf-bird" aria-hidden="true"><i></i></div>
      <nav class="nf-nav" aria-label="Game controls">
        <a href="#/" class="nf-pill">${icon('cards')}<span>Lobby</span></a>
        <div class="nf-actions">
          <button type="button" class="nf-icon" data-sound></button>
          <button type="button" class="nf-icon" data-pause aria-label="Pause flight" hidden>${pauseIcon}</button>
        </div>
      </nav>
      <div class="nf-score" aria-label="Score" hidden><span>Gates</span><b>0</b></div>
      <div class="nf-panel"><div class="nf-panel-inner">
        <div class="nf-record">${icon('trophy')}<span>Personal best</span> <b></b></div>
        <h1></h1><p class="nf-note"></p>
        <div class="nf-results" hidden><div><span>Gates</span><strong data-total></strong></div><div><span>Best</span><strong data-best></strong></div></div>
        <button class="nf-play" type="button">${icon('play')}<span></span></button>
        <span class="nf-keys"><kbd>Space</kbd> to flap</span>
      </div></div>
      <span class="sr-only nf-status" role="status" aria-live="polite"></span>
    </section>`;
    const $ = s => view.querySelector(s);
    const field = $('.nf'), world = $('.nf-course'), bird = $('.nf-bird'), quay = $('.nf-quay');
    const play = $('.nf-play'), pause = $('[data-pause]'), sound = $('[data-sound]');
    const panel = $('.nf-panel'), heading = $('h1'), note = $('.nf-note'), score = $('.nf-score');
    const record = $('.nf-record'), results = $('.nf-results'), keys = $('.nf-keys'), status = $('.nf-status');
    let best = Math.max(0, Number(storage.get(BEST, 0)) || 0);
    let phase = 'ready', course = flightCourse(), previousBest = best;
    let raf = 0, last = 0, scale = 1, anchor = 0, right = 0, liftTime = 0;
    let width = 1, height = 1, quiet = reducedMotion();
    const gates = new Map(), pool = [];
    const events = new AbortController();
    function listen(target, name, handler, options = {}) {
      target.addEventListener(name, handler, { ...options, signal: events.signal });
    }

    function updateSound() {
      sound.innerHTML = icon(soundOn() ? 'volume' : 'volumeOff');
      sound.setAttribute('aria-label', soundOn() ? 'Mute sound' : 'Enable sound');
    }
    function show(phaseName) {
      phase = phaseName;
      field.dataset.phase = phase;
      const flying = phase === 'flying';
      panel.hidden = flying;
      score.hidden = !flying;
      pause.hidden = !flying;
      if (flying) return;
      record.hidden = phase !== 'ready';
      record.lastElementChild.textContent = best;
      results.hidden = phase !== 'over';
      keys.hidden = phase === 'paused';
      if (phase === 'ready') {
        heading.innerHTML = 'Night<br><em>Flight</em>';
        note.textContent = 'Tap to flap. Fly through the harbor gates.';
        play.lastElementChild.textContent = 'Start flight';
      } else if (phase === 'paused') {
        heading.textContent = 'Paused';
        note.textContent = 'Your flight is on hold.';
        play.lastElementChild.textContent = 'Resume flight';
      } else {
        heading.textContent = 'Flight over';
        note.textContent = course.state.score > previousBest ? 'A new personal best.' : landingText[course.state.hit];
        $('[data-total]').textContent = course.state.score;
        $('[data-best]').textContent = best;
        play.lastElementChild.textContent = 'Fly again';
      }
      status.textContent = phase === 'over' ? `Flight over. ${course.state.score} gates. Best ${best}.` : heading.textContent;
    }

    function gateNode() {
      const el = pool.pop() || document.createElement('div');
      if (!el.firstChild) {
        el.className = 'nf-gate';
        el.innerHTML = '<i class="nf-pier top"></i><i class="nf-pier bottom"></i>';
      }
      world.append(el);
      return el;
    }
    function release(el) { el.remove(); pool.push(el); }
    function positionGate(el, gate) {
      el.style.width = GATE_WIDTH * scale + 'px';
      el.firstElementChild.style.height = (gate.center - gate.gap / 2) * scale + 'px';
      el.lastElementChild.style.top = (gate.center + gate.gap / 2) * scale + 'px';
    }
    function draw() {
      const s = course.state;
      for (const gate of s.gates) {
        const x = anchor + (gate.x - s.distance - GATE_WIDTH / 2) * scale;
        let el = gates.get(gate.index);
        if (x < -GATE_WIDTH * scale || x > width) {
          if (el) { release(el); gates.delete(gate.index); }
          continue;
        }
        if (!el) { el = gateNode(); gates.set(gate.index, el); positionGate(el, gate); }
        el.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
      }
      const first = s.gates[0]?.index ?? 0;
      for (const [index, el] of gates) {
        if (index < first) { release(el); gates.delete(index); }
      }
      const idle = phase === 'ready';
      const pitch = quiet || idle ? 0 : clamp(-28 + .31 * s.velocity, -28, 84);
      const x = idle ? width * (width > height ? .67 : .76) : anchor;
      const y = idle ? height * .49 : s.y * scale;
      bird.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) rotate(${pitch.toFixed(1)}deg)`;
      if (!idle) {
        const age = liftTime;
        const frame = quiet ? 1 : age < .06 ? 2 : age < .13 ? 0 : 1;
        bird.firstElementChild.style.backgroundPositionX = frame * 50 + '%';
      }
      if (!quiet) quay.style.transform = `translate3d(${-((s.distance * scale * .76) % 320).toFixed(2)}px,0,0)`;
    }
    function resize() {
      width = field.clientWidth;
      height = field.clientHeight;
      if (!width || !height) return;
      scale = height / HEIGHT;
      anchor = Math.min(width * .30, 160 * scale);
      right = (width - anchor) / scale;
      field.style.setProperty('--bird-w', 40 * scale + 'px');
      field.style.setProperty('--floor', FLOOR * scale + 'px');
      for (const [index, el] of gates) {
        const gate = course.state.gates.find(g => g.index === index);
        if (gate) positionGate(el, gate);
      }
      course.extend(right);
      draw();
    }
    function finish() {
      cancelAnimationFrame(raf);
      best = Math.max(course.state.score, best, Number(storage.get(BEST, 0)) || 0);
      storage.set(BEST, best);
      sfx.lose();
      show('over');
      play.focus({ preventScroll: true });
    }
    function advance(now) {
      // A frame timestamp can predate a pointer event handled in the same frame.
      let remaining = Math.min(Math.max(0, now - last) / 1000, .12);
      last = Math.max(last, now);
      const oldScore = course.state.score;
      // Keep collision steps short and consume the fractional step too. A tap
      // just before vsync can then lift the bird on that very frame.
      while (remaining > 0 && !course.state.hit) {
        const dt = Math.min(STEP, remaining);
        course.step(dt, right, anchor / scale);
        remaining -= dt;
        liftTime += dt;
      }
      if (course.state.score !== oldScore) {
        score.lastElementChild.textContent = course.state.score;
        if (!quiet) score.lastElementChild.animate(
          [{ transform: 'scale(1.14)' }, { transform: 'scale(1)' }],
          { duration: 155, easing: 'ease-out' },
        );
        sfx.gem(course.state.score % 7);
      }
      if (course.state.hit) { draw(); finish(); return false; }
      return true;
    }
    function tick(now) {
      if (phase !== 'flying' || !advance(now)) return;
      draw();
      raf = requestAnimationFrame(tick);
    }
    function start() {
      if (phase === 'flying') return;
      if (phase !== 'paused') {
        for (const el of gates.values()) release(el);
        gates.clear();
        course = flightCourse();
        course.extend(right);
        previousBest = best;
        score.lastElementChild.textContent = '0';
        liftTime = 0;
        course.flap();
      }
      quiet = reducedMotion();
      unlockAudio();
      last = performance.now();
      show('flying');
      field.focus({ preventScroll: true });
      draw();
      raf = requestAnimationFrame(tick);
    }
    function flap() {
      if (!advance(performance.now())) return;
      course.flap();
      liftTime = 0;
      draw();
      sfx.tap();
    }
    function hold() {
      if (phase !== 'flying') return;
      cancelAnimationFrame(raf);
      show('paused');
      play.focus({ preventScroll: true });
    }

    listen(play, 'click', start);
    listen(pause, 'click', hold);
    listen(sound, 'click', () => { setSound(!soundOn()); updateSound(); });
    listen(field, 'pointerdown', e => {
      if (e.button !== 0 || !e.isPrimary || e.target.closest('button,a')) return;
      if (phase === 'flying' || phase === 'ready') {
        e.preventDefault();
        if (phase === 'ready') start(); else flap();
      }
    });
    for (const name of ['gesturestart', 'gesturechange', 'contextmenu']) listen(field, name, e => e.preventDefault(), { passive: false });
    listen(document, 'keydown', e => {
      if (e.metaKey || e.altKey || e.ctrlKey || document.querySelector('.modal-root, .drawer.is-open')) return;
      if ((e.code === 'KeyP' || e.code === 'Escape') && phase === 'flying') { e.preventDefault(); hold(); return; }
      if (e.code !== 'Space' && e.code !== 'ArrowUp') return;
      if (e.target.closest?.('button,a') && e.code === 'Space') return;
      e.preventDefault();
      if (!e.repeat) { if (phase === 'flying') flap(); else start(); }
    });
    listen(document, 'visibilitychange', () => { if (document.hidden) hold(); });
    listen(window, 'blur', hold);
    const observer = new ResizeObserver(resize);
    observer.observe(field);
    updateSound();
    show('ready');
    resize();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      events.abort();
      document.documentElement.classList.remove('flight-open');
    };
  },
};
