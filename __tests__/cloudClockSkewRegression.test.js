import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  initServerTimeOffset,
  getServerNow,
  getServerTimeOffset,
  getSafeServerNow,
  getCloudWriteTimestamp,
  CLOUD_WRITE_SAFETY_MARGIN_MS,
  isServerTimeReadyState,
  whenServerTimeReady,
  __setServerTimeOffsetForTest,
  __resetServerTimeForTest
} from '../src/services/firebase/serverTimeService';
import { reduceCloudProgress, createVirginCloudProgress } from '../src/domain/sync/cloudProgressReducer';
import { buildBootstrapSnapshot, reconcileLegacyWithCloud } from '../src/domain/sync/cloudBootstrap';
import { createSyncOperation } from '../src/domain/sync/syncOperation';
import {
  flushLiveProgress,
  getSyncStatus,
  SYNC_STATUS,
  _resetLiveSyncStateForTests,
  setCloudSyncReady,
  isPermissionOrSecurityError
} from '../src/services/sync/liveProgressSync';
import {
  getPendingSyncOp,
  clearPendingSyncOp,
  createAndPersistSyncOp
} from '../src/storage/syncOutboxStorage';
import {
  loadScopedPlayerProgress,
  loadScopedCampaignProgress,
  saveScopedPlayerProgress,
  saveScopedCampaignProgress
} from '../src/services/sync/cloudRestoreAdapter';
import { getDeviceId } from '../src/storage/storageIdentity';

let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => mockStore[key] !== undefined ? mockStore[key] : null),
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

jest.mock('../src/services/sync/cloudProgressService', () => ({
  applySyncOperation: jest.fn(async (uid, op, options = {}) => {
    if (!mockNetworkOnline) {
      throw new Error('Network offline');
    }
    if (mockCloudFailure) {
      throw mockCloudFailure;
    }

    const { reduceCloudProgress } = require('../src/domain/sync/cloudProgressReducer');
    const { whenServerTimeReady, getCloudWriteTimestamp } = require('../src/services/firebase/serverTimeService');
    const isReady = await whenServerTimeReady(100);
    const now = Number.isFinite(options?.now)
      ? options.now
      : (isReady ? getCloudWriteTimestamp() : Date.now());

    const current = mockCloudDatabases[uid] || null;
    const reduced = reduceCloudProgress(current, op, { ...options, now });
    if (reduced === current) {
      return { committed: true, snapshot: current };
    }

    // Simulate serverTimestamp() resolution at transaction boundary
    const uniqueClaims = { ...(reduced.uniqueClaims || {}) };
    const currentClaims = current?.uniqueClaims || {};
    for (const [claimId, claimData] of Object.entries(uniqueClaims)) {
      if (!currentClaims[claimId]) {
        uniqueClaims[claimId] = {
          ...claimData,
          claimedAt: Number.isFinite(options?.now) ? options.now : (isReady ? getCloudWriteTimestamp() : Date.now())
        };
      }
    }

    const next = {
      ...reduced,
      updatedAt: Number.isFinite(options?.now) ? options.now : (isReady ? getCloudWriteTimestamp() : Date.now()),
      uniqueClaims
    };
    mockCloudDatabases[uid] = next;

    return {
      committed: true,
      snapshot: next
    };
  }),
  getCloudProgress: jest.fn(async (uid) => mockCloudDatabases[uid] || null),
  bootstrapCloudProgress: jest.fn(async (uid, localSnapshot, options = {}) => {
    const { reconcileLegacyWithCloud } = require('../src/domain/sync/cloudBootstrap');
    const { whenServerTimeReady, getCloudWriteTimestamp } = require('../src/services/firebase/serverTimeService');
    const isReady = await whenServerTimeReady(100);
    const now = Number.isFinite(options?.now)
      ? options.now
      : (isReady ? getCloudWriteTimestamp() : Date.now());

    const current = mockCloudDatabases[uid] || null;
    if (current === null) {
      const seeded = {
        ...localSnapshot,
        schemaVersion: 1,
        revision: Math.max(1, localSnapshot?.revision || 1),
        updatedAt: now
      };
      mockCloudDatabases[uid] = seeded;
      return { committed: true, snapshot: seeded };
    }
    const reconciled = reconcileLegacyWithCloud(localSnapshot, current, { ...options, now });
    mockCloudDatabases[uid] = reconciled;
    return { committed: true, snapshot: reconciled };
  })
}));

describe('Cloud Sync Clock-Skew & Timestamp Final Regression Suite (Section 12)', () => {
  const TEST_UID = 'TestClockSkewUser';
  const TEST_IDENTITY = `uid:${TEST_UID}`;

  beforeEach(async () => {
    mockStore = {};
    mockCloudDatabases = {};
    mockNetworkOnline = true;
    mockCloudFailure = null;
    _resetLiveSyncStateForTests();
    __resetServerTimeForTest();
  });

  // 1. Device clock matches server
  test('1. Device clock matches server (offset = 0) -> safe timestamp matches Date.now()', () => {
    __setServerTimeOffsetForTest(0, true);
    const now = Date.now();
    const safe = getSafeServerNow();
    expect(Math.abs(safe - now)).toBeLessThan(50);
  });

  // 2. Device +2 sec
  test('2. Device clock +2 sec ahead (offset = -2000) -> safe timestamp is pulled back by 2s', () => {
    __setServerTimeOffsetForTest(-2000, true);
    const wallNow = Date.now();
    const safe = getSafeServerNow();
    expect(safe).toBeLessThanOrEqual(wallNow - 1950);
    expect(safe).toBeGreaterThanOrEqual(wallNow - 2050);
  });

  // 3. Device +30 sec
  test('3. Device clock +30 sec ahead (offset = -30000) -> safe timestamp is pulled back by 30s', () => {
    __setServerTimeOffsetForTest(-30000, true);
    const wallNow = Date.now();
    const safe = getSafeServerNow();
    expect(safe).toBeLessThanOrEqual(wallNow - 29950);
    expect(safe).toBeGreaterThanOrEqual(wallNow - 30050);
  });

  // 4. Device behind server
  test('4. Device clock behind server (offset = +5000) -> safe timestamp advances to server time', () => {
    __setServerTimeOffsetForTest(5000, true);
    const wallNow = Date.now();
    const safe = getSafeServerNow();
    expect(safe).toBeGreaterThanOrEqual(wallNow + 4950);
  });

  // 5. Offset estimate slightly too high (+50ms)
  test('5. Offset estimate slightly too high (+50ms) -> getCloudWriteTimestamp absorbs error and stays strictly <= true server now', () => {
    // True server time is T. Device clock is T. True offset is 0.
    // Flawed estimate is +50ms (thinking server is ahead).
    const estimatedOffset = 50;
    __setServerTimeOffsetForTest(estimatedOffset, true);
    const trueServerNow = Date.now();
    const writeTimestamp = getCloudWriteTimestamp();
    // With 1000ms safety margin, writeTimestamp = trueServerNow + 50 - 1000 = trueServerNow - 950 <= trueServerNow
    expect(writeTimestamp).toBeLessThan(trueServerNow);
    expect(trueServerNow - writeTimestamp).toBeGreaterThanOrEqual(900);
  });

  // 6. Offset estimate +250ms
  test('6. Offset estimate +250ms -> getCloudWriteTimestamp absorbs error and stays strictly <= true server now', () => {
    const estimatedOffset = 250;
    __setServerTimeOffsetForTest(estimatedOffset, true);
    const trueServerNow = Date.now();
    const writeTimestamp = getCloudWriteTimestamp();
    // writeTimestamp = trueServerNow + 250 - 1000 = trueServerNow - 750 <= trueServerNow
    expect(writeTimestamp).toBeLessThan(trueServerNow);
    expect(trueServerNow - writeTimestamp).toBeGreaterThanOrEqual(700);
  });

  // 7. Offset estimate +1000ms
  test('7. Offset estimate +1000ms -> getCloudWriteTimestamp absorbs error and satisfies <= true server now', () => {
    const estimatedOffset = 1000;
    __setServerTimeOffsetForTest(estimatedOffset, true);
    const trueServerNow = Date.now();
    const writeTimestamp = getCloudWriteTimestamp();
    // writeTimestamp = trueServerNow + 1000 - 1000 = trueServerNow <= trueServerNow
    expect(writeTimestamp).toBeLessThanOrEqual(trueServerNow);
  });

  // 8. Server time not ready
  test('8. Server time not ready -> Cloud Sync defers without performing unsafe write', async () => {
    __setServerTimeOffsetForTest(0, false);
    expect(isServerTimeReadyState()).toBe(false);

    setCloudSyncReady(TEST_IDENTITY, true);

    const deviceId = await getDeviceId();
    await createAndPersistSyncOp({
      identity: TEST_IDENTITY,
      deviceId,
      repeatableXpDelta: 50
    });

    const res = await flushLiveProgress(TEST_IDENTITY);
    expect(res.status).toBe('offline');
    expect(res.reason).toBe('SERVER_TIME_NOT_READY');
    expect(getSyncStatus()).toBe(SYNC_STATUS.OFFLINE);
    expect(mockCloudDatabases[TEST_UID]).toBeUndefined();
  });

  // 9. Reconnect
  test('9. Reconnect -> updates offset and safe timestamp continues to work seamlessly', () => {
    __setServerTimeOffsetForTest(-1000, true);
    expect(getServerTimeOffset()).toBe(-1000);

    // Reconnect arrives with updated offset
    __setServerTimeOffsetForTest(-2500, true);
    expect(getServerTimeOffset()).toBe(-2500);

    const wallNow = Date.now();
    expect(getSafeServerNow()).toBeLessThanOrEqual(wallNow - 2450);
  });

  // 10. Existing pending op recovery
  test('10. Existing pending op recovery -> recovers after previous failure without data loss or duplicates', async () => {
    setCloudSyncReady(TEST_IDENTITY, true);
    const deviceId = 'device-real-phone-001';

    const initialPlayer = {
      totalXp: 1500,
      stats: { bestCombo: 5 },
      daily: { lastActiveDate: '2026-11-01', missions: { m1: { claimed: true, progress: 1 } } }
    };
    const initialCampaign = {
      clearedStages: ['L1-S1', 'L1-S2'],
      stageStars: { 'L1-S1': 3, 'L1-S2': 3 },
      stageScores: { 'L1-S1': 800, 'L1-S2': 850 },
      bestCombo: 5
    };
    await saveScopedPlayerProgress(TEST_IDENTITY, initialPlayer);
    await saveScopedCampaignProgress(TEST_IDENTITY, initialCampaign);

    mockCloudDatabases[TEST_UID] = {
      schemaVersion: 1,
      revision: 187,
      updatedAt: Date.now() - 60000,
      appliedOps: {},
      progression: { totalXp: 1400 },
      campaign: {
        clearedStages: { 'L1-S1': true },
        stageStars: { 'L1-S1': 3 },
        stageScores: { 'L1-S1': 800 },
        bestCombo: 5
      },
      uniqueClaims: {
        'firstClear:L1-S1': { claimedAt: Date.now() - 100000, deviceId: 'bootstrap' }
      }
    };

    const op = await createAndPersistSyncOp({
      identity: TEST_IDENTITY,
      deviceId,
      repeatableXpDelta: 0,
      uniqueClaims: [{ claimId: 'firstClear:L1-S2', xpReward: 20 }],
      campaignProgress: {
        clearedStages: ['L1-S1', 'L1-S2'],
        stageStars: { 'L1-S1': 3, 'L1-S2': 3 },
        stageScores: { 'L1-S1': 800, 'L1-S2': 850 },
        bestCombo: 5
      }
    });
    expect(op.opId).toBe(`${deviceId}:1`);

    // Simulate previous permission_denied failure
    mockCloudFailure = new Error('Client doesn\'t have permission to access the desired data. (permission_denied)');
    mockCloudFailure.code = 'PERMISSION_DENIED';

    const failRes = await flushLiveProgress(TEST_IDENTITY);
    expect(failRes.status).toBe('error');
    expect(getSyncStatus()).toBe(SYNC_STATUS.ERROR);

    // Pending op remains preserved
    const pendingAfterFail = await getPendingSyncOp(TEST_IDENTITY);
    expect(pendingAfterFail).not.toBeNull();
    expect(pendingAfterFail.opId).toBe(`${deviceId}:1`);

    // Recovery run
    mockCloudFailure = null;
    __setServerTimeOffsetForTest(-2500, true);

    const retryRes = await flushLiveProgress(TEST_IDENTITY);
    expect(retryRes.status).toBe('synced');
    expect(getSyncStatus()).toBe(SYNC_STATUS.SYNCED);

    const pendingAfterRetry = await getPendingSyncOp(TEST_IDENTITY);
    expect(pendingAfterRetry).toBeNull();

    const cloudState = mockCloudDatabases[TEST_UID];
    expect(cloudState.revision).toBe(188);
    expect(cloudState.appliedOps[deviceId]).toBe(1);
    expect(cloudState.progression.totalXp).toBe(1420);
  });

  // 11. First-clear claim
  test('11. First-clear claim -> granted canonically and timestamp recorded correctly', async () => {
    setCloudSyncReady(TEST_IDENTITY, true);
    const deviceId = 'test-device-fc';
    __setServerTimeOffsetForTest(-1000, true);

    mockCloudDatabases[TEST_UID] = {
      schemaVersion: 1,
      revision: 10,
      updatedAt: Date.now() - 5000,
      appliedOps: {},
      progression: { totalXp: 100 },
      campaign: { clearedStages: {} },
      uniqueClaims: {}
    };

    await createAndPersistSyncOp({
      identity: TEST_IDENTITY,
      deviceId,
      repeatableXpDelta: 10,
      uniqueClaims: [{ claimId: 'firstClear:L1-S1', xpReward: 20 }]
    });

    const res = await flushLiveProgress(TEST_IDENTITY);
    expect(res.status).toBe('synced');

    const state = mockCloudDatabases[TEST_UID];
    expect(state.uniqueClaims['firstClear:L1-S1']).toBeDefined();
    expect(state.uniqueClaims['firstClear:L1-S1'].deviceId).toBe(deviceId);
    expect(typeof state.uniqueClaims['firstClear:L1-S1'].claimedAt).toBe('number');
    // Total XP = 100 base + 10 repeatable + 20 canonical firstClear = 130
    expect(state.progression.totalXp).toBe(130);
  });

  // 12. Daily claim
  test('12. Daily claim -> recorded with today key and deviceId', async () => {
    setCloudSyncReady(TEST_IDENTITY, true);
    const deviceId = 'test-device-daily';
    __setServerTimeOffsetForTest(-500, true);

    mockCloudDatabases[TEST_UID] = {
      schemaVersion: 1,
      revision: 20,
      updatedAt: Date.now() - 5000,
      appliedOps: {},
      progression: { totalXp: 200 },
      campaign: {},
      uniqueClaims: {}
    };

    const dailyClaimId = 'daily:2026-11-01:m1';
    await createAndPersistSyncOp({
      identity: TEST_IDENTITY,
      deviceId,
      repeatableXpDelta: 0,
      uniqueClaims: [{ claimId: dailyClaimId, xpReward: 30 }]
    });

    const res = await flushLiveProgress(TEST_IDENTITY);
    expect(res.status).toBe('synced');

    const state = mockCloudDatabases[TEST_UID];
    expect(state.uniqueClaims[dailyClaimId]).toBeDefined();
    expect(state.uniqueClaims[dailyClaimId].deviceId).toBe(deviceId);
    expect(typeof state.uniqueClaims[dailyClaimId].claimedAt).toBe('number');
    expect(state.progression.totalXp).toBe(230);
  });

  // 13. Duplicate claim ignored
  test('13. Duplicate claim ignored -> second claim attempt yields zero additional XP and preserves original claim', async () => {
    setCloudSyncReady(TEST_IDENTITY, true);
    const deviceId = 'test-device-dup';
    __setServerTimeOffsetForTest(0, true);

    const originalClaimedAt = 1700000000000;
    mockCloudDatabases[TEST_UID] = {
      schemaVersion: 1,
      revision: 30,
      updatedAt: Date.now() - 5000,
      appliedOps: { 'other-device': 1 },
      progression: { totalXp: 300 },
      campaign: {},
      uniqueClaims: {
        'firstClear:L1-S1': { claimedAt: originalClaimedAt, deviceId: 'original-device' }
      }
    };

    // Staging a new operation (seq 1 from this device) attempting the already-claimed firstClear:L1-S1
    await createAndPersistSyncOp({
      identity: TEST_IDENTITY,
      deviceId,
      repeatableXpDelta: 25,
      uniqueClaims: [{ claimId: 'firstClear:L1-S1', xpReward: 20 }]
    });

    const res = await flushLiveProgress(TEST_IDENTITY);
    expect(res.status).toBe('synced');

    const state = mockCloudDatabases[TEST_UID];
    // XP should only increase by repeatable delta (25), not the duplicate unique claim (20)
    expect(state.progression.totalXp).toBe(325);
    // Original claim remains untouched
    expect(state.uniqueClaims['firstClear:L1-S1'].claimedAt).toBe(originalClaimedAt);
    expect(state.uniqueClaims['firstClear:L1-S1'].deviceId).toBe('original-device');
  });

  // 14. permission_denied -> ERROR
  test('14. permission_denied -> sets SYNC_STATUS.ERROR (not OFFLINE)', async () => {
    setCloudSyncReady(TEST_IDENTITY, true);
    const deviceId = await getDeviceId();
    await createAndPersistSyncOp({
      identity: TEST_IDENTITY,
      deviceId,
      repeatableXpDelta: 10
    });

    mockCloudFailure = { code: 'PERMISSION_DENIED', message: 'permission_denied' };

    const res = await flushLiveProgress(TEST_IDENTITY);
    expect(res.status).toBe('error');
    expect(getSyncStatus()).toBe(SYNC_STATUS.ERROR);
  });

  // 15. network disconnect -> OFFLINE
  test('15. network disconnect -> sets SYNC_STATUS.OFFLINE', async () => {
    setCloudSyncReady(TEST_IDENTITY, true);
    const deviceId = await getDeviceId();
    await createAndPersistSyncOp({
      identity: TEST_IDENTITY,
      deviceId,
      repeatableXpDelta: 10
    });

    mockNetworkOnline = false;

    const res = await flushLiveProgress(TEST_IDENTITY);
    expect(res.status).toBe('offline');
    expect(getSyncStatus()).toBe(SYNC_STATUS.OFFLINE);
  });
});
