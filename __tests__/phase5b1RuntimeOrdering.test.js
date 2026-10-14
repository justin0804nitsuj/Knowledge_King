import AsyncStorage from '@react-native-async-storage/async-storage';
import { processBattleResult } from '../src/domain/game/resultProcessor';
import { processReviewAnswer } from '../src/domain/game/reviewProcessor';
import { BATTLE_STATES } from '../src/domain/game/battleEngine';
import {
  getActiveIdentity,
  setActiveIdentity,
  getScopedKey,
  getDeviceId,
  _resetCachedDeviceIdForTests
} from '../src/storage/storageIdentity';
import {
  getUnsyncedProgress,
  clearUnsyncedProgress,
  addStagedRepeatableXp
} from '../src/storage/unsyncedProgressStorage';
import {
  getPendingSyncOp,
  clearPendingSyncOp,
  createPendingSyncOpFromStaged
} from '../src/storage/syncOutboxStorage';
import {
  flushLiveProgress,
  getSyncStatus,
  SYNC_STATUS,
  isCloudSyncReady,
  setCloudSyncReady,
  resetAllCloudSyncReady,
  _resetLiveSyncStateForTests
} from '../src/services/sync/liveProgressSync';
import {
  coordinateAccountProgress,
  extractHistoricalProgress
} from '../src/services/sync/accountProgressCoordinator';
import {
  loadScopedPlayerProgress,
  saveScopedPlayerProgress,
  loadScopedCampaignProgress,
  saveScopedCampaignProgress
} from '../src/services/sync/cloudRestoreAdapter';
import { createDefaultPlayerProgress } from '../src/storage/playerProgressStorage';

let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => (mockStore[key] !== undefined ? mockStore[key] : null)),
  setItem: jest.fn(async (key, value) => {
    mockStore[key] = String(value);
  }),
  multiSet: jest.fn(async (pairs) => {
    for (const [k, v] of pairs) {
      mockStore[k] = String(v);
    }
  }),
  removeItem: jest.fn(async (key) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  })
}));

let mockCloudDatabases = {};
let mockNetworkOnline = true;
let mockCloudFailure = null;
let mockBootstrapFailure = null;
const callLog = [];

jest.mock('../src/services/sync/cloudProgressService', () => {
  const { reduceCloudProgress } = require('../src/domain/sync/cloudProgressReducer');
  const { reconcileLegacyWithCloud } = require('../src/domain/sync/cloudBootstrap');

  return {
    getCloudProgress: jest.fn(async (uid) => {
      callLog.push({ type: 'getCloudProgress', uid });
      if (!mockNetworkOnline) {
        throw new Error('Network offline: failed to fetch cloud progress');
      }
      return mockCloudDatabases[uid] ? JSON.parse(JSON.stringify(mockCloudDatabases[uid])) : null;
    }),

    bootstrapCloudProgress: jest.fn(async (uid, localSnapshot) => {
      callLog.push({ type: 'bootstrapCloudProgress', uid, snapshot: localSnapshot });
      if (!mockNetworkOnline) {
        throw new Error('Network offline during bootstrap');
      }
      if (mockBootstrapFailure) {
        throw mockBootstrapFailure;
      }

      const current = mockCloudDatabases[uid] || null;
      let finalDoc;
      if (current === null) {
        finalDoc = {
          ...localSnapshot,
          schemaVersion: 1,
          revision: Math.max(1, localSnapshot?.revision || 1),
          updatedAt: Date.now()
        };
      } else {
        finalDoc = reconcileLegacyWithCloud(localSnapshot, current);
      }
      mockCloudDatabases[uid] = finalDoc;
      return {
        committed: true,
        snapshot: JSON.parse(JSON.stringify(finalDoc))
      };
    }),

    applySyncOperation: jest.fn(async (uid, op) => {
      callLog.push({ type: 'applySyncOperation', uid, opId: op?.opId });
      if (!mockNetworkOnline) {
        throw new Error('Network offline: failed to apply sync op');
      }
      if (mockCloudFailure) {
        throw mockCloudFailure;
      }

      const current = mockCloudDatabases[uid] || null;
      const next = reduceCloudProgress(current, op);
      mockCloudDatabases[uid] = next;

      return {
        committed: true,
        snapshot: JSON.parse(JSON.stringify(next))
      };
    })
  };
});

describe('Phase 5B.1 — Runtime Ordering & Bootstrap Safety', () => {
  const TEST_UID = 'User5B1';
  const TEST_IDENTITY = `uid:${TEST_UID}`;

  beforeEach(async () => {
    mockStore = {};
    mockCloudDatabases = {};
    mockNetworkOnline = true;
    mockCloudFailure = null;
    mockBootstrapFailure = null;
    callLog.length = 0;
    _resetCachedDeviceIdForTests();
    _resetLiveSyncStateForTests();
    await setActiveIdentity(TEST_IDENTITY);
  });

  // A. First cloud-enabled startup while offline: progressReady true, cloudSyncReady false
  test('A. first cloud-enabled startup while offline: progressReady true, cloudSyncReady false', async () => {
    mockNetworkOnline = false;

    // Seed initial local player
    const localPlayer = { ...createDefaultPlayerProgress(), totalXp: 1250 };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);

    const coordResult = await coordinateAccountProgress({ uid: TEST_UID });

    expect(coordResult.identity).toBe(TEST_IDENTITY);
    expect(coordResult.status).toBe('authenticated_offline');
    expect(coordResult.cloudSyncSuccess).toBe(false);

    // Local scoped progress is ready and available
    const active = await getActiveIdentity();
    expect(active).toBe(TEST_IDENTITY);
    const loaded = await loadScopedPlayerProgress(active);
    expect(loaded.totalXp).toBe(1250);

    // Service-level guard confirms cloudSyncReady is false
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(false);
  });

  // B. Offline player with existing 1250 XP earns +50 before first bootstrap
  test('B. offline player with existing 1250 XP earns +50 before first bootstrap', async () => {
    mockNetworkOnline = false;

    // Seed local player with 1250 XP
    const localPlayer = { ...createDefaultPlayerProgress(), totalXp: 1250 };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);
    await coordinateAccountProgress({ uid: TEST_UID });

    // Player earns 50 repeatable XP while offline
    const updatedPlayer = { ...localPlayer, totalXp: 1300 };
    await saveScopedPlayerProgress(TEST_IDENTITY, updatedPlayer);
    await addStagedRepeatableXp(TEST_IDENTITY, 50);

    const unsynced = await getUnsyncedProgress(TEST_IDENTITY);
    expect(unsynced.repeatableXpDelta).toBe(50);

    // Attempting to flush while cloudSyncReady is false must be skipped
    const flushResult = await flushLiveProgress(TEST_IDENTITY);
    expect(flushResult.status).toBe('skipped_not_ready');
    expect(flushResult.reason).toBe('CLOUD_SYNC_NOT_READY');

    // Cloud has NEVER been written
    expect(mockCloudDatabases[TEST_UID]).toBeUndefined();

    // Local storage and staged progress are untouched
    const currentLocal = await loadScopedPlayerProgress(TEST_IDENTITY);
    expect(currentLocal.totalXp).toBe(1300);
    const postUnsynced = await getUnsyncedProgress(TEST_IDENTITY);
    expect(postUnsynced.repeatableXpDelta).toBe(50);
  });

  // C. Network returns: bootstrap occurs BEFORE live op flush
  test('C. network returns: bootstrap occurs BEFORE live op flush', async () => {
    mockNetworkOnline = false;

    // Setup 1250 XP + 50 offline staged
    const localPlayer = { ...createDefaultPlayerProgress(), totalXp: 1300 };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);
    await addStagedRepeatableXp(TEST_IDENTITY, 50);

    // Network returns!
    mockNetworkOnline = true;
    callLog.length = 0;

    // Conceptual ordering:
    // Reconnect coordinator bootstrap -> cloudSyncReady -> flushLiveProgress
    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(true);
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(true);

    const flushRes = await flushLiveProgress(TEST_IDENTITY);
    expect(flushRes.status).toBe('synced');

    // Verify ordering in call log:
    // getCloudProgress -> bootstrapCloudProgress -> applySyncOperation
    const bootstrapIdx = callLog.findIndex((c) => c.type === 'bootstrapCloudProgress');
    const applyOpIdx = callLog.findIndex((c) => c.type === 'applySyncOperation');

    expect(bootstrapIdx).toBeGreaterThanOrEqual(0);
    expect(applyOpIdx).toBeGreaterThanOrEqual(0);
    expect(bootstrapIdx).toBeLessThan(applyOpIdx);
  });

  // D. Final cloud result preserves historical progress and new staged progress (1250 + 50 = 1300)
  test('D. final cloud result preserves historical progress and new staged progress', async () => {
    // Local player has 1250 historical + 50 offline staged = 1300 local total
    const localPlayer = { ...createDefaultPlayerProgress(), totalXp: 1300 };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);
    await addStagedRepeatableXp(TEST_IDENTITY, 50);

    // Reconnect & coordinate
    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(true);

    // Flush live op
    await flushLiveProgress(TEST_IDENTITY);

    // Cloud total XP must equal exact 1300 (1250 historical + 50 staged)
    const cloudProgress = mockCloudDatabases[TEST_UID];
    expect(cloudProgress).toBeDefined();
    expect(cloudProgress.progression.totalXp).toBe(1300);

    // Local player total XP must remain 1300
    const localFinal = await loadScopedPlayerProgress(TEST_IDENTITY);
    expect(localFinal.totalXp).toBe(1300);

    // Unsynced accumulator drained
    const unsyncedFinal = await getUnsyncedProgress(TEST_IDENTITY);
    expect(unsyncedFinal.repeatableXpDelta).toBe(0);
  });

  // E. Bootstrap failure: live SyncOp is NOT transmitted
  test('E. bootstrap failure: live SyncOp is NOT transmitted', async () => {
    // Setup offline staged data
    const localPlayer = { ...createDefaultPlayerProgress(), totalXp: 1300 };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);
    await addStagedRepeatableXp(TEST_IDENTITY, 50);

    // Network returns, but bootstrap throws server error
    mockNetworkOnline = true;
    mockBootstrapFailure = new Error('500 Internal Cloud Error during bootstrap');
    callLog.length = 0;

    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(false);
    expect(coordRes.status).toBe('authenticated_offline');
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(false);

    // flushLiveProgress must reject without transmitting live SyncOps
    const flushRes = await flushLiveProgress(TEST_IDENTITY);
    expect(flushRes.status).toBe('skipped_not_ready');
    expect(flushRes.reason).toBe('CLOUD_SYNC_NOT_READY');

    // No live op was sent
    const applied = callLog.filter((c) => c.type === 'applySyncOperation');
    expect(applied.length).toBe(0);

    // Staged progress remains untouched
    const unsynced = await getUnsyncedProgress(TEST_IDENTITY);
    expect(unsynced.repeatableXpDelta).toBe(50);
  });

  // F. Already-online battle: staging schedules background flush without requiring reconnect
  test('F. already-online battle: staging schedules background flush without requiring reconnect', async () => {
    // Account is bootstrapped and cloudSyncReady
    await coordinateAccountProgress({ uid: TEST_UID });
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(true);
    callLog.length = 0;

    const finalState = {
      status: BATTLE_STATES.VICTORY,
      correctCount: 4,
      wrongCount: 0,
      timeoutCount: 0,
      questionNumber: 4,
      maxCombo: 4,
      score: 100,
      correctTargetIds: [],
      wrongTargetIds: [],
      timeoutTargetIds: []
    };

    // Battle completes while ONLINE
    await processBattleResult('battle_online_auto_flush', finalState, 'L1-S1');

    // Allow background flush to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Verify applySyncOperation was dispatched without requiring reconnect or restart
    const applied = callLog.filter((c) => c.type === 'applySyncOperation');
    expect(applied.length).toBeGreaterThan(0);
    expect(mockCloudDatabases[TEST_UID].progression.totalXp).toBeGreaterThan(0);
  });

  // G. Already-online review: staging schedules background flush
  test('G. already-online review: staging schedules background flush', async () => {
    await coordinateAccountProgress({ uid: TEST_UID });
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(true);
    callLog.length = 0;

    // Review answer completes while ONLINE (eventId, mistakeId, isCorrect)
    await processReviewAnswer('review_event_1', 'word_apple', true);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const applied = callLog.filter((c) => c.type === 'applySyncOperation');
    expect(applied.length).toBeGreaterThan(0);
    expect(mockCloudDatabases[TEST_UID].progression.totalXp).toBeGreaterThan(0);
  });

  // H. Background flush failure: gameplay result remains persisted and staged data remains retryable
  test('H. background flush failure: gameplay result remains persisted and staged data remains retryable', async () => {
    await coordinateAccountProgress({ uid: TEST_UID });
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(true);

    // Cloud transmission will fail with transient network error
    mockCloudFailure = new Error('503 Service Unavailable');

    const finalState = {
      status: BATTLE_STATES.VICTORY,
      correctCount: 4,
      wrongCount: 0,
      timeoutCount: 0,
      questionNumber: 4,
      maxCombo: 4,
      score: 100,
      correctTargetIds: [],
      wrongTargetIds: [],
      timeoutTargetIds: []
    };

    const result = await processBattleResult('battle_flush_fail', finalState, 'L1-S1');
    expect(result.xpEarned).toBeGreaterThan(0);

    // Local player progress and history are successfully persisted
    const localP = await loadScopedPlayerProgress(TEST_IDENTITY);
    expect(localP.totalXp).toBe(result.xpEarned);

    // Allow background flush to complete and handle the error
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(getSyncStatus()).toBe(SYNC_STATUS.OFFLINE);

    // Staged unsynced data or pending op remains safe for retry (both repeatable XP and unique claims)
    const pending = await getPendingSyncOp(TEST_IDENTITY);
    const unsynced = await getUnsyncedProgress(TEST_IDENTITY);
    const pendingClaimsXp = (pending?.uniqueClaims || []).reduce((sum, c) => sum + (c.xpReward || 0), 0);
    const unsyncedClaimsXp = Object.values(unsynced?.uniqueClaims || {}).reduce((sum, c) => sum + (c.xpReward || 0), 0);
    const totalRemainingStaged = (pending?.repeatableXpDelta || 0) + (unsynced?.repeatableXpDelta || 0) + pendingClaimsXp + unsyncedClaimsXp;
    expect(totalRemainingStaged).toBe(result.xpEarned);

    // When network recovers, retry flushes cleanly
    mockCloudFailure = null;
    const retryRes = await flushLiveProgress(TEST_IDENTITY);
    expect(retryRes.status).toBe('synced');
    expect(mockCloudDatabases[TEST_UID].progression.totalXp).toBe(result.xpEarned);
  });

  // I. Reconnect + gameplay simultaneous flush triggers: single in-flight dispatcher only
  test('I. reconnect + gameplay simultaneous flush triggers: single in-flight dispatcher only', async () => {
    await coordinateAccountProgress({ uid: TEST_UID });
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(true);
    await addStagedRepeatableXp(TEST_IDENTITY, 60);

    // Fire two simultaneous flushes
    const [res1, res2] = await Promise.all([
      flushLiveProgress(TEST_IDENTITY),
      flushLiveProgress(TEST_IDENTITY)
    ]);

    const statuses = [res1.status, res2.status];
    expect(statuses).toContain('synced');
    expect(statuses).toContain('already_in_flight');

    // Only one SyncOp created and applied
    const applied = callLog.filter((c) => c.type === 'applySyncOperation');
    expect(applied.length).toBe(1);
    expect(mockCloudDatabases[TEST_UID].progression.totalXp).toBe(60);
  });

  // J. Account A cloudSyncReady does not leak to Account B
  test('J. Account A cloudSyncReady does not leak to Account B', async () => {
    // 1. Account A coordinates and becomes ready
    await coordinateAccountProgress({ uid: 'AccountA' });
    expect(isCloudSyncReady('uid:AccountA')).toBe(true);

    // 2. Account B signs in but has NOT completed coordination yet
    await setActiveIdentity('uid:AccountB');
    expect(isCloudSyncReady('uid:AccountB')).toBe(false);

    // Flush for Account B must be rejected
    const flushB = await flushLiveProgress('uid:AccountB');
    expect(flushB.status).toBe('skipped_not_ready');
    expect(flushB.reason).toBe('CLOUD_SYNC_NOT_READY');

    // 3. Guest likewise is never cloudSyncReady
    expect(isCloudSyncReady('guest')).toBe(false);
    const flushGuest = await flushLiveProgress('guest');
    expect(flushGuest.status).toBe('skipped_guest');
  });

  // K. App restart retries pending op only AFTER account cloud initialization
  test('K. app restart retries pending op only AFTER account cloud initialization', async () => {
    // 1. Stage and enqueue a pending op
    setCloudSyncReady(TEST_IDENTITY, true);
    await addStagedRepeatableXp(TEST_IDENTITY, 75);
    const devId = await getDeviceId();
    const op = await createPendingSyncOpFromStaged({ identity: TEST_IDENTITY, deviceId: devId });
    expect(op).toBeDefined();

    // 2. Simulate app restart: in-memory state is cleared
    _resetLiveSyncStateForTests();
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(false);

    // 3. Persisted pending op exists in outbox
    const persistedOp = await getPendingSyncOp(TEST_IDENTITY);
    expect(persistedOp).toBeDefined();
    expect(persistedOp.opId).toBe(op.opId);

    // 4. Before coordinator runs, live flush is rejected; pending op is NOT transmitted
    callLog.length = 0;
    const earlyFlush = await flushLiveProgress(TEST_IDENTITY);
    expect(earlyFlush.status).toBe('skipped_not_ready');
    expect(callLog.length).toBe(0);

    // 5. Coordinator runs and establishes readiness
    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(true);
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(true);

    // 6. Now flush retries the persisted pending op
    const retryFlush = await flushLiveProgress(TEST_IDENTITY);
    expect(retryFlush.status).toBe('synced');
    expect(await getPendingSyncOp(TEST_IDENTITY)).toBeNull();
    expect(mockCloudDatabases[TEST_UID].progression.totalXp).toBe(75);
  });
});
