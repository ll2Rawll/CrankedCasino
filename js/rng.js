// Cryptographically strong randomness for every game outcome.

const buf = new Uint32Array(2);

/** Uniform float in [0, 1) with 53 bits of entropy. */
export function random() {
  crypto.getRandomValues(buf);
  return (buf[0] * 2 ** 21 + (buf[1] >>> 11)) / 2 ** 53;
}

export const randInt = (n) => Math.floor(random() * n);

export function weightedPick(weights, total = weights.reduce((a, b) => a + b, 0)) {
  let r = random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

/** k distinct integers from [0, n). */
export function sample(n, k) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < k; i++) {
    const j = i + randInt(n - i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}
