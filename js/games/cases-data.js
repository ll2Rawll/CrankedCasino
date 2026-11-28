// Item values are battle scores. The winner receives the fixed chip pot.
export const CASE_ENTRY = 50;
export const CASE_ROUND_MS = 6200;
export const CASE_COUNTDOWN_MS = 3000;
export const CASE_ITEMS = [
  { id: 'chips', name: 'House Stack', tier: 'Common', value: 8, color: '#a4adc6' },
  { id: 'headphones', name: 'Violet Audio', tier: 'Rare', value: 24, color: '#ae82f2' },
  { id: 'signet', name: 'Emerald Signet', tier: 'Epic', value: 48, color: '#df7fae' },
  { id: 'diamond', name: 'Ice Cut', tier: 'Epic', value: 65, color: '#df7fae' },
  { id: 'watch', name: 'Midnight Dial', tier: 'Legendary', value: 110, color: '#efbe74' },
  { id: 'blade', name: 'Prism Edge', tier: 'Special', value: 220, color: '#f3c66f' },
];
// Six presentation slots share the existing scores. Saved results remain slot indexes.
const themed = (names, prefix, colors) => names.map((name, i) => ({ ...CASE_ITEMS[i], id: `${prefix}-${i}`, name, color: colors[i] }));
const emberItems = themed(['Ash Sovereign','Ember Fang','Phoenix Feather','Inferno Ruby','Cinder Crown','Dragonheart Blade'], 'ember', ['#bc927d','#ef9670','#ffac58','#ff7961','#ffc76a','#ffbd61']);
const astralItems = themed(['Stardust Vial','Lunar Compass','Orbit Signet','Nova Prism','Eclipse Dial','Astral Scythe'], 'astral', ['#a6a9cf','#a9a0ff','#ae8df3','#ed9cff','#efcd92','#bfaaff']);
const tideItems = themed(['Abyss Doubloon','Siren Conch','Coral Signet','Tidal Pearl','Sovereign Crest','Leviathan Trident'], 'tide', ['#8eb8be','#75d8cd','#eb9fc2','#b1e8f5','#efcc87','#73e7e1']);
export const CASES = [
  { id: 'after-hours', name: 'After Hours', color: '#b488e3', hue: 0, weights: [50, 25, 12, 8, 4, 1] },
  { id: 'neon-vault', name: 'Neon Vault', color: '#68d2bf', hue: -90, weights: [25, 40, 20, 10, 4, 1] },
  { id: 'high-roller', name: 'High Roller', color: '#edb66c', hue: 145, weights: [75, 5, 5, 5, 7, 3] },
  { id: 'dragonheart', name: 'Dragonheart', color: '#ff9b61', hue: 0, weights: [75,5,5,5,7,3], items: emberItems, effect: 'ember', tag: 'Molten relic', description: 'Break the chains. Wake the fire.' },
  { id: 'starfall', name: 'Starfall', color: '#b7a2ff', hue: 0, weights: [25,40,20,10,4,1], items: astralItems, effect: 'astral', tag: 'Celestial engine', description: 'Align the rings. Unseal a star.' },
  { id: 'leviathan', name: 'Leviathan', color: '#6ce0cf', hue: 0, weights: [50,25,12,8,4,1], items: tideItems, effect: 'tide', tag: 'Abyssal treasure', description: 'From the deep. Into the light.' },
];
export const caseById = (id) => CASES.find((item) => item.id === id);
export const itemsForCase = (id) => caseById(id)?.items || CASE_ITEMS;
export const caseItem = (id, index) => itemsForCase(id)[index];
export const ALL_CASE_ITEMS = [...CASE_ITEMS, ...emberItems, ...astralItems, ...tideItems];
export const validCases = (ids) => Array.isArray(ids) && ids.length === 3 && ids.every((id) => !!caseById(id));
export function drawCase(id, random) {
  let roll = random() * 100;
  const weights = caseById(id).weights;
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index];
    if (roll < 0) return index;
  }
  return weights.length - 1;
}
export function caseTotals(pulls) {
  return pulls.reduce((totals, row) => totals.map((total, side) => total + CASE_ITEMS[row[side]].value), [0, 0]);
}
export function casePayout(totals, side) {
  if (totals[side] === totals[1 - side]) return CASE_ENTRY;
  return totals[side] > totals[1 - side] ? CASE_ENTRY * 2 : 0;
}
