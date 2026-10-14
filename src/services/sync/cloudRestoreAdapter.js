import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeIdentity, getScopedKey } from '../../storage/storageIdentity';
import { createDefaultPlayerProgress } from '../../storage/playerProgressStorage';

/**
 * CLOUD PROFILE SYNC V0.1 — CLOUD TO LOCAL RESTORE ADAPTER (PHASE 5A)
 * 
 * CORE RESTORE INVARIANTS:
 * 
 * 1. Cloud-Owned Fields:
 *    - totalXp
 *    - campaign clearedStages
 *    - stageStars
 *    - stageScores
 *    - bestCombo (high-water mark across campaign & stats)
 * 
 * 2. Locally-Owned / Non-Cloud Fields (MUST NOT BE OVERWRITTEN):
 *    - mistakes (mistake bank / spaced repetition)
 *    - battleHistory (local match history)
 *    - settings (sound, haptics, language)
 *    - pvpLoadout (equipped local items)
 *    - processedEvents (event deduplication queue)
 *    - daily (unrelated local daily quest / streak tracker UI data)
 * 
 * 3. Derived Level:
 *    - Level is NEVER stored separately in playerProgress; it remains derived from totalXp.
 */

/**
 * Pure function that blends cloud-owned progress into local progress objects.
 * 
 * @param {object} cloudProgress - Validated cloud progress snapshot
 * @param {object} [currentLocalPlayer] - Current local playerProgress
 * @param {object} [currentLocalCampaign] - Current local campaignProgress
 * @returns {{ playerProgress: object, campaignProgress: object }}
 */
export function applyCloudToLocalProgress(cloudProgress, currentLocalPlayer = {}, currentLocalCampaign = {}) {
  if (!cloudProgress || typeof cloudProgress !== 'object') {
    throw new Error('[CloudRestore] Valid cloud progress is required');
  }

  const cloudProgression = cloudProgress.progression || {};
  const cloudCampaign = cloudProgress.campaign || {};

  // 1. Restore Player Progress (preserving local non-cloud fields)
  const basePlayer = currentLocalPlayer && typeof currentLocalPlayer === 'object' && Object.keys(currentLocalPlayer).length > 0
    ? { ...currentLocalPlayer }
    : createDefaultPlayerProgress();

  const cloudCombo = Number.isInteger(cloudCampaign.bestCombo) && cloudCampaign.bestCombo >= 0
    ? cloudCampaign.bestCombo
    : 0;

  const playerStats = { ...(basePlayer.stats || {}) };
  playerStats.bestCombo = Math.max(playerStats.bestCombo || 0, cloudCombo);

  const updatedPlayerProgress = {
    ...basePlayer,
    schemaVersion: 1,
    // Cloud owns totalXp
    totalXp: Number.isInteger(cloudProgression.totalXp) && cloudProgression.totalXp >= 0
      ? cloudProgression.totalXp
      : (basePlayer.totalXp || 0),
    // Local owns processedEvents and daily
    processedEvents: Array.isArray(basePlayer.processedEvents) ? [...basePlayer.processedEvents] : [],
    daily: basePlayer.daily ? { ...basePlayer.daily } : createDefaultPlayerProgress().daily,
    stats: playerStats
  };

  // Do NOT store level separately
  delete updatedPlayerProgress.level;

  // 2. Restore Campaign Progress
  const baseCampaign = currentLocalCampaign && typeof currentLocalCampaign === 'object'
    ? { ...currentLocalCampaign }
    : {};

  const clearedStagesMap = cloudCampaign.clearedStages || {};
  const clearedStages = Object.keys(clearedStagesMap);

  const stageStars = {};
  for (const [st, stars] of Object.entries(cloudCampaign.stageStars || {})) {
    if (Number.isInteger(stars) && stars >= 1 && stars <= 3) {
      stageStars[st] = stars;
    }
  }

  const stageScores = {};
  for (const [st, score] of Object.entries(cloudCampaign.stageScores || {})) {
    if (Number.isInteger(score) && score >= 0) {
      stageScores[st] = score;
    }
  }

  const updatedCampaignProgress = {
    ...baseCampaign,
    schemaVersion: 1,
    clearedStages,
    stageStars,
    stageScores,
    bestCombo: Math.max(baseCampaign.bestCombo || 0, cloudCombo)
  };

  return {
    playerProgress: updatedPlayerProgress,
    campaignProgress: updatedCampaignProgress
  };
}

/**
 * Loads scoped player progress for an identity, falling back to default.
 * 
 * @param {string} normalizedIdentity
 * @returns {Promise<object>}
 */
export async function loadScopedPlayerProgress(normalizedIdentity) {
  const key = getScopedKey('playerProgress', normalizedIdentity);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return createDefaultPlayerProgress();
    const data = JSON.parse(raw);
    return data || createDefaultPlayerProgress();
  } catch (err) {
    console.warn(`[CloudRestore] Failed to read scoped playerProgress for ${normalizedIdentity}:`, err);
    return createDefaultPlayerProgress();
  }
}

/**
 * Loads scoped campaign progress for an identity, falling back to default.
 * 
 * @param {string} normalizedIdentity
 * @returns {Promise<object>}
 */
export async function loadScopedCampaignProgress(normalizedIdentity) {
  const key = getScopedKey('campaignProgress', normalizedIdentity);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return {
        schemaVersion: 1,
        clearedStages: [],
        stageStars: {},
        stageScores: {},
        bestCombo: 0
      };
    }
    const data = JSON.parse(raw);
    return data || {
      schemaVersion: 1,
      clearedStages: [],
      stageStars: {},
      stageScores: {},
      bestCombo: 0
    };
  } catch (err) {
    console.warn(`[CloudRestore] Failed to read scoped campaignProgress for ${normalizedIdentity}:`, err);
    return {
      schemaVersion: 1,
      clearedStages: [],
      stageStars: {},
      stageScores: {},
      bestCombo: 0
    };
  }
}

/**
 * Restores cloud-owned progress into an account's scoped local AsyncStorage partition.
 * Also persists lastSyncedSnapshot baseline for the identity.
 * 
 * @param {string} targetIdentity - Canonical identity ('uid:<uid>' or 'guest')
 * @param {object} cloudProgress - Authoritative cloud progress state
 * @returns {Promise<{ playerProgress: object, campaignProgress: object }>}
 */
export async function restoreCloudProgressToLocal(targetIdentity, cloudProgress) {
  const normalizedIdentity = normalizeIdentity(targetIdentity);

  const localPlayer = await loadScopedPlayerProgress(normalizedIdentity);
  const localCampaign = await loadScopedCampaignProgress(normalizedIdentity);

  const { playerProgress, campaignProgress } = applyCloudToLocalProgress(
    cloudProgress,
    localPlayer,
    localCampaign
  );

  const playerKey = getScopedKey('playerProgress', normalizedIdentity);
  const campaignKey = getScopedKey('campaignProgress', normalizedIdentity);
  const snapshotKey = getScopedKey('lastSyncedSnapshot', normalizedIdentity);

  await AsyncStorage.multiSet([
    [playerKey, JSON.stringify(playerProgress)],
    [campaignKey, JSON.stringify(campaignProgress)],
    [snapshotKey, JSON.stringify(cloudProgress)]
  ]);

  return { playerProgress, campaignProgress };
}

/**
 * Saves scoped player progress for an identity.
 *
 * @param {string} targetIdentity
 * @param {object} playerProgress
 */
export async function saveScopedPlayerProgress(targetIdentity, playerProgress) {
  const normalizedIdentity = normalizeIdentity(targetIdentity);
  const key = getScopedKey('playerProgress', normalizedIdentity);
  await AsyncStorage.setItem(key, JSON.stringify(playerProgress));
}

/**
 * Saves scoped campaign progress for an identity.
 *
 * @param {string} targetIdentity
 * @param {object} campaignProgress
 */
export async function saveScopedCampaignProgress(targetIdentity, campaignProgress) {
  const normalizedIdentity = normalizeIdentity(targetIdentity);
  const key = getScopedKey('campaignProgress', normalizedIdentity);
  await AsyncStorage.setItem(key, JSON.stringify(campaignProgress));
}

/**
 * Reads the last synced snapshot for an identity.
 *
 * @param {string} targetIdentity
 * @returns {Promise<object|null>}
 */
export async function getLastSyncedSnapshot(targetIdentity) {
  const normalizedIdentity = normalizeIdentity(targetIdentity);
  const key = getScopedKey('lastSyncedSnapshot', normalizedIdentity);
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

/**
 * Persists the last synced snapshot for an identity.
 *
 * @param {string} targetIdentity
 * @param {object} snapshot
 */
export async function setLastSyncedSnapshot(targetIdentity, snapshot) {
  const normalizedIdentity = normalizeIdentity(targetIdentity);
  const key = getScopedKey('lastSyncedSnapshot', normalizedIdentity);
  await AsyncStorage.setItem(key, JSON.stringify(snapshot));
}
