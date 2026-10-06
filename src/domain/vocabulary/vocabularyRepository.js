/**
 * Provides access to the offline vocabulary snapshot.
 * Uses static requires so Metro bundler can bundle them into the app.
 */

const LEVEL_MAP = {
  1: () => require('../../../assets/vocabulary/level-1.json'),
  2: () => require('../../../assets/vocabulary/level-2.json'),
  3: () => require('../../../assets/vocabulary/level-3.json'),
  4: () => require('../../../assets/vocabulary/level-4.json'),
  5: () => require('../../../assets/vocabulary/level-5.json'),
  6: () => require('../../../assets/vocabulary/level-6.json'),
};

const cache = {};

export function getAvailableLevels() {
  return Object.keys(LEVEL_MAP).map(Number).sort((a, b) => a - b);
}

export function getWordsByLevel(level) {
  if (!LEVEL_MAP[level]) {
    throw new Error(`Level ${level} not available.`);
  }
  
  if (!cache[level]) {
    cache[level] = LEVEL_MAP[level]();
  }
  
  return cache[level];
}

export function getWordById(level, id) {
  const words = getWordsByLevel(level);
  return words.find(w => w.id === id);
}
