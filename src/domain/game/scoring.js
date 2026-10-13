export function calculateScore(isCorrect, timeRemainingMs, currentCombo, config) {
  if (!isCorrect) return 0;
  
  let score = config ? config.baseScore : 100;
  let maxTimeMs = config ? config.timePerQuestionMs : 10000;
  
  // Time bonus (max +50)
  const timeRatio = Math.max(0, Math.min(1, timeRemainingMs / maxTimeMs));
  score += Math.floor(timeRatio * 50);
  
  // Combo bonus (+10 per combo, max 50)
  const comboBonus = Math.min(50, currentCombo * 10);
  score += comboBonus;
  
  return score;
}
