// Inline SVG icons (24×24, stroke-based unless noted).

const s = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const icons = {
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>',
  sun: s('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>'),
  moon: s('<path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z"/>'),
  menu: s('<path d="M3.5 7h17M3.5 12h17M3.5 17h17"/>'),
  close: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.6v12.8c0 .8.9 1.3 1.6.8l9.6-6.4a1 1 0 0 0 0-1.6L9.6 4.8C8.9 4.3 8 4.8 8 5.6Z"/></svg>',
  arrowRight: s('<path d="M4 12h15M13 6l6 6-6 6"/>'),
  arrowUpRight: s('<path d="M7 17 17 7M8 7h9v9"/>'),
  arrowDown: s('<path d="M12 4v15M6 13l6 6 6-6"/>'),
  volume: s('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  volumeOff: s('<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4Z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  trophy: s('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H4.5a3.5 3.5 0 0 0 4 4M16 6h3.5a3.5 3.5 0 0 1-4 4M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4 20.5a8 8 0 0 1 16 0"/>'),
  gift: s('<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5v8h14v-8M12 8.5v12M12 8.5S10.8 3.5 8 4c-2.6.4-1.7 4.5 4 4.5ZM12 8.5s1.2-5 4-4.5c2.6.4 1.7 4.5-4 4.5Z"/>'),
  refresh: s('<path d="M20 11a8 8 0 0 0-14.7-4.3L3.5 9M4 13a8 8 0 0 0 14.7 4.3L20.5 15"/><path d="M3.5 4v5h5M20.5 20v-5h-5"/>'),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6v.2"/>'),
  logout: s('<path d="M14 4h4.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H14M10 16l-4-4 4-4M6 12h10"/>'),
  cloud: s('<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5 3.8 3.8 0 0 1-.4 7.5H7Z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>'),
  device: s('<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>'),
  sparkle: s('<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z"/><path d="M19 15.5c.3 1.9 1 2.6 2.9 2.9-1.9.3-2.6 1-2.9 2.9-.3-1.9-1-2.6-2.9-2.9 1.9-.3 2.6-1 2.9-2.9Z"/>'),
  bolt: s('<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12l1-8Z"/>'),
  repeat: s('<path d="M17 2.5l3 3-3 3"/><path d="M4 11.5v-1a5 5 0 0 1 5-5h11M7 21.5l-3-3 3-3"/><path d="M20 12.5v1a5 5 0 0 1-5 5H4"/>'),
  dice: s('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  crown: s('<path d="M3.5 8 7.5 12 12 5l4.5 7 4-4-1.8 10.5H5.3L3.5 8Z"/><path d="M5.5 21h13"/>'),
  chart: s('<path d="M3.5 20.5h17"/><path d="M5 16l4.5-5 3.5 3 6.5-8"/><path d="M15 6h4.5v4.5"/>'),
  coins: s('<ellipse cx="9" cy="7" rx="5.5" ry="2.5"/><path d="M3.5 7v4c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V7"/><path d="M9.5 16.4c.9 1.2 3.2 2.1 6 2.1 3 0 5.5-1.1 5.5-2.5v-4c0-1.2-1.8-2.2-4.4-2.5"/>'),
  shield: s('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.2 7.5 9.5 4.3-1.3 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>'),
  stop: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>',
  rocket: s('<path d="M13.5 4.5c3-1.6 5.6-1.6 6-1.2.4.4.4 3-1.2 6l-5.8 5.8-4.6-4.6 5.6-6Z"/><path d="M8 10.5 4.5 10l3-3h4M13.5 16l.5 3.5 3-3v-4M6.5 15.5c-1.5.5-2.5 2.4-2.5 4.5 2.1 0 4-1 4.5-2.5"/><circle cx="15.5" cy="8.5" r="1.4"/>'),
  grid: s('<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>'),
  plinko: s('<circle cx="12" cy="4.5" r="1.6"/><circle cx="8.5" cy="10" r="1.2"/><circle cx="15.5" cy="10" r="1.2"/><circle cx="5" cy="15.5" r="1.2"/><circle cx="12" cy="15.5" r="1.2"/><circle cx="19" cy="15.5" r="1.2"/><path d="M3.5 20.5h17"/>'),
  seven: s('<path d="M6 4.5h12l-6.5 15"/><path d="M9 11h6"/>'),
};

export const icon = (name) => icons[name] || '';
