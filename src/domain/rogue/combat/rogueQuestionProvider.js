/**
 * ROGUE EXPEDITION V0.1 — OFFLINE VOCABULARY QUESTION PROVIDER
 *
 * Adapts Knowledge King's offline vocabulary repository and questionGenerator
 * to provide stable, secure question contracts for Rogue combat:
 * - 100% offline (uses local JSON asset word bank)
 * - Strips `isCorrect` from UI-facing choices
 * - Generates stable question tokens for turn idempotency
 * - Supports deterministic RNG injection and test mock questions
 */

import { getWordsByLevel } from '../../vocabulary/vocabularyRepository';
import { generateQuestion } from '../../vocabulary/questionGenerator';
import { createPrng } from '../prng';

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
 * @returns {object} Rogue combat question contract
 */
export function getRogueQuestion({
  level = 1,
  encounterId = 'enc',
  turn = 1,
  seed,
  rng,
  customQuestion,
} = {}) {
  // 1. Direct test question injection
  if (customQuestion && typeof customQuestion === 'object') {
    const questionId = customQuestion.questionId || `custom_q_${turn}`;
    const token = customQuestion.token || `qtok_${encounterId}_t${turn}_${questionId}`;
    return {
      questionId,
      token,
      word: customQuestion.word || 'mockWord',
      partOfSpeech: customQuestion.partOfSpeech || 'n.',
      level: customQuestion.level || level,
      choices: (customQuestion.choices || []).map((c) => ({
        id: String(c.id),
        text: String(c.text),
      })),
      correctChoiceId: String(customQuestion.correctChoiceId),
    };
  }

  // 2. Resolve deterministic RNG
  let randomFunc = rng;
  if (!randomFunc) {
    const resolvedSeed = seed !== undefined ? seed : `${encounterId}_${turn}_${Date.now()}`;
    const prng = createPrng(resolvedSeed);
    randomFunc = prng.next;
  }

  // 3. Load offline words for the required difficulty level
  const validLevel = Math.max(1, Math.min(6, level));
  const levelWords = getWordsByLevel(validLevel);
  if (!levelWords || levelWords.length === 0) {
    throw new Error(`[RogueQuestionProvider] No offline words found for level ${validLevel}`);
  }

  // 4. Deterministically select a target word
  const targetIndex = Math.floor(randomFunc() * levelWords.length);
  const targetWord = levelWords[targetIndex];

  // 5. Generate question using existing offline generator
  const rawQuestion = generateQuestion(targetWord, levelWords, randomFunc);
  if (!rawQuestion) {
    // Defensive fallback: pick first word if generation failed
    const fallbackTarget = levelWords[0];
    const fallback = generateQuestion(fallbackTarget, levelWords, randomFunc);
    if (!fallback) {
      throw new Error('[RogueQuestionProvider] Failed to generate offline vocabulary question');
    }
    return formatQuestionContract(fallback, encounterId, turn);
  }

  return formatQuestionContract(rawQuestion, encounterId, turn);
}

/**
 * Formats raw generator output into a secure UI-safe combat contract.
 *
 * @param {object} raw
 * @param {string} encounterId
 * @param {number} turn
 * @returns {object}
 */
function formatQuestionContract(raw, encounterId, turn) {
  const token = `qtok_${encounterId}_t${turn}_${raw.questionId}`;

  // Strip isCorrect so UI logic cannot cheat or inspect correct answers
  const safeChoices = (raw.choices || []).map((choice) => ({
    id: String(choice.id),
    text: String(choice.text),
  }));

  return {
    questionId: raw.questionId,
    token,
    word: raw.word,
    partOfSpeech: raw.partOfSpeech,
    level: raw.level,
    choices: safeChoices,
    correctChoiceId: String(raw.correctChoiceId),
  };
}
