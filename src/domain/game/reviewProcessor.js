import { loadPlayerProgress, savePlayerProgress, recordDailyActivity, hasProcessedEvent, recordProcessedEvent } from '../../storage/playerProgressStorage';
import { loadMistakes, saveMistakes, processReviewResult, hasProcessedMistakeEvent, recordProcessedMistakeEvent } from '../../storage/mistakeStorage';
import { XP_REWARDS } from '../player/xpRewards';

export async function processReviewAnswer(eventId, mistakeId, isCorrect) {
  let xpEarned = 0;
  let newlyRecovered = false;

  // Mistake Storage
  let mistakes = await loadMistakes();
  if (!hasProcessedMistakeEvent(mistakes, eventId)) {
    const preRecovered = mistakes.records[mistakeId]?.isRecovered || false;
    mistakes = await processReviewResult(mistakes, mistakeId, isCorrect);
    mistakes = recordProcessedMistakeEvent(mistakes, eventId);
    await saveMistakes(mistakes);
    
    const postRecovered = mistakes.records[mistakeId]?.isRecovered || false;
    newlyRecovered = !preRecovered && postRecovered;
  }

  // Player Progress
  let playerProgress = await loadPlayerProgress();
  if (!hasProcessedEvent(playerProgress, eventId)) {
    playerProgress = recordDailyActivity(playerProgress);
    
    if (isCorrect) {
      xpEarned = XP_REWARDS.REVIEW_CORRECT;
      playerProgress.totalXp += xpEarned;
      playerProgress.stats.totalXpEarned += xpEarned;
    }
    
    // Mission 1: 20 questions
    const dm = playerProgress.daily.missions;
    if (!dm.m1.claimed) {
      dm.m1.progress += 1;
      if (dm.m1.progress >= 20) {
        dm.m1.claimed = true;
        playerProgress.totalXp += 30;
        playerProgress.stats.totalXpEarned += 30;
        xpEarned += 30;
      }
    }

    playerProgress = recordProcessedEvent(playerProgress, eventId);
    await savePlayerProgress(playerProgress);
  }

  return { xpEarned, newlyRecovered };
}
