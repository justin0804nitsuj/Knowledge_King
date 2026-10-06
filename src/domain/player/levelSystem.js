/**
 * Pure function to calculate player level and progress from total XP.
 * XP required to go from Level N to N+1 is: 100 + (N - 1) * 50
 */
export function getPlayerLevelInfo(totalXp) {
  let level = 1;
  let xpRemaining = totalXp;
  
  while (true) {
    const xpRequiredForNext = getXpRequiredForNextLevel(level);
    if (xpRemaining >= xpRequiredForNext) {
      xpRemaining -= xpRequiredForNext;
      level++;
    } else {
      return {
        level,
        totalXp,
        xpIntoCurrentLevel: xpRemaining,
        xpRequiredForNextLevel: xpRequiredForNext,
        progressRatio: xpRemaining / xpRequiredForNext
      };
    }
  }
}

export function getXpRequiredForNextLevel(level) {
  return 100 + (level - 1) * 50;
}
