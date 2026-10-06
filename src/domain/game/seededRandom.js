/**
 * Creates a deterministic random number generator (Mulberry32).
 * @param {number} seed 
 * @returns {function(): number} A function that returns a float between 0 and 1.
 */
export function createSeededRandom(seed) {
  let state = seed;
  return function() {
    let t = state += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Shuffle an array in-place using a given random function.
 */
export function shuffleArray(array, randomFunc) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(randomFunc() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
