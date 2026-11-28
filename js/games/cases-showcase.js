import { CASE_ITEMS } from './cases-data.js?v=cc44f0172e88';
import { reducedMotion } from '../util.js?v=cc44f0172e88';
import { sfx } from '../sound.js?v=cc44f0172e88';

export const caseCover = (id, open = false) => `assets/cases/case-${id}${open ? '-opened' : ''}.webp?v=1`;
const atlases = new Map();
export function warmCasePreview(id) {
  if (!atlases.has(id)) {
    const image = new Image();
    image.src = `assets/cases/case-${id}-open.webp?v=1`;
    const opened = new Image();
    opened.src = caseCover(id, true);
    atlases.set(id, Promise.all([image.decode(), opened.decode()]).then(() => image).catch(() => null));
  }
  return atlases.get(id);
}

// A short, user-triggered showroom sequence. All lighting is baked into the art.
export function caseShowcase(root) {
  root.innerHTML = `<div class="cs-showroom-top"><span>THE CASE COLLECTION</span><span class="cs-preview-label">Preview · no wager</span></div>
    <div class="cs-showroom-title"><span class="cs-case-number"></span><h2></h2><p></p></div>
    <div class="cs-stage"><div class="cs-stage-grid" aria-hidden="true"></div><div class="cs-pedestal" aria-hidden="true"></div><div class="cs-spotlight" aria-hidden="true"></div>
      <div class="cs-treasures" aria-hidden="true">${CASE_ITEMS.map((item, i) => `<img src="assets/cases/${item.id}.webp?v=2" alt="" style="--i:${i};--tx:${[-113,-70,-24,24,70,113][i]}px;--ty:${[-32,-88,-115,-115,-88,-32][i]}px;--tilt:${[-22,-14,-6,6,14,22][i]}deg">`).join('')}</div>
      <div class="cs-case-model"><img class="cs-cover" alt=""><span class="cs-opening-frames" aria-hidden="true"></span></div>
      <span class="cs-preview-caption">6 possible drops</span>
    </div><button class="cs-peek" data-peek type="button"><span aria-hidden="true">✦</span> <b>Peek inside</b> <i class="cs-arrow" aria-hidden="true"></i></button>`;
  const cover = root.querySelector('.cs-cover');
  const frames = root.querySelector('.cs-opening-frames');
  const model = root.querySelector('.cs-case-model');
  const button = root.querySelector('.cs-peek');
  let type, activeRound = 0, open = false, destroyed = false, frameRequest = 0, revision = 0;
  function pose(index) { frames.style.backgroundPosition = `${index % 5 * 25}% ${Math.floor(index / 5) * 100 / 3}%`; }
  function stop() { cancelAnimationFrame(frameRequest); root.getAnimations({ subtree: true }).forEach(animation => animation.cancel()); }
  return {
    set(next, round, animate = true) {
      revision++;
      stop();
      type = next;
      activeRound = round;
      open = false;
      button.disabled = false;
      root.classList.remove('cs-is-open', 'cs-has-frames', 'cs-loading');
      root.style.setProperty('--case-accent', type.color);
      root.dataset.case = type.id;
      root.querySelector('.cs-case-number').textContent = `ROUND 0${round + 1} / 03`;
      root.querySelector('h2').textContent = type.name;
      root.querySelector('.cs-showroom-title p').textContent = type.id === 'after-hours' ? 'Velvet dark. Violet sparks.' : type.id === 'neon-vault' ? 'Cold chrome. Electric mint.' : 'Black lacquer. Liquid gold.';
      cover.src = caseCover(type.id);
      cover.alt = `${type.name} case`;
      button.querySelector('b').textContent = 'Peek inside';
      button.setAttribute('aria-expanded', 'false');
      root.querySelector('.cs-preview-caption').textContent = '6 possible drops';
      warmCasePreview(type.id);
      if (animate && !reducedMotion()) model.animate([{ transform: 'translateY(14px) rotate(-5deg) scale(.9)', opacity: .3 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.16,.8,.25,1)' });
    },
    async peek() {
      if (destroyed || button.disabled) return;
      if (open) { this.set(type, activeRound); return; }
      const current = revision;
      stop();
      button.disabled = true;
      button.querySelector('b').textContent = 'Opening…';
      root.classList.add('cs-loading');
      sfx.caseUnlock();
      const atlas = await warmCasePreview(type.id);
      if (destroyed || current !== revision) return;
      open = true;
      root.classList.remove('cs-loading');
      root.classList.add('cs-is-open');
      button.disabled = false;
      button.querySelector('b').textContent = 'Close preview';
      button.setAttribute('aria-expanded', 'true');
      root.querySelector('.cs-preview-caption').textContent = 'Possible drops · preview only';
      if (!atlas) return; // Keep the case photograph if an optional atlas is unavailable.
      frames.style.backgroundImage = `url("${atlas.src}")`;
      root.classList.add('cs-has-frames');
      const started = performance.now();
      function tick(now) {
        if (destroyed || current !== revision) return;
        const progress = reducedMotion() ? 1 : Math.min(1, (now - started) / 650);
        pose(Math.round(19 * (1 - (1 - progress) ** 2)));
        if (progress < 1) frameRequest = requestAnimationFrame(tick);
        else { cover.src = caseCover(type.id, true); root.classList.remove('cs-has-frames'); }
      }
      pose(0);
      frameRequest = requestAnimationFrame(tick);
    },
    destroy() { destroyed = true; revision++; stop(); },
  };
}
