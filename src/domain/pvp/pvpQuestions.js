import { createSeededRandom } from '../game/seededRandom';
import { generateQuestion } from '../vocabulary/questionGenerator';
import { getWordsByLevel, getAvailableLevels } from '../vocabulary/vocabularyRepository';

/**
 * Deterministic helper mapping roundIndex to vocabulary Level for PvP.
 * Progression:
 * 0, 1, 2    -> Level 4
 * 3, 4, 5, 6  -> Level 5
 * 7+         -> Level 6
 */
export function getPvpLevelForRound(roundIndex) {
  const index = Math.max(0, Math.floor(Number(roundIndex) || 0));
  if (index <= 2) return 4;
  if (index <= 6) return 5;
  return 6;
}

/**
 * Generates the canonical deterministic question sequence for a PvP match.
 * Shared between Host and Guest, seeded exclusively by match.battleSeed.
 *
 * Difficulty progression is strictly roundIndex-driven (Level 4 -> 5 -> 6).
 * Levels 1-3 are never selected for PvP.
 */
export function createPvpQuestions(match) {
  const { battleSeed, level, questionCount } = match || {};
  const seed = Number(battleSeed);
  if (typeof battleSeed !== 'string' || !/^\d+$/.test(battleSeed) ||
      !Number.isSafeInteger(seed) ||
      (level !== undefined && !Number.isInteger(level)) ||
      !Number.isInteger(questionCount) || questionCount < 1) {
    throw new Error('Malformed or incomplete match config');
  }

  if (level !== undefined && !getAvailableLevels().includes(level)) {
    throw new Error(`Level ${level} not available.`);
  }

  const rng = createSeededRandom(seed);
  const questions = [];
  const usedTargetIds = new Set();

  for (let i = 0; i < questionCount; i += 1) {
    const roundLevel = getPvpLevelForRound(i);
    const levelWords = getWordsByLevel(roundLevel);
    if (!levelWords || !levelWords.length) {
      throw new Error(`Empty vocabulary pool for level ${roundLevel}`);
    }

    let question = null;
    let attempts = 0;
    const maxAttempts = levelWords.length;

    while (!question && attempts < maxAttempts) {
      attempts += 1;
      const startIdx = Math.floor(rng() * levelWords.length);
      let targetWord = null;
      for (let j = 0; j < levelWords.length; j += 1) {
        const idx = (startIdx + j) % levelWords.length;
        const candidate = levelWords[idx];
        if (!usedTargetIds.has(candidate.id)) {
          targetWord = candidate;
          break;
        }
      }

      if (!targetWord) {
        throw new Error(`Insufficient vocabulary to generate PvP questions for level ${roundLevel}`);
      }

      usedTargetIds.add(targetWord.id);
      question = generateQuestion(targetWord, levelWords, rng);
    }

    if (!question) {
      throw new Error(`Insufficient vocabulary to generate PvP questions for level ${roundLevel}`);
    }

    questions.push(question);
  }

  return questions;
}
