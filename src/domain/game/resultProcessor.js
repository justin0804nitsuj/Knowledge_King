import { loadCampaignProgress, saveCampaignProgress } from '../../storage/campaignStorage';
import { loadPlayerProgress, savePlayerProgress, recordDailyActivity } from '../../storage/playerProgressStorage';
import { loadMistakes, saveMistakes, recordMistakesFromBattle } from '../../storage/mistakeStorage';
import { loadBattleHistory, saveBattleHistory, addBattleRecord } from '../../storage/battleHistoryStorage';
import { calculateStars } from '../adventure/starRating';
import { XP_REWARDS } from '../player/xpRewards';
import { BATTLE_STATES } from './battleEngine';
import { getStageById } from '../adventure/campaignConfig';

// In-memory set to prevent double-processing in the same session
const processedBattleIds = new Set();

/**
 * Coherently processes one completed battle result.
 */
export async function processBattleResult(battleId, finalState, stageId) {
  if (processedBattleIds.has(battleId)) {
    return null; // Already processed
  }
  
  const stage = getStageById(stageId);
  const isVictory = finalState.status === BATTLE_STATES.VICTORY;
  const isPerfect = isVictory && finalState.wrongCount === 0 && finalState.timeoutCount === 0;
  
  // 1. Campaign progress
  const campaign = await loadCampaignProgress();
  const isFirstClear = isVictory && !campaign.clearedStages.includes(stageId);
  const earnedStars = calculateStars(isVictory, finalState.correctCount, finalState.wrongCount, finalState.timeoutCount);
  
  if (isVictory) {
    if (!campaign.clearedStages.includes(stageId)) {
      campaign.clearedStages.push(stageId);
    }
    const currentStars = campaign.stageStars[stageId] || 0;
    if (earnedStars > currentStars) {
      campaign.stageStars[stageId] = earnedStars;
    }
    const currentScore = campaign.stageScores[stageId] || 0;
    if (finalState.score > currentScore) {
      campaign.stageScores[stageId] = finalState.score;
    }
    await saveCampaignProgress(campaign);
  }

  // 2. XP Calculation
  let xpEarned = finalState.correctCount * XP_REWARDS.CORRECT_ANSWER;
  
  if (isVictory) {
    xpEarned += XP_REWARDS.VICTORY[stage.type];
    
    if (isFirstClear) {
      xpEarned += XP_REWARDS.FIRST_CLEAR[stage.type];
    }
    
    if (isPerfect) {
      xpEarned += XP_REWARDS.PERFECT_VICTORY;
    }
  }

  // 3. Player Progress & Daily
  let playerProgress = await loadPlayerProgress();
  playerProgress = recordDailyActivity(playerProgress);
  
  playerProgress.totalXp += xpEarned;
  
  // Update lifetime stats
  const st = playerProgress.stats;
  st.battlesPlayed += 1;
  if (isVictory) st.battlesWon += 1;
  else st.battlesLost += 1;
  
  st.totalQuestions += finalState.questionNumber;
  st.totalCorrect += finalState.correctCount;
  st.totalWrong += finalState.wrongCount;
  st.totalTimeouts += finalState.timeoutCount;
  if (finalState.maxCombo > st.bestCombo) st.bestCombo = finalState.maxCombo;
  
  if (isPerfect) st.perfectVictories += 1;
  if (isVictory) {
    if (stage.type === 'NORMAL') st.normalWins += 1;
    if (stage.type === 'ELITE') st.eliteWins += 1;
    if (stage.type === 'BOSS') st.bossWins += 1;
  }
  st.totalXpEarned += xpEarned;

  // Daily missions
  const dm = playerProgress.daily.missions;
  
  // Mission 1: 20 questions
  if (!dm.m1.claimed) {
    dm.m1.progress += finalState.questionNumber;
    if (dm.m1.progress >= 20) {
      dm.m1.claimed = true;
      playerProgress.totalXp += 30; // reward
      st.totalXpEarned += 30;
      xpEarned += 30; // Add to this battle's display total
    }
  }

  // Mission 2: 2 Adventure Wins
  if (!dm.m2.claimed && isVictory) {
    dm.m2.progress += 1;
    if (dm.m2.progress >= 2) {
      dm.m2.claimed = true;
      playerProgress.totalXp += 40;
      st.totalXpEarned += 40;
      xpEarned += 40;
    }
  }

  // Mission 3: 1 Perfect Victory
  if (!dm.m3.claimed && isPerfect) {
    dm.m3.progress += 1;
    if (dm.m3.progress >= 1) {
      dm.m3.claimed = true;
      playerProgress.totalXp += 50;
      st.totalXpEarned += 50;
      xpEarned += 50;
    }
  }

  await savePlayerProgress(playerProgress);

  // 4. Mistake Tracking
  // We need to parse state to find wrong and timeout ids. 
  // Let's assume finalState has answeredTargetIds, but we need specifically which ones were wrong.
  // We should modify battleEngine to track `wrongTargetIds` and `timeoutTargetIds`.
  let mistakes = await loadMistakes();
  mistakes = await recordMistakesFromBattle(
    mistakes, 
    finalState.correctTargetIds || [], 
    finalState.wrongTargetIds || [], 
    finalState.timeoutTargetIds || [], 
    stage.vocabularyLevel
  );
  await saveMistakes(mistakes);

  // 5. Battle History
  let history = await loadBattleHistory();
  const record = {
    id: battleId,
    timestamp: Date.now(),
    mode: 'ADVENTURE',
    stageId,
    stageType: stage.type,
    vocabularyLevel: stage.vocabularyLevel,
    result: isVictory ? 'VICTORY' : 'DEFEAT',
    score: finalState.score,
    stars: earnedStars,
    correct: finalState.correctCount,
    wrong: finalState.wrongCount,
    timeouts: finalState.timeoutCount,
    maxCombo: finalState.maxCombo,
    xpEarned
  };
  history = addBattleRecord(history, record);
  await saveBattleHistory(history);

  processedBattleIds.add(battleId);
  
  return {
    xpEarned,
    isFirstClear,
    isPerfect,
    earnedStars
  };
}
