// Small shared helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Build a DOM element from an HTML string (first element is returned). */
export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Money: 1,234.56 — switches to compact for huge values. */
export function fmt(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  return nf2.format(n);
}
/** Money in full, never abbreviated: 12,345,678,901.23 (for showing a whole balance). */
export const fmtFull = (n) => nf2.format(Number(n) || 0);
export const fmtInt = (n) => nf0.format(Number(n) || 0);

/** Multiplier: 1.23× / 1,000× */
export function fmtMult(m) {
  m = Number(m) || 0;
  if (m >= 1000) return nf0.format(m) + '×';
  if (m >= 100) return m.toFixed(1).replace(/\.0$/, '') + '×';
  return m.toFixed(2) + '×';
}

export function signed(n) {
  return (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let motionQuery;
export function reducedMotion() {
  if (document.documentElement.dataset.motion === 'reduced') return true;
  motionQuery ??= matchMedia('(prefers-reduced-motion: reduce)');
  return motionQuery.matches;
}

export function timeAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}

export function countdown(ms) {
  ms = Math.max(0, ms);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

/** localStorage that never throws (private mode, blocked storage, quota). */
export const storage = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

/** Read a CSS custom property from :root (used by canvases so they follow the theme). */
export function cssVar(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.append(s);
  });
}

/** Run fn on every animation frame until it returns false or stop() is called. */
export function loop(fn) {
  let id = 0;
  let last = performance.now();
  let alive = true;
  const step = (now) => {
    if (!alive) return;
    const dt = Math.min(64, now - last);
    last = now;
    if (fn(dt, now) === false) {
      alive = false;
      return;
    }
    id = requestAnimationFrame(step);
  };
  id = requestAnimationFrame(step);
  return () => {
    alive = false;
    cancelAnimationFrame(id);
  };
}
