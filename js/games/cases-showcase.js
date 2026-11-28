import { itemsForCase } from './cases-data.js?v=fb1bf3011ac1';
import { reducedMotion } from '../util.js?v=fb1bf3011ac1';
import { soundOn, setSound } from '../sound.js?v=fb1bf3011ac1';

import { caseOpeningSound, previewItemSound } from './cases-audio.js?v=fb1bf3011ac1';

export const caseEffectMarkup = () => `<div class="case-ritual" aria-hidden="true"><b></b><b></b><b></b>${Array.from({length:12},(_,i)=>`<i style="--n:${i};--dx:${Math.cos(i*Math.PI/6)*90}px;--dy:${Math.sin(i*Math.PI/6)*65}px"></i>`).join('')}</div>`;

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
  root.innerHTML = `<div class="cs-showroom-top"><span>THE CASE COLLECTION</span><button class="cs-audio-toggle" type="button" aria-pressed="${soundOn()}">Sound ${soundOn() ? 'on' : 'off'}</button></div>
    <div class="cs-showroom-title"><span class="cs-case-number"></span><h2></h2><p></p></div>
    <div class="cs-stage"><div class="cs-stage-grid" aria-hidden="true"></div><div class="cs-pedestal" aria-hidden="true"></div><div class="cs-spotlight" aria-hidden="true"></div>
      ${caseEffectMarkup()}<div class="cs-treasures" aria-label="Possible items" aria-hidden="true"></div>
      <div class="cs-case-model"><img class="cs-cover" alt=""><span class="cs-opening-frames" aria-hidden="true"></span></div>
      <span class="cs-preview-caption">6 possible drops</span>
    </div><button class="cs-peek" data-peek type="button"><span aria-hidden="true">✦</span> <b>Peek inside</b> <i class="cs-arrow" aria-hidden="true"></i></button>`;
  const cover = root.querySelector('.cs-cover');
  const frames = root.querySelector('.cs-opening-frames');
  const model = root.querySelector('.cs-case-model');
  const button = root.querySelector('.cs-peek');
  root.querySelector('.cs-audio-toggle').addEventListener('click', event => { setSound(!soundOn()); event.currentTarget.textContent = `Sound ${soundOn()?'on':'off'}`; event.currentTarget.setAttribute('aria-pressed', String(soundOn())); });
  root.addEventListener('click', event => {
    const sample = event.target.closest('[data-sample-item]');
    if (!sample) return;
    setSound(true); root.querySelector('.cs-audio-toggle').textContent = 'Sound on'; root.querySelector('.cs-audio-toggle').setAttribute('aria-pressed','true');
    previewItemSound(sample.dataset.sampleItem);
  });
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
      root.dataset.effect = type.effect || 'classic';
      const treasures = root.querySelector('.cs-treasures');
      treasures.setAttribute('aria-hidden', 'true');
      treasures.innerHTML = itemsForCase(type.id).map((item,i)=>`<button type="button" data-sample-item="${item.id}" aria-label="Play ${item.name} sound" tabindex="-1" style="--i:${i};--tx:${[-113,-70,-24,24,70,113][i]}px;--ty:${[-32,-88,-115,-115,-88,-32][i]}px;--tilt:${[-22,-14,-6,6,14,22][i]}deg"><img src="assets/cases/${item.id}.webp?v=2" alt=""></button>`).join('');
      root.querySelector('.cs-case-number').textContent = `ROUND 0${round + 1} / 03`;
      root.querySelector('h2').textContent = type.name;
      root.querySelector('.cs-showroom-title p').textContent = type.description || (type.id === 'after-hours' ? 'Velvet dark. Violet sparks.' : type.id === 'neon-vault' ? 'Cold chrome. Electric mint.' : 'Black lacquer. Liquid gold.');
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
      caseOpeningSound(type.id);
      const atlas = await warmCasePreview(type.id);
      if (destroyed || current !== revision) return;
      open = true;
      root.classList.remove('cs-loading');
      root.classList.add('cs-is-open');
      root.querySelector('.cs-treasures').setAttribute('aria-hidden','false');
      root.querySelectorAll('[data-sample-item]').forEach(button => button.tabIndex = 0);
      button.disabled = false;
      button.querySelector('b').textContent = 'Close preview';
      button.setAttribute('aria-expanded', 'true');
      root.querySelector('.cs-preview-caption').textContent = 'Preview only · tap an item to hear it';
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
