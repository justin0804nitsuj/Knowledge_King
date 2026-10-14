import AsyncStorage from '@react-native-async-storage/async-storage';
import { getActiveScopedKey, getScopedKey } from './storageIdentity';

const CURRENT_SCHEMA_VERSION = 1;

async function resolveKey(explicitIdentity) {
  if (explicitIdentity) {
    return getScopedKey('campaignProgress', explicitIdentity);
  }
  return getActiveScopedKey('campaignProgress');
}

/**
 * Loads the campaign progress defensively.
 * Falls back to an empty initial state if missing or corrupted.
 */
export async function loadCampaignProgress(explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return createDefaultProgress();
    
    const data = JSON.parse(raw);
    
    // Schema migrations can go here later if needed
    if (data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      // Just fallback for now
      return createDefaultProgress();
    }
    
    return data;
  } catch (err) {
    console.warn('Failed to load campaign progress, falling back to default.', err);
    return createDefaultProgress();
  }
}

/**
 * Persists the campaign progress.
 */
export async function saveCampaignProgress(progress, explicitIdentity) {
  try {
    const key = await resolveKey(explicitIdentity);
    await AsyncStorage.setItem(key, JSON.stringify(progress));
  } catch (err) {
    console.error('Failed to save campaign progress', err);
    throw err;
  }
}

/**
 * Factory for initial state.
 */
function createDefaultProgress() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    clearedStages: [],
    stageStars: {}, // { 'L1-S1': 3, 'L1-S2': 1 }
    stageScores: {},
  };
}

/**
 * Helper to record a battle result.
 */
export async function recordStageResult(stageId, stars, score, explicitIdentity) {
  const progress = await loadCampaignProgress(explicitIdentity);
  
  if (!progress.clearedStages.includes(stageId)) {
    progress.clearedStages.push(stageId);
  }
  
  const currentStars = progress.stageStars[stageId] || 0;
  if (stars > currentStars) {
    progress.stageStars[stageId] = stars;
  }
  
  const currentScore = progress.stageScores[stageId] || 0;
  if (score > currentScore) {
    progress.stageScores[stageId] = score;
  }
  
  await saveCampaignProgress(progress, explicitIdentity);
  return progress;
}

export async function resetCampaignProgress(explicitIdentity) {
  await saveCampaignProgress(createDefaultProgress(), explicitIdentity);
}
