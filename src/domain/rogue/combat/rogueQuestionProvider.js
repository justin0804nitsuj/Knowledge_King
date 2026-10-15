/**
 * ROGUE EXPEDITION V0.1 — OFFLINE VOCABULARY QUESTION PROVIDER
 *
 * Adapts Knowledge King's offline vocabulary repository and questionGenerator
 * to provide stable, secure question contracts for Rogue combat:
 * - 100% offline (uses local JSON asset word bank)
 * - Strips `isCorrect` from UI-facing choices
 * - Generates stable question tokens for turn idempotency
 * - Supports deterministic RNG injection and test mock questions
 * - Supports targeted Cursed Word review question generation (Phase R4)
 */

import { getWordsByLevel, getWordById } from '../../vocabulary/vocabularyRepository';
import { generateQuestion } from '../../vocabulary/questionGenerator';
import { createPrng } from '../prng';
import {
  isCursedReviewSlot,
  selectCursedWordForReview,
} from '../curse/cursedWordModel';
import { CURSED_REVIEW_INTERVAL } from '../curse/curseConfig';

/**
 * Helper to safely find a vocabulary entry across levels if level is unknown or stale.
 *
 * @param {string} wordId
 * @param {number} [preferredLevel]
 * @returns {object|null}
 */
function findVocabularyEntry(wordId, preferredLevel) {
  if (preferredLevel) {
    try {
      const found = getWordById(preferredLevel, wordId);
      if (found) return found;
    } catch (_) {}
  }
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    try {
      const found = getWordById(lvl, wordId);
      if (found) return found;
    } catch (_) {}
  }
  return null;
}

/**
 * Generates an offline vocabulary question for Rogue combat.
 *
 * @param {object} params
 * @param {number} [params.level=1] - Vocabulary level (1-6)
 * @param {string} [params.encounterId] - Associated encounter ID
 * @param {number} [params.turn=1] - Encounter turn number
 * @param {number|string} [params.seed] - Seed for deterministic selection
 * @param {function} [params.rng] - Optional injected RNG function [0, 1)
 * @param {object} [params.customQuestion] - Optional mock question for testing
 * @param {Array<object>} [params.cursedWords=[]] - Run's active cursed words
 * @param {boolean} [params.forceCursedReview=false] - Explicit override for testing
 * @returns {object} Rogue combat question contract
 */
export function getRogueQuestion({
  level = 1,
  encounterId = 'enc',
  turn = 1,
  seed,
  rng,
  customQuestion,
  cursedWords = [],
  forceCursedReview = false,
} = {}) {
  // 1. Direct test question injection
  if (customQuestion && typeof customQuestion === 'object') {
    const questionId = customQuestion.questionId || `custom_q_${turn}`;
    const token = customQuestion.token || `qtok_${encounterId}_t${turn}_${questionId}`;
    const wordId =
      customQuestion.wordId ||
      customQuestion.targetId ||
      customQuestion.word ||
      questionId;
    return {
      questionId,
      wordId,
      token,
      word: customQuestion.word || 'mockWord',
      partOfSpeech: customQuestion.partOfSpeech || 'n.',
      level: customQuestion.level || level,
      choices: (customQuestion.choices || []).map((c) => ({
        id: String(c.id),
        text: String(c.text),
      })),
      correctChoiceId: String(customQuestion.correctChoiceId),
      isCursed: Boolean(customQuestion.isCursed),
      curseStacks: customQuestion.curseStacks || (customQuestion.isCursed ? 1 : 0),
    };
  }

  // 2. Resolve deterministic RNG
  let randomFunc = rng;
  if (!randomFunc) {
    const resolvedSeed = seed !== undefined ? seed : `${encounterId}_${turn}`;
    const prng = createPrng(resolvedSeed);
    randomFunc = prng.next;
  }

  // 3. Check for Cursed Word Review Scheduling
  const isReviewTurn =
    forceCursedReview || isCursedReviewSlot(turn, CURSED_REVIEW_INTERVAL);

  if (isReviewTurn && Array.isArray(cursedWords) && cursedWords.length > 0) {
    const cursedCandidate = selectCursedWordForReview(cursedWords);
    if (cursedCandidate && (cursedCandidate.wordId || cursedCandidate.word)) {
      const targetWord = findVocabularyEntry(
        cursedCandidate.wordId,
        cursedCandidate.level
      );

      if (targetWord) {
        try {
          const targetLevel = targetWord.level || cursedCandidate.level || level;
          const targetLevelWords = getWordsByLevel(targetLevel);
          const rawCursedQuestion = generateQuestion(
            targetWord,
            targetLevelWords,
            randomFunc
          );

          if (rawCursedQuestion) {
            return formatQuestionContract(rawCursedQuestion, encounterId, turn, {
              isCursed: true,
              curseStacks: cursedCandidate.stacks || 1,
            });
          }
        } catch (_) {
          // Stale vocabulary / generator fallback: proceed to standard generation
        }
      }
    }
  }

  // 4. Standard Vocabulary Generation: Load offline words for the required difficulty level
  const validLevel = Math.max(1, Math.min(6, level));
  const levelWords = getWordsByLevel(validLevel);
  if (!levelWords || levelWords.length === 0) {
    throw new Error(`[RogueQuestionProvider] No offline words found for level ${validLevel}`);
  }

  // 5. Deterministically select a target word
  const targetIndex = Math.floor(randomFunc() * levelWords.length);
  const targetWord = levelWords[targetIndex];

  // 6. Generate question using existing offline generator
  const rawQuestion = generateQuestion(targetWord, levelWords, randomFunc);
  if (!rawQuestion) {
    // Defensive fallback: pick first word if generation failed
    const fallbackTarget = levelWords[0];
    const fallback = generateQuestion(fallbackTarget, levelWords, randomFunc);
    if (!fallback) {
      throw new Error('[RogueQuestionProvider] Failed to generate offline vocabulary question');
    }
    return formatQuestionContract(fallback, encounterId, turn, {
      isCursed: false,
      curseStacks: 0,
    });
  }

  return formatQuestionContract(rawQuestion, encounterId, turn, {
    isCursed: false,
    curseStacks: 0,
  });
}

/**
 * Formats raw generator output into a secure UI-safe combat contract.
 *
 * @param {object} raw
 * @param {string} encounterId
 * @param {number} turn
 * @param {object} [curseMeta]
 * @param {boolean} [curseMeta.isCursed=false]
 * @param {number} [curseMeta.curseStacks=0]
 * @returns {object}
 */
function formatQuestionContract(
  raw,
  encounterId,
  turn,
  { isCursed = false, curseStacks = 0 } = {}
) {
  const token = `qtok_${encounterId}_t${turn}_${raw.questionId}`;

  // Strip isCorrect so UI logic cannot cheat or inspect correct answers
  const safeChoices = (raw.choices || []).map((choice) => ({
    id: String(choice.id),
    text: String(choice.text),
  }));

  return {
    questionId: raw.questionId,
    wordId: raw.targetId || raw.correctChoiceId || raw.id || raw.word,
    token,
    word: raw.word,
    partOfSpeech: raw.partOfSpeech,
    level: raw.level,
    choices: safeChoices,
    correctChoiceId: String(raw.correctChoiceId),
    isCursed: Boolean(isCursed),
    curseStacks: Number(curseStacks) || 0,
  };
}
