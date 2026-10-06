import { getCampaignStages } from './campaignConfig.js';

export function isStageUnlocked(progress, stageId) {
  // Fresh install default
  if (stageId === 'L1-S1') return true;
  if (!progress || !progress.clearedStages) return false;

  const stages = getCampaignStages();
  const stageIndex = stages.findIndex(s => s.id === stageId);
  if (stageIndex <= 0) return true; // Failsafe for first stage
  
  const prevStage = stages[stageIndex - 1];
  return progress.clearedStages.includes(prevStage.id);
}

export function getNextStage(stageId) {
  const stages = getCampaignStages();
  const idx = stages.findIndex(s => s.id === stageId);
  if (idx >= 0 && idx < stages.length - 1) {
    return stages[idx + 1].id;
  }
  return null;
}

export function isWorldCompleted(progress, world) {
  if (!progress || !progress.clearedStages) return false;
  return progress.clearedStages.includes(`L${world}-BOSS`);
}

export function isCampaignCompleted(progress) {
  return isWorldCompleted(progress, 6);
}
