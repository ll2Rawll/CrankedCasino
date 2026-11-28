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
export const CASES = [
  { id: 'after-hours', name: 'After Hours', color: '#b488e3', hue: 0, weights: [50, 25, 12, 8, 4, 1] },
  { id: 'neon-vault', name: 'Neon Vault', color: '#68d2bf', hue: -90, weights: [25, 40, 20, 10, 4, 1] },
  { id: 'high-roller', name: 'High Roller', color: '#edb66c', hue: 145, weights: [75, 5, 5, 5, 7, 3] },
];
export const caseById = (id) => CASES.find((item) => item.id === id);
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
