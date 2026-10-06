import { BATTLE_CONSTANTS } from './battleRules.js';

export function calculateScore(isCorrect, timeRemainingMs, currentCombo) {
  if (!isCorrect) return 0;
  
  let score = BATTLE_CONSTANTS.BASE_SCORE;
  
  // Time bonus (max +50)
  const timeRatio = Math.max(0, Math.min(1, timeRemainingMs / BATTLE_CONSTANTS.TIME_PER_QUESTION_MS));
  score += Math.floor(timeRatio * 50);
  
  // Combo bonus (+10 per combo, max 50)
  const comboBonus = Math.min(50, currentCombo * 10);
  score += comboBonus;
  
  return score;
}
