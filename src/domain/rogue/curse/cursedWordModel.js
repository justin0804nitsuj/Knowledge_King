/**
 * ROGUE EXPEDITION V0.1 — CURSED WORD SYSTEM MODEL & DOMAIN LOGIC
 *
 * Implements pure state transitions, deterministic review selection,
 * stacking, purification, and backlash calculations for Cursed Words.
 *
 * Invariants:
 * - Curses belong ONLY to the active Rogue run.
 * - One canonical entry per vocabulary wordId (no duplicates).
 * - Stacks bounded strictly between MIN_CURSE_STACKS (1) and MAX_CURSE_STACKS (3).
 * - Selection for review is pure and deterministic (no Math.random, no mutation).
 * - First-time mistake creates a curse with NO backlash.
 * - Incorrect answers during a cursed review suffer Curse Backlash (resultingStacks * 5).
 * - Correct answers reduce stacks by 1; reaching 0 purifies and removes the curse.
 */

import {
  MIN_CURSE_STACKS,
  MAX_CURSE_STACKS,
  CURSED_REVIEW_INTERVAL,
  CURSE_BACKLASH_DAMAGE_PER_STACK,
} from './curseConfig';

export const CURSE_TRANSITION_TYPES = Object.freeze({
  CURSE_APPLIED: 'CURSE_APPLIED',
  CURSE_INTENSIFIED: 'CURSE_INTENSIFIED',
  CURSE_WEAKENED: 'CURSE_WEAKENED',
  CURSE_PURIFIED: 'CURSE_PURIFIED',
});

/**
 * Creates a structured, serializable cursed word entry.
 *
 * @param {object} params
 * @param {string} params.wordId - Canonical vocabulary entry ID
 * @param {string} params.word - Word text
 * @param {number} [params.level=1] - Word difficulty level
 * @param {number} [params.stacks=1] - Initial stack count (clamped [1..3])
 * @param {number} [params.mistakeCount=1] - Total mistakes made on this word
 * @param {number} [params.firstCursedAt=1] - Deterministic sequence index when cursed
 * @param {number} [params.lastSeenAt=1] - Deterministic turn/sequence index last seen
 * @returns {object}
 */
export function createCursedWordEntry({
  wordId,
  word,
  level = 1,
  stacks = MIN_CURSE_STACKS,
  mistakeCount = 1,
  firstCursedAt = 1,
  lastSeenAt = 1,
  firstCursedOrder,
  lastSeenOrder,
}) {
  const safeId = String(wordId || word || 'unknown');
  const safeWord = String(word || safeId);
  const safeStacks = Math.max(
    MIN_CURSE_STACKS,
    Math.min(MAX_CURSE_STACKS, Math.floor(stacks || 1))
  );

  const resolvedFirstCursedOrder = typeof firstCursedOrder === 'number'
    ? firstCursedOrder
    : (typeof firstCursedAt === 'number' ? firstCursedAt : 1);
  const resolvedLastSeenOrder = typeof lastSeenOrder === 'number'
    ? lastSeenOrder
    : (typeof lastSeenAt === 'number' ? lastSeenAt : 1);

  return {
    wordId: safeId,
    word: safeWord,
    level: Math.max(1, Math.min(6, Math.floor(level || 1))),
    stacks: safeStacks,
    mistakeCount: Math.max(1, Math.floor(mistakeCount || 1)),
    firstCursedAt: resolvedFirstCursedOrder,
    lastSeenAt: resolvedLastSeenOrder,
    firstCursedOrder: resolvedFirstCursedOrder,
    lastSeenOrder: resolvedLastSeenOrder,
  };
}

/**
 * Checks if a turn number corresponds to a scheduled cursed review slot.
 *
 * @param {number} turn - 1-indexed turn or sequence index
 * @param {number} [interval=CURSED_REVIEW_INTERVAL]
 * @returns {boolean}
 */
export function isCursedReviewSlot(turn, interval = CURSED_REVIEW_INTERVAL) {
  if (typeof turn !== 'number' || turn <= 0) return false;
  const safeInterval = Math.max(1, Math.floor(interval));
  return turn % safeInterval === 0;
}

/**
 * Deterministically selects the highest priority cursed word for review.
 * Does NOT mutate the input array or its entries.
 *
 * Priority order:
 * 1. Highest stacks (descending)
 * 2. Oldest unresolved curse (firstCursedOrder/firstCursedAt ascending)
 * 3. Stable wordId tie-break (alphabetical)
 *
 * @param {Array<object>} cursedWords
 * @returns {object|null} Selected cursed word clone, or null if list is empty
 */
export function selectCursedWordForReview(cursedWords) {
  if (!Array.isArray(cursedWords) || cursedWords.length === 0) {
    return null;
  }

  // Filter out any malformed entries defensively
  const validWords = cursedWords.filter((c) => c && (c.wordId || c.word));
  if (validWords.length === 0) return null;

  const sorted = [...validWords].sort((a, b) => {
    // 1. Highest stacks
    const stackDiff = (b.stacks || 0) - (a.stacks || 0);
    if (stackDiff !== 0) return stackDiff;

    // 2. Oldest unresolved curse
    const aOrder = a.firstCursedOrder ?? a.firstCursedAt ?? 0;
    const bOrder = b.firstCursedOrder ?? b.firstCursedAt ?? 0;
    if (aOrder !== bOrder) return aOrder - bOrder;

    // 3. Stable wordId tie-break
    const aId = String(a.wordId || a.word || '');
    const bId = String(b.wordId || b.word || '');
    return aId.localeCompare(bId);
  });

  // Return a cloned entry so callers cannot mutate the original
  return { ...sorted[0] };
}

/**
 * Calculates Curse Backlash damage for a given stack level.
 *
 * @param {number} stacks
 * @param {number} [damagePerStack=CURSE_BACKLASH_DAMAGE_PER_STACK]
 * @returns {number}
 */
export function calculateCurseBacklash(
  stacks,
  damagePerStack = CURSE_BACKLASH_DAMAGE_PER_STACK
) {
  const safeStacks = Math.max(0, Math.floor(stacks || 0));
  return safeStacks * damagePerStack;
}

/**
 * Pure transition: resolves a wrong answer on a vocabulary word.
 *
 * If word is not cursed:
 * - Adds it with stacks = 1, mistakeCount = 1
 * - No curse backlash damage on initial creation
 *
 * If word is already cursed:
 * - Increments stacks (capped at MAX_CURSE_STACKS = 3)
 * - Increments mistakeCount
 * - If this was a cursed review, applies Curse Backlash: resultingStacks * 5
 *
 * @param {Array<object>} currentCursedWords
 * @param {object} params
 * @param {string} params.wordId
 * @param {string} params.word
 * @param {number} [params.level=1]
 * @param {number} [params.turn=1]
 * @param {boolean} [params.isCursedReview=false]
 * @param {number} [params.firstCursedAt]
 * @returns {{ cursedWords: Array<object>, curseResult: object }}
 */
export function applyCurseWrongAnswer(currentCursedWords = [], {
  wordId,
  word,
  level = 1,
  turn = 1,
  isCursedReview = false,
  firstCursedAt,
  firstCursedOrder,
}) {
  const targetId = String(wordId || word || 'unknown');
  const targetWord = String(word || targetId);
  const existingList = Array.isArray(currentCursedWords) ? currentCursedWords : [];

  const existingIndex = existingList.findIndex(
    (c) => c && String(c.wordId || c.word) === targetId
  );

  const resolvedOrder = typeof firstCursedOrder === 'number'
    ? firstCursedOrder
    : (typeof firstCursedAt === 'number' ? firstCursedAt : turn);

  if (existingIndex === -1) {
    // 1. Initial Curse Creation: First mistake on a non-cursed word
    const newEntry = createCursedWordEntry({
      wordId: targetId,
      word: targetWord,
      level,
      stacks: MIN_CURSE_STACKS,
      mistakeCount: 1,
      firstCursedAt: resolvedOrder,
      firstCursedOrder: resolvedOrder,
      lastSeenAt: turn,
      lastSeenOrder: turn,
    });

    const nextList = [...existingList, newEntry];

    return {
      cursedWords: nextList,
      curseResult: {
        type: CURSE_TRANSITION_TYPES.CURSE_APPLIED,
        wordId: targetId,
        word: targetWord,
        previousStacks: 0,
        stacks: MIN_CURSE_STACKS,
        backlash: 0, // No backlash on first mistake!
      },
    };
  }

  // 2. Repeated Mistake on Existing Curse
  const existing = existingList[existingIndex];
  const newStacks = Math.min(MAX_CURSE_STACKS, (existing.stacks || 1) + 1);
  const newMistakeCount = (existing.mistakeCount || 1) + 1;

  const updatedEntry = {
    ...existing,
    stacks: newStacks,
    mistakeCount: newMistakeCount,
    lastSeenAt: turn,
    lastSeenOrder: turn,
  };

  const nextList = [...existingList];
  nextList[existingIndex] = updatedEntry;

  // Backlash applies when failing a cursed review
  const backlash = isCursedReview
    ? calculateCurseBacklash(newStacks)
    : 0;

  return {
    cursedWords: nextList,
    curseResult: {
      type: CURSE_TRANSITION_TYPES.CURSE_INTENSIFIED,
      wordId: targetId,
      word: targetWord,
      previousStacks: existing.stacks || 1,
      stacks: newStacks,
      backlash,
    },
  };
}

/**
 * Pure transition: resolves a correct answer on a cursed word.
 *
 * If word is cursed:
 * - Reduces stacks by purificationAmount (default 1, Scholar's Lens: 2)
 * - If stacks reaches 0, purifies and removes the word
 *
 * @param {Array<object>} currentCursedWords
 * @param {object} params
 * @param {string} params.wordId
 * @param {string} params.word
 * @param {number} [params.turn=1]
 * @param {number} [params.purificationAmount=1]
 * @returns {{ cursedWords: Array<object>, curseResult: object|null }}
 */
export function applyCurseCorrectAnswer(currentCursedWords = [], {
  wordId,
  word,
  turn = 1,
  purificationAmount = 1,
}) {
  const targetId = String(wordId || word || 'unknown');
  const targetWord = String(word || targetId);
  const existingList = Array.isArray(currentCursedWords) ? currentCursedWords : [];

  const existingIndex = existingList.findIndex(
    (c) => c && String(c.wordId || c.word) === targetId
  );

  if (existingIndex === -1) {
    // Answering a non-cursed word correctly does not affect cursed words
    return {
      cursedWords: existingList,
      curseResult: null,
    };
  }

  const existing = existingList[existingIndex];
  const previousStacks = existing.stacks || 1;
  const safePurification = Math.max(
    1,
    typeof purificationAmount === 'number' ? Math.floor(purificationAmount) : 1
  );
  const newStacks = Math.max(0, previousStacks - safePurification);

  if (newStacks <= 0) {
    // Purified and removed
    const nextList = existingList.filter((_, idx) => idx !== existingIndex);
    return {
      cursedWords: nextList,
      curseResult: {
        type: CURSE_TRANSITION_TYPES.CURSE_PURIFIED,
        wordId: targetId,
        word: targetWord,
        previousStacks,
        stacks: 0,
        backlash: 0,
        purifiedStacks: previousStacks,
      },
    };
  }

  // Weakened
  const updatedEntry = {
    ...existing,
    stacks: newStacks,
    lastSeenAt: turn,
    lastSeenOrder: turn,
  };

  const nextList = [...existingList];
  nextList[existingIndex] = updatedEntry;

  return {
    cursedWords: nextList,
    curseResult: {
      type: CURSE_TRANSITION_TYPES.CURSE_WEAKENED,
      wordId: targetId,
      word: targetWord,
      previousStacks,
      stacks: newStacks,
      backlash: 0,
      purifiedStacks: previousStacks - newStacks,
    },
  };
}
