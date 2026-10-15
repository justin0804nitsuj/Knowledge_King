import { normalizeIdentity, GUEST_IDENTITY, getActiveIdentity, getDeviceId } from '../../storage/storageIdentity';
import { withSyncMutationLock } from '../../storage/syncLock';
import { getPendingSyncOp, clearPendingSyncOp, createPendingSyncOpFromStaged } from '../../storage/syncOutboxStorage';
import { getUnsyncedProgress } from '../../storage/unsyncedProgressStorage';
import { isUnsyncedEmpty } from '../../domain/sync/unsyncedProgress';
import { reconcileProgressOnOpAck } from '../../domain/sync/syncOperation';
import { applySyncOperation } from './cloudProgressService';
import {
  loadScopedPlayerProgress,
  loadScopedCampaignProgress,
  saveScopedPlayerProgress,
  saveScopedCampaignProgress,
  setLastSyncedSnapshot
} from './cloudRestoreAdapter';
import { DAILY_MISSIONS, getLocalDailyKey } from '../../domain/player/dailySystem';
import { createDefaultPlayerProgress } from '../../storage/playerProgressStorage';

/**
 * CLOUD PROFILE SYNC V0.1 — LIVE GAMEPLAY SYNC DISPATCHER (PHASE 5B)
 *
 * CORE INVARIANTS:
 * 1. Authenticated Identity Only:
 *    Guests play 100% locally; guests NEVER write to Firebase userProgress.
 * 2. Immutable Pending Op First:
 *    If an unresolved pendingSyncOp exists (lost ACK / app restart), retry the exact same op.
 * 3. Strict Concurrency Control:
 *    In-flight execution guard prevents duplicate simultaneous flushes.
 *    Non-blocking network transmission: storage lock is NOT held during network roundtrips,
 *    allowing continuous local gameplay and offline staging without deadlocks.
 * 4. Post-Op Gameplay Preservation:
 *    On cloud ACK, reconcileProgressOnOpAck preserves all repeatable XP and unique claims
 *    staged during or after the in-flight network round-trip.
 * 5. Network Resiliency (Local-First):
 *    Network failure NEVER undos local gameplay or drops staged data.
 */

export const SYNC_STATUS = Object.freeze({
  IDLE: 'idle',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  OFFLINE: 'offline',
  ERROR: 'error'
});

let currentSyncStatus = SYNC_STATUS.IDLE;
const statusListeners = new Set();
const inFlightFlushes = new Set();
const cloudSyncReadyIdentities = new Set();

/**
 * Checks if cloud progress bootstrap/restore has succeeded for the given identity in this session.
 * Guest always returns false.
 *
 * @param {string} identity
 * @returns {boolean}
 */
export function isCloudSyncReady(identity) {
  if (!identity) return false;
  const normalized = normalizeIdentity(identity);
  if (normalized === GUEST_IDENTITY) return false;
  return cloudSyncReadyIdentities.has(normalized);
}

/**
 * Sets cloud sync readiness for the given identity.
 * Guest is ignored.
 *
 * @param {string} identity
 * @param {boolean} isReady
 */
export function setCloudSyncReady(identity, isReady) {
  if (!identity) return;
  const normalized = normalizeIdentity(identity);
  if (normalized === GUEST_IDENTITY) return;
  if (isReady) {
    cloudSyncReadyIdentities.add(normalized);
  } else {
    cloudSyncReadyIdentities.delete(normalized);
  }
}

/**
 * Resets all cloud sync readiness across all identities.
 */
export function resetAllCloudSyncReady() {
  cloudSyncReadyIdentities.clear();
}

export function getSyncStatus() {
  return currentSyncStatus;
}

export function subscribeSyncStatus(listener) {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}

function updateSyncStatus(newStatus) {
  if (currentSyncStatus !== newStatus) {
    currentSyncStatus = newStatus;
    for (const listener of statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.warn('[LiveProgressSync] Status listener threw:', err);
      }
    }
  }
}

/**
 * Flushes pending and unsynced progress to cloud for the authenticated user.
 * Non-blocking, safe to invoke from background triggers or game loop handlers.
 *
 * @param {string} [explicitIdentity] - Optional target identity (defaults to activeIdentity)
 * @returns {Promise<{ status: string, reason?: string, error?: any }>}
 */
export async function flushLiveProgress(explicitIdentity) {
  let targetIdentity;
  if (explicitIdentity) {
    targetIdentity = normalizeIdentity(explicitIdentity);
  } else {
    targetIdentity = await getActiveIdentity();
  }

  // 1. Guest identity never syncs to Firebase
  if (targetIdentity === GUEST_IDENTITY) {
    updateSyncStatus(SYNC_STATUS.IDLE);
    return { status: 'skipped_guest' };
  }

  // 2. Defensive service-level guard: identity must have completed bootstrap/restore
  if (!isCloudSyncReady(targetIdentity)) {
    return { status: 'skipped_not_ready', reason: 'CLOUD_SYNC_NOT_READY' };
  }

  // 3. Prevent duplicate concurrent flushes for the same identity
  if (inFlightFlushes.has(targetIdentity)) {
    return { status: 'already_in_flight' };
  }

  inFlightFlushes.add(targetIdentity);

  try {
    const rawUid = targetIdentity.startsWith('uid:')
      ? targetIdentity.slice(4)
      : targetIdentity;

    let loopCount = 0;
    const MAX_SYNC_LOOPS = 10;

    while (loopCount < MAX_SYNC_LOOPS) {
      loopCount++;

      // A. Check for existing pending operation (Lost ACK / Restart retry)
      let pendingOp = await getPendingSyncOp(targetIdentity);

      if (!pendingOp || pendingOp.error) {
        // B. No pending op; check if accumulator has staged progress
        const unsynced = await getUnsyncedProgress(targetIdentity);
        if (isUnsyncedEmpty(unsynced)) {
          // Nothing left to sync!
          break;
        }

        // C. Create a new immutable pending op from staged progress
        const deviceId = await getDeviceId();
        pendingOp = await createPendingSyncOpFromStaged({
          identity: targetIdentity,
          deviceId
        });

        if (!pendingOp) {
          break;
        }
      }

      // D. Network transmission (lock NOT held, allowing local gameplay in parallel)
      updateSyncStatus(SYNC_STATUS.SYNCING);

      let cloudResult;
      try {
        cloudResult = await applySyncOperation(rawUid, pendingOp);
      } catch (netErr) {
        console.warn('[LiveProgressSync] Network error during applySyncOperation:', netErr);
        updateSyncStatus(SYNC_STATUS.OFFLINE);
        return { status: 'offline', error: netErr };
      }

      if (!cloudResult || !cloudResult.committed || !cloudResult.snapshot) {
        console.warn('[LiveProgressSync] Transaction not committed or snapshot missing:', cloudResult);
        updateSyncStatus(SYNC_STATUS.ERROR);
        return { status: 'error', error: new Error('Transaction not committed') };
      }

      // E. Cloud ACK confirmed: clear the pending op
      await clearPendingSyncOp(targetIdentity, pendingOp.opId);

      // F. Reconcile cloud state with post-op local unsynced progress
      const postOpUnsynced = await getUnsyncedProgress(targetIdentity);
      const localPlayer = await loadScopedPlayerProgress(targetIdentity);
      const localCampaign = await loadScopedCampaignProgress(targetIdentity);

      const reconciled = reconcileProgressOnOpAck({
        cloudSnapshot: cloudResult.snapshot,
        unsyncedProgress: postOpUnsynced,
        localCurrentCampaign: localCampaign
      });

      const today = getLocalDailyKey();
      const updatedDaily = localPlayer.daily
        ? JSON.parse(JSON.stringify(localPlayer.daily))
        : createDefaultPlayerProgress().daily;
      if (updatedDaily.missions) {
        for (const missionDef of Object.values(DAILY_MISSIONS)) {
          const claimId = `daily:${today}:${missionDef.id}`;
          if (cloudResult.snapshot?.uniqueClaims?.[claimId]) {
            if (updatedDaily.missions[missionDef.id]) {
              updatedDaily.missions[missionDef.id].claimed = true;
            }
          }
        }
      }

      const updatedPlayer = {
        ...localPlayer,
        totalXp: reconciled.progression.totalXp,
        daily: updatedDaily
      };

      const updatedCampaign = {
        ...localCampaign,
        clearedStages: reconciled.campaign.clearedStages,
        stageStars: reconciled.campaign.stageStars,
        stageScores: reconciled.campaign.stageScores,
        bestCombo: reconciled.campaign.bestCombo
      };

      await saveScopedPlayerProgress(targetIdentity, updatedPlayer);
      await saveScopedCampaignProgress(targetIdentity, updatedCampaign);
      await setLastSyncedSnapshot(targetIdentity, cloudResult.snapshot);

      // Loop continues to check if newly arrived staged items need another batch
    }

    updateSyncStatus(SYNC_STATUS.SYNCED);
    return { status: 'synced' };
  } catch (outerErr) {
    console.error('[LiveProgressSync] Unhandled error during flush:', outerErr);
    updateSyncStatus(SYNC_STATUS.ERROR);
    return { status: 'error', error: outerErr };
  } finally {
    inFlightFlushes.delete(targetIdentity);
  }
}

/**
 * Test reset helper for test suites.
 */
export function _resetLiveSyncStateForTests() {
  currentSyncStatus = SYNC_STATUS.IDLE;
  statusListeners.clear();
  inFlightFlushes.clear();
  cloudSyncReadyIdentities.clear();
}
