/**
 * Pure function to calculate star rating for a completed stage.
 */
export function calculateStars(isVictory, correctCount, wrongCount, timeoutCount) {
  if (!isVictory) return 0;
  
  if (wrongCount === 0 && timeoutCount === 0) {
    return 3;
  }
  
  const totalResolved = correctCount + wrongCount + timeoutCount;
  if (totalResolved === 0) return 0; // Failsafe
  
  const accuracy = correctCount / totalResolved;
  
  if (accuracy >= 0.8) {
    return 2;
  }
  
  return 1;
}
