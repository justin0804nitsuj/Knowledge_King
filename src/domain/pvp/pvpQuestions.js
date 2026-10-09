import { createInitialState, nextQuestion, BATTLE_STATES } from '../game/battleEngine';
import { getWordsByLevel } from '../vocabulary/vocabularyRepository';

// Both the display and honest Host settlement replay this answer-independent sequence.
export function createPvpQuestions(match) {
  const { battleSeed, level, questionCount } = match || {};
  const seed = Number(battleSeed);
  if (typeof battleSeed !== 'string' || !/^\d+$/.test(battleSeed) ||
      !Number.isSafeInteger(seed) || !Number.isInteger(level) ||
      !Number.isInteger(questionCount) || questionCount < 1) {
    throw new Error('Malformed or incomplete match config');
  }

  const words = getWordsByLevel(level);
  if (!words.length) throw new Error(`Empty vocabulary pool for level ${level}`);
  let state = createInitialState(seed, level, words, { playerHp: 100, enemyHp: 100 });
  const questions = [];

  for (let i = 0; i < questionCount; i += 1) {
    state = nextQuestion(state);
    if (state.status !== BATTLE_STATES.QUESTION_ACTIVE || !state.currentQuestion) {
      throw new Error('Insufficient vocabulary to generate PvP questions');
    }
    questions.push(state.currentQuestion);
    state = {
      ...state,
      status: BATTLE_STATES.QUESTION_RESOLVED,
      answeredTargetIds: [...state.answeredTargetIds, state.currentQuestion.targetId],
    };
  }
  return questions;
}
