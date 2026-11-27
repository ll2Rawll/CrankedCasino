// Road Rooster artwork: the rooster (in a dealer's visor), top-down cars, and the
// little road props. Everything is vector, drawn once into images at the right size.

const svgImg = (svg) =>
  new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

// ------------------------------------------------------------------ rooster (side view, facing right)
const ROOSTER_DEFS = `
  <defs>
    <radialGradient id="rb" cx="62%" cy="34%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#fbf1dd"/><stop offset="1" stop-color="#d9c3a0"/></radialGradient>
    <radialGradient id="rh" cx="58%" cy="34%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#f8ecd6"/><stop offset="1" stop-color="#dcc6a2"/></radialGradient>
    <linearGradient id="rc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6b7f"/><stop offset="1" stop-color="#c8102e"/></linearGradient>
    <linearGradient id="rt1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a6f63"/><stop offset=".5" stop-color="#1a2f4a"/><stop offset="1" stop-color="#3b1450"/></linearGradient>
    <linearGradient id="rt2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffcf5a"/><stop offset="1" stop-color="#d06414"/></linearGradient>
    <linearGradient id="rk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#f08a1c"/></linearGradient>
    <linearGradient id="rv" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1f8a5f"/><stop offset="1" stop-color="#0f5c46"/></linearGradient>
    <linearGradient id="rvb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="rgba(120,255,205,.75)"/><stop offset="1" stop-color="rgba(40,190,130,.45)"/></linearGradient>
  </defs>`;

function rooster({ blink = false, flap = false, happy = false } = {}) {
  const wing = flap
    ? `<path d="M46 64 C44 40 62 26 80 30 C78 46 68 60 54 70 Z" fill="#f6e6c8" stroke="#cdb48c" stroke-width="1.2"/>
       <path d="M52 60 C56 48 64 40 74 36 M50 66 C56 56 64 50 72 46" stroke="#cdb48c" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
    : `<path d="M44 66 C52 54 74 56 80 68 C76 82 58 88 48 80 Z" fill="#f6e6c8" stroke="#cdb48c" stroke-width="1.2"/>
       <path d="M52 70 C60 66 70 66 76 70 M52 76 C60 73 68 73 73 76" stroke="#cdb48c" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
  const eye = blink
    ? `<path d="M85 37 Q89 40 93 37" stroke="#1a0d05" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
    : happy
      ? `<path d="M85 38 Q89 33 93 38" stroke="#1a0d05" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
      : `<circle cx="89" cy="37" r="5" fill="#fff"/><circle cx="90.4" cy="37.4" r="3.1" fill="#140a05"/><circle cx="91.6" cy="35.9" r="1.1" fill="#fff"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${ROOSTER_DEFS}
    <!-- legs -->
    <g stroke="url(#rk)" stroke-width="5" stroke-linecap="round" fill="none">
      <path d="M56 94 L54 112 M54 112 L45 116 M54 112 L55 119 M54 112 L63 115"/>
      <path d="M70 94 L71 112 M71 112 L62 116 M71 112 L72 119 M71 112 L80 115"/>
    </g>
    <!-- tail -->
    <path d="M40 66 C20 52 12 30 22 10 C28 30 38 44 50 54 Z" fill="url(#rt1)"/>
    <path d="M38 70 C14 64 4 44 8 24 C18 42 30 54 46 60 Z" fill="url(#rt1)" opacity=".92"/>
    <path d="M42 62 C30 44 30 26 40 12 C42 32 46 44 54 52 Z" fill="url(#rt2)"/>
    <path d="M24 14 C26 30 34 42 46 52" stroke="rgba(255,255,255,.25)" stroke-width="1.5" fill="none"/>
    <!-- body -->
    <path d="M30 72 C30 48 52 38 72 42 C90 45 99 60 95 76 C91 93 72 101 54 99 C39 97 30 87 30 72 Z" fill="url(#rb)"/>
    <path d="M36 86 C46 96 66 99 84 90" stroke="rgba(160,120,70,.25)" stroke-width="3" fill="none" stroke-linecap="round"/>
    ${wing}
    <!-- neck + head -->
    <path d="M70 52 C70 40 76 26 88 24 C100 24 104 36 100 48 C96 58 84 62 76 62 Z" fill="url(#rh)"/>
    <!-- comb -->
    <path d="M74 25 C72 14 80 11 82 19 C83 8 92 8 92 17 C96 9 104 13 100 22 C98 26 84 28 74 25 Z" fill="url(#rc)"/>
    <!-- dealer visor -->
    <path d="M73 27 Q88 21 101 26 L102 31 Q88 26 73 32 Z" fill="url(#rv)"/>
    <path d="M94 27 Q110 28 117 35 Q106 37 96 32 Z" fill="url(#rvb)" stroke="#2fd497" stroke-width="1.2"/>
    <path d="M97 29 Q106 30 112 33" stroke="rgba(255,255,255,.55)" stroke-width="1" fill="none"/>
    <!-- face -->
    ${eye}
    <ellipse cx="86" cy="46" rx="4.5" ry="3" fill="#ff8fa3" opacity=".55"/>
    <path d="M99 39 L113 43.5 L99 47 Z" fill="url(#rk)"/>
    <path d="M99 43.5 L113 43.5" stroke="#b85a0e" stroke-width="1"/>
    <path d="M97 48 C100 57 93 60 91 52 Z" fill="url(#rc)"/>
  </svg>`;
}

// Flattened by a car: top-down pancake with a tyre track and dizzy eyes.
function roosterFlat() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${ROOSTER_DEFS}
    <g transform="translate(64 66)">
      <path d="M-30 -10 C-50 -26 -58 -6 -50 4 C-60 10 -50 24 -36 14 Z" fill="url(#rt1)"/>
      <path d="M-28 4 C-48 14 -42 30 -28 22 Z" fill="url(#rt2)"/>
      <ellipse rx="44" ry="22" fill="url(#rb)"/>
      <path d="M-14 -20 L-30 -30 M-4 -22 L-6 -36 M10 -21 L18 -34 M-20 18 L-34 28 M14 20 L22 32" stroke="#f3e2c2" stroke-width="5" stroke-linecap="round"/>
      <ellipse cx="34" cy="-2" rx="17" ry="14" fill="url(#rh)"/>
      <path d="M26 -15 C26 -24 34 -24 34 -17 C36 -25 44 -23 42 -14 Z" fill="url(#rc)"/>
      <path d="M44 -8 L58 -4 L44 2 Z" fill="url(#rk)"/>
      <g stroke="#1a0d05" stroke-width="2.4" stroke-linecap="round"><path d="M28 -7 L34 -1 M34 -7 L28 -1"/><path d="M38 -3 L42 1 M42 -3 L38 1"/></g>
      <rect x="-12" y="-34" width="12" height="68" rx="3" fill="rgba(20,10,16,.55)"/>
      <rect x="6" y="-34" width="12" height="68" rx="3" fill="rgba(20,10,16,.55)"/>
      <g fill="rgba(255,255,255,.18)"><rect x="-12" y="-30" width="12" height="4"/><rect x="-12" y="-18" width="12" height="4"/><rect x="-12" y="-6" width="12" height="4"/><rect x="-12" y="6" width="12" height="4"/><rect x="-12" y="18" width="12" height="4"/>
      <rect x="6" y="-30" width="12" height="4"/><rect x="6" y="-18" width="12" height="4"/><rect x="6" y="-6" width="12" height="4"/><rect x="6" y="6" width="12" height="4"/><rect x="6" y="18" width="12" height="4"/></g>
    </g>
  </svg>`;
}

// ------------------------------------------------------------------ cars (top-down, front = bottom)
export const CAR_TYPES = [
  { id: 'coupe', paint: ['#ff6b85', '#e11d48', '#7a0a22'], len: 1 },
  { id: 'taxi', paint: ['#ffe27a', '#f5b50a', '#8a5a00'], len: 1, taxi: true },
  { id: 'muscle', paint: ['#c48bff', '#7c3aed', '#3a1278'], len: 1.05, stripes: '#140a20' },
  { id: 'sport', paint: ['#8affdc', '#10c98f', '#065c43'], len: 0.95, spoiler: true },
  { id: 'van', paint: ['#9fe3ff', '#2aa8e0', '#0b4a6e'], len: 1.22, van: true },
  { id: 'limo', paint: ['#4a4152', '#1b1620', '#050407'], len: 1.6, trim: '#ffc94d' },
  { id: 'cruiser', paint: ['#ffb38a', '#f06a2a', '#7a2a08'], len: 1.08 },
];

function car(t) {
  const L = Math.round(200 * t.len);
  const [lite, mid, dark] = t.paint;
  const fy = L - 8; // front bumper
  const roofTop = Math.round(L * 0.34);
  const roofBot = Math.round(L * (t.van ? 0.8 : 0.64));
  const extras = [];
  if (t.stripes) extras.push(`<rect x="40" y="10" width="7" height="${L - 20}" fill="${t.stripes}" opacity=".85"/><rect x="53" y="10" width="7" height="${L - 20}" fill="${t.stripes}" opacity=".85"/>`);
  if (t.taxi) extras.push(`<rect x="34" y="${roofTop + 18}" width="32" height="14" rx="3" fill="#1b1206"/><text x="50" y="${roofTop + 28.5}" font-family="Arial Black,Arial" font-weight="900" font-size="10" text-anchor="middle" fill="#ffd34a">TAXI</text>
    <g fill="#1b1206">${Array.from({ length: 8 }, (_, i) => `<rect x="${12 + i * 10}" y="${Math.round(L * 0.5)}" width="5" height="5" opacity="${i % 2 ? 0 : 0.9}"/>`).join('')}</g>`);
  if (t.spoiler) extras.push(`<rect x="12" y="6" width="76" height="9" rx="3" fill="${dark}"/><rect x="18" y="8" width="64" height="3" rx="1.5" fill="rgba(255,255,255,.25)"/>`);
  if (t.trim) extras.push(`<rect x="11" y="${roofTop - 6}" width="78" height="2" fill="${t.trim}" opacity=".8"/><rect x="11" y="${roofBot + 4}" width="78" height="2" fill="${t.trim}" opacity=".8"/>
    <rect x="28" y="${roofTop + 10}" width="44" height="${roofBot - roofTop - 20}" rx="8" fill="rgba(255,201,77,.08)" stroke="${t.trim}" stroke-opacity=".5"/>`);
  const wheel = (x, y) => `<rect x="${x}" y="${y}" width="13" height="30" rx="5" fill="#09080b"/><rect x="${x + 3}" y="${y + 4}" width="7" height="22" rx="3" fill="#24212b"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 ${L}">
    <defs>
      <linearGradient id="p" x1="0" x2="1"><stop offset="0" stop-color="${dark}"/><stop offset=".22" stop-color="${mid}"/><stop offset=".5" stop-color="${lite}"/><stop offset=".78" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#132536"/><stop offset=".6" stop-color="#2b5574"/><stop offset="1" stop-color="#0b1620"/></linearGradient>
      <linearGradient id="r" x1="0" x2="1"><stop offset="0" stop-color="${dark}"/><stop offset=".5" stop-color="${mid}"/><stop offset="1" stop-color="${dark}"/></linearGradient>
    </defs>
    ${wheel(1, Math.round(L * 0.16))}${wheel(86, Math.round(L * 0.16))}${wheel(1, Math.round(L * 0.72))}${wheel(86, Math.round(L * 0.72))}
    <rect x="9" y="6" width="82" height="${L - 12}" rx="${t.van ? 16 : 26}" fill="url(#p)"/>
    <rect x="9" y="6" width="82" height="${L - 12}" rx="${t.van ? 16 : 26}" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="2"/>
    <path d="M24 ${roofTop - 16} Q50 ${roofTop - 26} 76 ${roofTop - 16} L72 ${roofTop + 2} Q50 ${roofTop - 4} 28 ${roofTop + 2} Z" fill="url(#g)"/>
    <rect x="23" y="${roofTop}" width="54" height="${roofBot - roofTop}" rx="12" fill="url(#r)"/>
    <rect x="30" y="${roofTop + 6}" width="40" height="${roofBot - roofTop - 12}" rx="8" fill="rgba(255,255,255,.06)"/>
    <path d="M26 ${roofBot + 2} Q50 ${roofBot - 6} 74 ${roofBot + 2} L80 ${roofBot + 28} Q50 ${roofBot + 18} 20 ${roofBot + 28} Z" fill="url(#g)"/>
    <path d="M30 ${roofBot + 6} Q42 ${roofBot + 2} 50 ${roofBot + 2}" stroke="rgba(255,255,255,.35)" stroke-width="2" fill="none"/>
    <ellipse cx="6" cy="${roofBot - 2}" rx="5" ry="7" fill="${dark}"/><ellipse cx="94" cy="${roofBot - 2}" rx="5" ry="7" fill="${dark}"/>
    ${extras.join('')}
    <path d="M14 ${fy - 14} Q18 ${fy - 2} 34 ${fy + 1} L35 ${fy - 6} Z" fill="#fff8d6"/>
    <path d="M86 ${fy - 14} Q82 ${fy - 2} 66 ${fy + 1} L65 ${fy - 6} Z" fill="#fff8d6"/>
    <rect x="15" y="9" width="20" height="6" rx="3" fill="#ff2e4d"/><rect x="65" y="9" width="20" height="6" rx="3" fill="#ff2e4d"/>
    <rect x="44" y="12" width="12" height="${L - 24}" rx="6" fill="#fff" opacity=".1"/>
  </svg>`;
}

// ------------------------------------------------------------------ props
const EGG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150">
  <defs>
    <radialGradient id="e" cx="38%" cy="30%" r="80%"><stop offset="0" stop-color="#fffbe6"/><stop offset=".25" stop-color="#ffe27a"/><stop offset=".6" stop-color="#e0a116"/><stop offset="1" stop-color="#7a4a05"/></radialGradient>
    <linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d89a3c"/><stop offset="1" stop-color="#6b3d10"/></linearGradient>
  </defs>
  <ellipse cx="60" cy="128" rx="52" ry="16" fill="url(#n)"/>
  <path d="M10 124 C20 136 100 136 110 124 M14 118 C30 130 90 130 106 118" stroke="#f0c070" stroke-width="3" fill="none" opacity=".6"/>
  <path d="M60 8 C88 8 106 52 106 82 C106 110 86 128 60 128 C34 128 14 110 14 82 C14 52 32 8 60 8 Z" fill="url(#e)"/>
  <ellipse cx="44" cy="44" rx="10" ry="18" fill="#fff" opacity=".55" transform="rotate(-20 44 44)"/>
  <text x="60" y="94" font-family="Arial Black,Arial" font-weight="900" font-size="24" text-anchor="middle" fill="#7a4a05" opacity=".55">$</text>
</svg>`;

// Hawk, top-down, wings spread, facing down.
const HAWK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 140">
  <defs><linearGradient id="hw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a3a22"/><stop offset="1" stop-color="#2a170a"/></linearGradient></defs>
  <path d="M100 40 C80 20 40 10 4 28 C30 34 44 46 60 56 C40 56 24 66 14 78 C44 72 70 70 88 74 Z" fill="url(#hw)"/>
  <path d="M100 40 C120 20 160 10 196 28 C170 34 156 46 140 56 C160 56 176 66 186 78 C156 72 130 70 112 74 Z" fill="url(#hw)"/>
  <g stroke="#1a0d05" stroke-width="2" opacity=".5" fill="none"><path d="M20 30 L60 50 M36 26 L70 48 M180 30 L140 50 M164 26 L130 48"/></g>
  <ellipse cx="100" cy="64" rx="20" ry="40" fill="#6b4626"/>
  <path d="M86 98 L100 132 L114 98 Z" fill="#4a2e16"/>
  <circle cx="100" cy="34" r="15" fill="#f3ead8"/>
  <path d="M95 44 L100 54 L105 44 Z" fill="#ffc94d"/>
  <circle cx="94" cy="32" r="3" fill="#1a0d05"/><circle cx="106" cy="32" r="3" fill="#1a0d05"/>
  <path d="M84 84 L80 96 M116 84 L120 96" stroke="#ffc94d" stroke-width="4" stroke-linecap="round"/>
</svg>`;

// Gameplay models are drawn by rooster-landscape. These illustrations are
// reserved for the result panel, golden egg and hawk.
export async function loadArt() {
  const [happy, flat, egg, hawk] = await Promise.all([
    svgImg(rooster({flap: true, happy: true})), svgImg(roosterFlat()), svgImg(EGG), svgImg(HAWK),
  ]);
  return {happy, flat, egg, hawk};
}

/** Standalone SVG of the rooster for the lobby card and the page header. */
export const roosterSVG = rooster;
export const carSVG = (i) => car(CAR_TYPES[i]);
export const EGG_SVG = EGG;
