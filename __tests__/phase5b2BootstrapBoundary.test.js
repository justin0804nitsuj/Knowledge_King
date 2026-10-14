import AsyncStorage from '@react-native-async-storage/async-storage';
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
  addStagedRepeatableXp,
  addStagedUniqueClaim,
  addStagedCampaignProgress
} from '../src/storage/unsyncedProgressStorage';
import {
  getPendingSyncOp,
  clearPendingSyncOp,
  createPendingSyncOpFromStaged
} from '../src/storage/syncOutboxStorage';
import {
  flushLiveProgress,
  isCloudSyncReady,
  setCloudSyncReady,
  _resetLiveSyncStateForTests
} from '../src/services/sync/liveProgressSync';
import {
  coordinateAccountProgress,
  extractHistoricalProgress
} from '../src/services/sync/accountProgressCoordinator';
import {
  buildBootstrapSnapshot
} from '../src/domain/sync/cloudBootstrap';
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
const bootstrapCallSnapshots = [];
const appliedOps = [];

jest.mock('../src/services/sync/cloudProgressService', () => {
  const { reduceCloudProgress } = require('../src/domain/sync/cloudProgressReducer');
  const { reconcileLegacyWithCloud } = require('../src/domain/sync/cloudBootstrap');

  return {
    getCloudProgress: jest.fn(async (uid) => {
      if (!mockNetworkOnline) {
        throw new Error('Network offline');
      }
      return mockCloudDatabases[uid] ? JSON.parse(JSON.stringify(mockCloudDatabases[uid])) : null;
    }),

    bootstrapCloudProgress: jest.fn(async (uid, localSnapshot) => {
      if (!mockNetworkOnline) {
        throw new Error('Network offline during bootstrap');
      }
      bootstrapCallSnapshots.push(JSON.parse(JSON.stringify(localSnapshot)));

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
      if (!mockNetworkOnline) {
        throw new Error('Network offline during applySyncOp');
      }
      appliedOps.push(JSON.parse(JSON.stringify(op)));

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

describe('Phase 5B.2 — Bootstrap Boundary Correctness', () => {
  const TEST_UID = 'User5B2';
  const TEST_IDENTITY = `uid:${TEST_UID}`;
  const TODAY = '2026-10-15';

  beforeEach(async () => {
    mockStore = {};
    mockCloudDatabases = {};
    mockNetworkOnline = true;
    bootstrapCallSnapshots.length = 0;
    appliedOps.length = 0;
    _resetCachedDeviceIdForTests();
    _resetLiveSyncStateForTests();
    await setActiveIdentity(TEST_IDENTITY);
  });

  // A, B, C: Historical 1250 XP + offline First Clear L2-S3 +20
  test('A, B, C: offline new First Clear is NOT pre-seeded into bootstrap; pre-existing cleared stage IS seeded; final cloud reaches exact 1270', async () => {
    // Historical state: L1-S1 cleared, totalXp 1250
    const localPlayer = { ...createDefaultPlayerProgress(), totalXp: 1250 };
    const localCampaign = {
      schemaVersion: 1,
      clearedStages: ['L1-S1'],
      stageStars: { 'L1-S1': 3 },
      stageScores: { 'L1-S1': 500 },
      bestCombo: 5
    };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);
    await saveScopedCampaignProgress(TEST_IDENTITY, localCampaign);

    // Player goes offline and clears L2-S3 for the first time (+20 firstClear XP)
    const updatedPlayer = { ...localPlayer, totalXp: 1270 };
    const updatedCampaign = {
      ...localCampaign,
      clearedStages: ['L1-S1', 'L2-S3'],
      stageStars: { 'L1-S1': 3, 'L2-S3': 3 },
      stageScores: { 'L1-S1': 500, 'L2-S3': 900 },
      bestCombo: 8
    };
    await saveScopedPlayerProgress(TEST_IDENTITY, updatedPlayer);
    await saveScopedCampaignProgress(TEST_IDENTITY, updatedCampaign);

    // Staged in unsyncedProgress
    await addStagedUniqueClaim(TEST_IDENTITY, {
      claimId: 'firstClear:L2-S3',
      xpReward: 20
    });
    await addStagedCampaignProgress(TEST_IDENTITY, {
      clearedStages: ['L2-S3'],
      stageStars: { 'L2-S3': 3 },
      stageScores: { 'L2-S3': 900 },
      bestCombo: 8
    });

    // Network returns -> coordinator runs
    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(true);

    // B: Verify bootstrap did NOT pre-seed firstClear:L2-S3
    expect(bootstrapCallSnapshots.length).toBe(1);
    const bootstrapSnapshot = bootstrapCallSnapshots[0];
    expect(bootstrapSnapshot.progression.totalXp).toBe(1250);
    expect(bootstrapSnapshot.uniqueClaims['firstClear:L2-S3']).toBeUndefined();
    expect(bootstrapSnapshot.campaign.clearedStages['L2-S3']).toBeUndefined();

    // C: Verify pre-existing historical stage L1-S1 IS seeded as firstClear marker
    expect(bootstrapSnapshot.uniqueClaims['firstClear:L1-S1']).toBeDefined();
    expect(bootstrapSnapshot.campaign.clearedStages['L1-S1']).toBe(true);

    // Flush live progress
    const flushRes = await flushLiveProgress(TEST_IDENTITY);
    expect(flushRes.status).toBe('synced');

    // A: Final cloud result must be exactly 1270 (1250 historical + 20 first clear)
    const finalCloud = mockCloudDatabases[TEST_UID];
    expect(finalCloud.progression.totalXp).toBe(1270);
    expect(finalCloud.uniqueClaims['firstClear:L1-S1']).toBeDefined();
    expect(finalCloud.uniqueClaims['firstClear:L2-S3']).toBeDefined();
    expect(finalCloud.campaign.clearedStages['L2-S3']).toBe(true);
  });

  // D, E, F: Historical daily claim vs newly staged daily claim
  test('D, E, F: bootstrap does NOT pre-seed staged Daily claim, seeds pre-existing Daily claim, and awards canonical Daily XP once in final cloud', async () => {
    // Historical state: daily mission m2 was claimed earlier today (+40 XP), totalXp 1250
    const localPlayer = {
      ...createDefaultPlayerProgress(),
      totalXp: 1250,
      daily: {
        lastActiveDate: TODAY,
        missions: {
          m1: { progress: 0, claimed: false },
          m2: { progress: 2, claimed: true },
          m3: { progress: 0, claimed: false }
        }
      }
    };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);

    // Player goes offline and completes daily mission m1 (+30 XP)
    const updatedPlayer = {
      ...localPlayer,
      totalXp: 1280,
      daily: {
        lastActiveDate: TODAY,
        missions: {
          m1: { progress: 20, claimed: true },
          m2: { progress: 2, claimed: true },
          m3: { progress: 0, claimed: false }
        }
      }
    };
    await saveScopedPlayerProgress(TEST_IDENTITY, updatedPlayer);

    // Staged in unsyncedProgress
    await addStagedUniqueClaim(TEST_IDENTITY, {
      claimId: `daily:${TODAY}:m1`,
      xpReward: 30
    });

    // Network returns -> coordinator runs
    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(true);

    const bootstrapSnapshot = bootstrapCallSnapshots[0];
    expect(bootstrapSnapshot.progression.totalXp).toBe(1250);

    // E: Staged Daily m1 is NOT pre-seeded into bootstrap
    expect(bootstrapSnapshot.uniqueClaims[`daily:${TODAY}:m1`]).toBeUndefined();

    // F: Historical Daily m2 (claimed before this session, not in unsynced) IS seeded
    expect(bootstrapSnapshot.uniqueClaims[`daily:${TODAY}:m2`]).toBeDefined();

    // Flush live progress
    const flushRes = await flushLiveProgress(TEST_IDENTITY);
    expect(flushRes.status).toBe('synced');

    // D: Final cloud totalXp includes +30 exactly once -> 1280
    const finalCloud = mockCloudDatabases[TEST_UID];
    expect(finalCloud.progression.totalXp).toBe(1280);
    expect(finalCloud.uniqueClaims[`daily:${TODAY}:m1`]).toBeDefined();
    expect(finalCloud.uniqueClaims[`daily:${TODAY}:m2`]).toBeDefined();
  });

  // G: Offline new cleared stage / stars / score / bestCombo is not lost and is merged by live op
  test('G. offline new cleared stage / stars / score / bestCombo is not lost and is merged by live op', async () => {
    const localCampaign = {
      schemaVersion: 1,
      clearedStages: ['L1-S1'],
      stageStars: { 'L1-S1': 2 },
      stageScores: { 'L1-S1': 300 },
      bestCombo: 5
    };
    await saveScopedCampaignProgress(TEST_IDENTITY, localCampaign);

    // Staged offline play: cleared L2-S3 with 3 stars, 900 score, maxCombo 12
    const updatedCampaign = {
      schemaVersion: 1,
      clearedStages: ['L1-S1', 'L2-S3'],
      stageStars: { 'L1-S1': 2, 'L2-S3': 3 },
      stageScores: { 'L1-S1': 300, 'L2-S3': 900 },
      bestCombo: 12
    };
    await saveScopedCampaignProgress(TEST_IDENTITY, updatedCampaign);

    await addStagedUniqueClaim(TEST_IDENTITY, {
      claimId: 'firstClear:L2-S3',
      xpReward: 20
    });
    await addStagedCampaignProgress(TEST_IDENTITY, {
      clearedStages: ['L2-S3'],
      stageStars: { 'L2-S3': 3 },
      stageScores: { 'L2-S3': 900 },
      bestCombo: 12
    });

    // Reconnect & coordinate
    await coordinateAccountProgress({ uid: TEST_UID });
    const bootstrapSnapshot = bootstrapCallSnapshots[0];

    // Bootstrap historical snapshot does not pre-consume the new stage's stars, scores, or new bestCombo
    expect(bootstrapSnapshot.campaign.clearedStages['L2-S3']).toBeUndefined();
    expect(bootstrapSnapshot.campaign.stageStars['L2-S3']).toBeUndefined();
    expect(bootstrapSnapshot.campaign.stageScores['L2-S3']).toBeUndefined();
    expect(bootstrapSnapshot.campaign.bestCombo).toBeLessThanOrEqual(5);

    // Live flush applies the operation
    await flushLiveProgress(TEST_IDENTITY);

    // Live op merged all fields cleanly into cloud
    const finalCloud = mockCloudDatabases[TEST_UID];
    expect(finalCloud.campaign.clearedStages['L2-S3']).toBe(true);
    expect(finalCloud.campaign.stageStars['L2-S3']).toBe(3);
    expect(finalCloud.campaign.stageScores['L2-S3']).toBe(900);
    expect(finalCloud.campaign.bestCombo).toBe(12);
  });

  // H: Mixed case: historical XP 1250 + 30 repeatable + 20 firstClear + 30 daily -> final cloud = 1330
  test('H. mixed case: historical XP 1250 + 30 repeatable + 20 firstClear + 30 daily -> final cloud = 1330 exactly once', async () => {
    // Historical state: L1-S1 cleared, totalXp 1250
    const localPlayer = {
      ...createDefaultPlayerProgress(),
      totalXp: 1250,
      daily: {
        lastActiveDate: TODAY,
        missions: {
          m1: { progress: 0, claimed: false },
          m2: { progress: 0, claimed: false },
          m3: { progress: 0, claimed: false }
        }
      }
    };
    const localCampaign = {
      schemaVersion: 1,
      clearedStages: ['L1-S1'],
      stageStars: { 'L1-S1': 3 },
      stageScores: { 'L1-S1': 600 },
      bestCombo: 6
    };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);
    await saveScopedCampaignProgress(TEST_IDENTITY, localCampaign);

    // Offline session:
    // +30 repeatable battle XP
    // +20 firstClear L2-S3
    // +30 daily mission m1
    // Total earned = 80 XP -> local totalXp = 1330
    const updatedPlayer = {
      ...localPlayer,
      totalXp: 1330,
      daily: {
        lastActiveDate: TODAY,
        missions: {
          m1: { progress: 20, claimed: true },
          m2: { progress: 0, claimed: false },
          m3: { progress: 0, claimed: false }
        }
      }
    };
    const updatedCampaign = {
      ...localCampaign,
      clearedStages: ['L1-S1', 'L2-S3'],
      stageStars: { 'L1-S1': 3, 'L2-S3': 3 },
      stageScores: { 'L1-S1': 600, 'L2-S3': 950 },
      bestCombo: 10
    };
    await saveScopedPlayerProgress(TEST_IDENTITY, updatedPlayer);
    await saveScopedCampaignProgress(TEST_IDENTITY, updatedCampaign);

    // Stage in unsyncedProgress
    await addStagedRepeatableXp(TEST_IDENTITY, 30);
    await addStagedUniqueClaim(TEST_IDENTITY, {
      claimId: 'firstClear:L2-S3',
      xpReward: 20
    });
    await addStagedUniqueClaim(TEST_IDENTITY, {
      claimId: `daily:${TODAY}:m1`,
      xpReward: 30
    });
    await addStagedCampaignProgress(TEST_IDENTITY, {
      clearedStages: ['L2-S3'],
      stageStars: { 'L2-S3': 3 },
      stageScores: { 'L2-S3': 950 },
      bestCombo: 10
    });

    // Reconnect & coordinate
    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(true);

    // Bootstrap historical snapshot has exact 1250 XP
    const bootstrapSnapshot = bootstrapCallSnapshots[0];
    expect(bootstrapSnapshot.progression.totalXp).toBe(1250);
    expect(bootstrapSnapshot.uniqueClaims['firstClear:L2-S3']).toBeUndefined();
    expect(bootstrapSnapshot.uniqueClaims[`daily:${TODAY}:m1`]).toBeUndefined();
    expect(bootstrapSnapshot.uniqueClaims['firstClear:L1-S1']).toBeDefined();

    // Flush live op
    const flushRes = await flushLiveProgress(TEST_IDENTITY);
    expect(flushRes.status).toBe('synced');

    // Final cloud must represent exactly 1330 XP
    const finalCloud = mockCloudDatabases[TEST_UID];
    expect(finalCloud.progression.totalXp).toBe(1330);
    expect(finalCloud.uniqueClaims['firstClear:L1-S1']).toBeDefined();
    expect(finalCloud.uniqueClaims['firstClear:L2-S3']).toBeDefined();
    expect(finalCloud.uniqueClaims[`daily:${TODAY}:m1`]).toBeDefined();
    expect(finalCloud.campaign.clearedStages['L2-S3']).toBe(true);

    // Local player progress matches cloud
    const finalLocal = await loadScopedPlayerProgress(TEST_IDENTITY);
    expect(finalLocal.totalXp).toBe(1330);
  });

  // I: App restart while still pre-bootstrap preserves the same boundary
  test('I. app restart while still pre-bootstrap preserves the same boundary across crashes', async () => {
    // 1. Initial historical state: totalXp 1250
    const localPlayer = { ...createDefaultPlayerProgress(), totalXp: 1250 };
    await saveScopedPlayerProgress(TEST_IDENTITY, localPlayer);

    // 2. Offline gameplay 1: clears L2-S1 (+20 first clear, +10 repeatable = 30)
    await saveScopedPlayerProgress(TEST_IDENTITY, { ...localPlayer, totalXp: 1280 });
    await addStagedRepeatableXp(TEST_IDENTITY, 10);
    await addStagedUniqueClaim(TEST_IDENTITY, { claimId: 'firstClear:L2-S1', xpReward: 20 });
    await addStagedCampaignProgress(TEST_IDENTITY, { clearedStages: ['L2-S1'] });

    // 3. App is killed and restarted still offline
    _resetLiveSyncStateForTests();
    expect(isCloudSyncReady(TEST_IDENTITY)).toBe(false);

    // 4. Offline gameplay 2: clears L2-S2 (+20 first clear, +10 repeatable = 30)
    await saveScopedPlayerProgress(TEST_IDENTITY, { ...localPlayer, totalXp: 1310 });
    await addStagedRepeatableXp(TEST_IDENTITY, 10);
    await addStagedUniqueClaim(TEST_IDENTITY, { claimId: 'firstClear:L2-S2', xpReward: 20 });
    await addStagedCampaignProgress(TEST_IDENTITY, { clearedStages: ['L2-S2'] });

    // 5. Network returns -> coordinate
    const coordRes = await coordinateAccountProgress({ uid: TEST_UID });
    expect(coordRes.cloudSyncSuccess).toBe(true);

    const bootstrapSnapshot = bootstrapCallSnapshots[0];
    // Historical bootstrap must be 1250 XP
    expect(bootstrapSnapshot.progression.totalXp).toBe(1250);
    // Neither L2-S1 nor L2-S2 pre-seeded into bootstrap
    expect(bootstrapSnapshot.uniqueClaims['firstClear:L2-S1']).toBeUndefined();
    expect(bootstrapSnapshot.uniqueClaims['firstClear:L2-S2']).toBeUndefined();

    // 6. Flush live progress
    const flushRes = await flushLiveProgress(TEST_IDENTITY);
    expect(flushRes.status).toBe('synced');

    // Final cloud reaches exact 1310 with both firstClear claims credited
    const finalCloud = mockCloudDatabases[TEST_UID];
    expect(finalCloud.progression.totalXp).toBe(1310);
    expect(finalCloud.uniqueClaims['firstClear:L2-S1']).toBeDefined();
    expect(finalCloud.uniqueClaims['firstClear:L2-S2']).toBeDefined();
    expect(finalCloud.campaign.clearedStages['L2-S1']).toBe(true);
    expect(finalCloud.campaign.clearedStages['L2-S2']).toBe(true);
  });
});
