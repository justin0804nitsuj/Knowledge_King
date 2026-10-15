/**
 * ROGUE EXPEDITION V0.1 — DETERMINISTIC PRNG
 *
 * Mulberry32 32-bit PRNG.
 * Guarantees identical pseudo-random stream across platforms given the same seed.
 */

/**
 * Deterministically hashes an arbitrary seed (number or string) into a 32-bit unsigned integer.
 *
 * @param {number|string} seed
 * @returns {number} 32-bit unsigned integer
 */
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) {
    return (seed >>> 0) || 1;
  }
  const str = String(seed ?? 'knowledge-king-rogue-seed');
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

/**
 * Creates a deterministic PRNG instance.
 *
 * @param {number|string} seed
 * @returns {{
 *   next: () => number,
 *   nextInt: (min: number, max: number) => number,
 *   choice: <T>(items: T[]) => T,
 *   shuffle: <T>(items: T[]) => T[]
 * }}
 */
export function createPrng(seed) {
  let s = hashSeed(seed);

  function next() {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function nextInt(min, max) {
    if (min === max) return min;
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    const f = next();
    return Math.floor(f * (upper - lower + 1)) + lower;
  }

  function choice(items) {
    if (!Array.isArray(items) || items.length === 0) return undefined;
    const idx = Math.floor(next() * items.length);
    return items[idx];
  }

  function shuffle(items) {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  return {
    next,
    nextInt,
    choice,
    shuffle,
  };
}
