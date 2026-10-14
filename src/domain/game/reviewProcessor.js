import { loadPlayerProgress, savePlayerProgress, recordDailyActivity, hasProcessedEvent, recordProcessedEvent } from '../../storage/playerProgressStorage';
import { loadMistakes, saveMistakes, processReviewResult, hasProcessedMistakeEvent, recordProcessedMistakeEvent } from '../../storage/mistakeStorage';
import { XP_REWARDS } from '../player/xpRewards';
import { getLocalDailyKey } from '../player/dailySystem';
import { buildDailyMissionClaimId } from '../sync/uniqueRewards';
import { addStagedRepeatableXp, addStagedUniqueClaim } from '../../storage/unsyncedProgressStorage';
import { flushLiveProgress } from '../../services/sync/liveProgressSync';
import { getActiveIdentity } from '../../storage/storageIdentity';

export async function processReviewAnswer(eventId, mistakeId, isCorrect) {
  let xpEarned = 0;
  let newlyRecovered = false;
  let repeatableReviewXp = 0;
  let stagedClaim = null;
  let isNewEvent = false;

  // Mistake Storage (local-only, not cloud synced in V0.1)
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
    isNewEvent = true;
    playerProgress = recordDailyActivity(playerProgress);
    
    if (isCorrect) {
      xpEarned = XP_REWARDS.REVIEW_CORRECT;
      repeatableReviewXp = xpEarned;
      playerProgress.totalXp += xpEarned;
      playerProgress.stats.totalXpEarned += xpEarned;
    }
    
    // Mission 1: 20 questions
    const dm = playerProgress.daily.missions;
    const dateKey = playerProgress.daily.lastActiveDate || getLocalDailyKey();
    if (!dm.m1.claimed) {
      dm.m1.progress += 1;
      if (dm.m1.progress >= 20) {
        dm.m1.claimed = true;
        playerProgress.totalXp += 30;
        playerProgress.stats.totalXpEarned += 30;
        xpEarned += 30;
        stagedClaim = {
          claimId: buildDailyMissionClaimId(dateKey, 'm1'),
          xpReward: 30
        };
      }
    }

    playerProgress = recordProcessedEvent(playerProgress, eventId);
    await savePlayerProgress(playerProgress);
  }

  // Stage Sync Metadata & Dispatch Background Sync (Local-First)
  if (isNewEvent) {
    try {
      const activeIdentity = await getActiveIdentity();
      if (repeatableReviewXp > 0) {
        await addStagedRepeatableXp(activeIdentity, repeatableReviewXp);
      }
      if (stagedClaim) {
        await addStagedUniqueClaim(activeIdentity, stagedClaim);
      }
      flushLiveProgress(activeIdentity).catch(() => {});
    } catch (syncStageErr) {
      console.warn('[ReviewProcessor] Failed to stage sync metadata:', syncStageErr);
    }
  }

  return { xpEarned, newlyRecovered };
}
