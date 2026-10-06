import { BATTLE_CONSTANTS } from './battleRules.js';
import { calculateScore } from './scoring.js';
import { createSeededRandom } from './seededRandom.js';
import { generateQuestion } from '../vocabulary/questionGenerator.js';

export const BATTLE_STATES = {
  READY: 'READY',
  QUESTION_ACTIVE: 'QUESTION_ACTIVE',
  QUESTION_RESOLVED: 'QUESTION_RESOLVED',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT'
};

export function createInitialState(seed, level, levelWords) {
  return {
    status: BATTLE_STATES.READY,
    playerHp: BATTLE_CONSTANTS.PLAYER_START_HP,
    opponentHp: BATTLE_CONSTANTS.OPPONENT_START_HP,
    score: 0,
    combo: 0,
    maxCombo: 0,
    questionNumber: 0,
    correctCount: 0,
    wrongCount: 0,
    timeoutCount: 0,
    answeredTargetIds: [],
    
    currentQuestion: null,
    
    _rng: createSeededRandom(seed),
    _levelWords: levelWords,
    _level: level
  };
}

export function nextQuestion(state) {
  if (state.status !== BATTLE_STATES.READY && state.status !== BATTLE_STATES.QUESTION_RESOLVED) {
    return state;
  }
  
  if (state.playerHp <= 0 || state.opponentHp <= 0) {
    return state;
  }
  
  let targetWord = null;
  const startIdx = Math.floor(state._rng() * state._levelWords.length);
  for (let i = 0; i < state._levelWords.length; i++) {
    const idx = (startIdx + i) % state._levelWords.length;
    const w = state._levelWords[idx];
    if (!state.answeredTargetIds.includes(w.id)) {
      targetWord = w;
      break;
    }
  }
  
  if (!targetWord) {
    return { ...state, status: BATTLE_STATES.VICTORY }; 
  }
  
  const question = generateQuestion(targetWord, state._levelWords, state._rng);
  if (!question) {
    return nextQuestion({
      ...state,
      answeredTargetIds: [...state.answeredTargetIds, targetWord.id]
    });
  }
  
  return {
    ...state,
    status: BATTLE_STATES.QUESTION_ACTIVE,
    currentQuestion: question,
    questionNumber: state.questionNumber + 1
  };
}

export function answerQuestion(state, choiceId, timeRemainingMs) {
  if (state.status !== BATTLE_STATES.QUESTION_ACTIVE) {
    return state;
  }
  
  const isCorrect = choiceId === state.currentQuestion.correctChoiceId;
  const isTimeout = choiceId === null;
  
  let playerHp = state.playerHp;
  let opponentHp = state.opponentHp;
  let score = state.score;
  let combo = state.combo;
  let maxCombo = state.maxCombo;
  
  if (isCorrect) {
    opponentHp -= BATTLE_CONSTANTS.DAMAGE_PER_CORRECT;
    score += calculateScore(true, timeRemainingMs, combo);
    combo += 1;
    if (combo > maxCombo) maxCombo = combo;
  } else {
    playerHp -= isTimeout ? BATTLE_CONSTANTS.DAMAGE_PER_TIMEOUT : BATTLE_CONSTANTS.DAMAGE_PER_WRONG;
    combo = 0;
  }
  
  let nextStatus = BATTLE_STATES.QUESTION_RESOLVED;
  if (playerHp <= 0) nextStatus = BATTLE_STATES.DEFEAT;
  else if (opponentHp <= 0) nextStatus = BATTLE_STATES.VICTORY;
  
  return {
    ...state,
    status: nextStatus,
    playerHp,
    opponentHp,
    score,
    combo,
    maxCombo,
    correctCount: state.correctCount + (isCorrect ? 1 : 0),
    wrongCount: state.wrongCount + (!isCorrect && !isTimeout ? 1 : 0),
    timeoutCount: state.timeoutCount + (isTimeout ? 1 : 0),
    answeredTargetIds: [...state.answeredTargetIds, state.currentQuestion.targetId],
    currentQuestion: {
      ...state.currentQuestion,
      selectedChoiceId: choiceId,
      isCorrect,
      isTimeout
    }
  };
}
