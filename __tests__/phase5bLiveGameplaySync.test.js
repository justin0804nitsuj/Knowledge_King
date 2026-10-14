import AsyncStorage from '@react-native-async-storage/async-storage';
import { processBattleResult } from '../src/domain/game/resultProcessor';
import { processReviewAnswer } from '../src/domain/game/reviewProcessor';
import { BATTLE_STATES } from '../src/domain/game/battleEngine';
import { XP_REWARDS } from '../src/domain/player/xpRewards';
import { getLocalDailyKey } from '../src/domain/player/dailySystem';
import { getStageById } from '../src/domain/adventure/campaignConfig';
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
  _resetLiveSyncStateForTests,
  setCloudSyncReady
} from '../src/services/sync/liveProgressSync';
import {
  applySyncOperation
} from '../src/services/sync/cloudProgressService';
import {
  loadScopedPlayerProgress,
  loadScopedCampaignProgress,
  saveScopedPlayerProgress,
  saveScopedCampaignProgress,
  getLastSyncedSnapshot
} from '../src/services/sync/cloudRestoreAdapter';
import { createDefaultPlayerProgress } from '../src/storage/playerProgressStorage';

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
  applySyncOperation: jest.fn(async (uid, op) => {
    if (!mockNetworkOnline) {
      throw new Error('Network offline');
    }
    if (mockCloudFailure) {
      throw mockCloudFailure;
    }

    const { reduceCloudProgress } = require('../src/domain/sync/cloudProgressReducer');
    const current = mockCloudDatabases[uid] || null;
    const next = reduceCloudProgress(current, op);
    mockCloudDatabases[uid] = next;

    return {
      committed: true,
      snapshot: next
    };
  }),
  getCloudProgress: jest.fn(async (uid) => mockCloudDatabases[uid] || null)
}));

describe('Phase 5B — Live Gameplay Sync Integration', () => {
  const TEST_UID = 'UserPhase5B';
  const TEST_IDENTITY = `uid:${TEST_UID}`;

  beforeEach(async () => {
    mockStore = {};
    mockCloudDatabases = {};
    mockNetworkOnline = true;
    mockCloudFailure = null;
    _resetLiveSyncStateForTests();
    _resetCachedDeviceIdForTests();
    await setActiveIdentity(TEST_IDENTITY);
    setCloudSyncReady(TEST_IDENTITY, true);
  });

  describe('1. Battle Result Sync Classification & Staging', () => {
    test('repeatable battle XP staged separately from First Clear unique claim', async () => {
      // Keep offline so staged data stays in unsynced accumulator for assertion
      mockNetworkOnline = false;

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

      const stage = getStageById('L1-S1');
      const expectedRepeatableXp = (4 * XP_REWARDS.CORRECT_ANSWER)
        + XP_REWARDS.VICTORY[stage.type]
        + XP_REWARDS.PERFECT_VICTORY; // 40 + 20 + 20 = 80
      const expectedFirstClearXp = XP_REWARDS.FIRST_CLEAR[stage.type]; // 20

      // Battle 1 on uncleared stage
      const result = await processBattleResult('battle_first_clear', finalState, 'L1-S1');
      expect(result.isFirstClear).toBe(true);

      // Check unsynced accumulator
      const unsynced = await getUnsyncedProgress(TEST_IDENTITY);

      // Repeatable XP MUST equal exact repeatable earnings (excluding first clear XP)
      expect(unsynced.repeatableXpDelta).toBe(expectedRepeatableXp);

      // First-Clear MUST be staged as unique claim
      const claim = unsynced.uniqueClaims['firstClear:L1-S1'];
      expect(claim).toBeDefined();
      expect(claim.claimId).toBe('firstClear:L1-S1');
      expect(claim.xpReward).toBe(expectedFirstClearXp);

      // Campaign progress staged
      expect(unsynced.campaignProgress.clearedStages['L1-S1']).toBe(true);
      expect(unsynced.campaignProgress.stageStars['L1-S1']).toBe(3);
      expect(unsynced.campaignProgress.stageScores['L1-S1']).toBe(100);
      expect(unsynced.campaignProgress.bestCombo).toBe(4);
    });

    test('replaying a cleared stage stages repeatable XP but NO first-clear claim', async () => {
      mockNetworkOnline = false;

      const finalState = {
        status: BATTLE_STATES.VICTORY,
        correctCount: 3,
        wrongCount: 1,
        timeoutCount: 0,
        questionNumber: 4,
        maxCombo: 3,
        score: 75,
        correctTargetIds: [],
        wrongTargetIds: ['w1'],
        timeoutTargetIds: []
      };

      // First clear
      await processBattleResult('battle_1', finalState, 'L1-S1');
      await clearUnsyncedProgress(TEST_IDENTITY);

      // Replay same stage
      const finalState2 = { ...finalState, wrongCount: 0, maxCombo: 4, score: 90 };
      const res2 = await processBattleResult('battle_replay', finalState2, 'L1-S1');
      expect(res2.isFirstClear).toBe(false);

      const unsynced = await getUnsyncedProgress(TEST_IDENTITY);
      // Repeatable XP is staged
      expect(unsynced.repeatableXpDelta).toBeGreaterThan(0);
      // First clear claim NOT staged
      expect(unsynced.uniqueClaims['firstClear:L1-S1']).toBeUndefined();
    });

    test('duplicate BattleResult event does not double-stage sync data (idempotency)', async () => {
      mockNetworkOnline = false;

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

      await processBattleResult('battle_dup_check', finalState, 'L1-S1');
      await new Promise((resolve) => setTimeout(resolve, 25));
      const pending1 = await getPendingSyncOp(TEST_IDENTITY);
      expect(pending1).toBeDefined();
      const opId1 = pending1.opId;
      const xp1 = pending1.repeatableXpDelta;

      // Call same battle again
      await processBattleResult('battle_dup_check', finalState, 'L1-S1');
      await new Promise((resolve) => setTimeout(resolve, 25));
      const pending2 = await getPendingSyncOp(TEST_IDENTITY);

      // Exact same op remains, no duplicate sequence or duplicate XP
      expect(pending2.opId).toBe(opId1);
      expect(pending2.repeatableXpDelta).toBe(xp1);
    });
  });

  describe('2. Daily Reward Integration', () => {
    test('daily mission completion stages deterministic unique claim excluded from repeatable delta', async () => {
      mockNetworkOnline = false;
      const today = getLocalDailyKey();

      // Setup progress close to mission 1 threshold (19 questions)
      const p = {
        ...createDefaultPlayerProgress(),
        daily: {
          lastActiveDate: today,
          streak: 1,
          missions: {
            m1: { progress: 19, claimed: false },
            m2: { progress: 0, claimed: false },
            m3: { progress: 0, claimed: false }
          }
        }
      };
      await saveScopedPlayerProgress(TEST_IDENTITY, p);

      const finalState = {
        status: BATTLE_STATES.DEFEAT,
        correctCount: 1,
        wrongCount: 0,
        timeoutCount: 0,
        questionNumber: 1, // Will push progress to 20 -> claims m1 (30 XP)
        maxCombo: 1,
        score: 25,
        correctTargetIds: [],
        wrongTargetIds: [],
        timeoutTargetIds: []
      };

      await processBattleResult('battle_daily_trigger', finalState, 'L1-S1');
      await new Promise((resolve) => setTimeout(resolve, 25));

      const pending = await getPendingSyncOp(TEST_IDENTITY);
      // Repeatable delta ONLY has correct answer XP (10), NOT daily 30 XP
      expect(pending.repeatableXpDelta).toBe(1 * XP_REWARDS.CORRECT_ANSWER);

      // Unique claim exists with canonical daily format
      const expectedClaimId = `daily:${today}:m1`;
      const dailyClaim = pending.uniqueClaims.find((c) => c.claimId === expectedClaimId);
      expect(dailyClaim).toBeDefined();
      expect(dailyClaim.claimId).toBe(expectedClaimId);
      expect(dailyClaim.xpReward).toBe(30);
    });
  });

  describe('3. Mistake Review Integration', () => {
    test('correct review stages repeatable review XP once', async () => {
      mockNetworkOnline = false;

      const res = await processReviewAnswer('review_event_1', 'word_test', true);
      expect(res.xpEarned).toBe(XP_REWARDS.REVIEW_CORRECT);

      await new Promise((resolve) => setTimeout(resolve, 25));
      const pending1 = await getPendingSyncOp(TEST_IDENTITY);
      expect(pending1).toBeDefined();
      expect(pending1.repeatableXpDelta).toBe(XP_REWARDS.REVIEW_CORRECT);

      // Duplicate review answer does NOT double-stage
      await processReviewAnswer('review_event_1', 'word_test', true);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const pending2 = await getPendingSyncOp(TEST_IDENTITY);
      expect(pending2.opId).toBe(pending1.opId);
      expect(pending2.repeatableXpDelta).toBe(XP_REWARDS.REVIEW_CORRECT);
    });
  });

  describe('4. Live Sync Dispatcher & Offline Gameplay', () => {
    test('offline gameplay accumulates locally and flushes safely when reconnected', async () => {
      // Simulate network offline
      mockNetworkOnline = false;

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

      // Play battle offline
      await processBattleResult('battle_offline_1', finalState, 'L1-S1');

      // Allow background dispatch attempt to settle as offline
      await new Promise((resolve) => setTimeout(resolve, 25));

      // Local playerProgress is safely saved
      const localP = await loadScopedPlayerProgress(TEST_IDENTITY);
      expect(localP.totalXp).toBeGreaterThan(0);

      // Dispatcher status is offline/saved on device
      expect(getSyncStatus()).toBe(SYNC_STATUS.OFFLINE);

      // Pending operation was created before network attempt
      const pendingOp = await getPendingSyncOp(TEST_IDENTITY);
      expect(pendingOp).toBeDefined();
      expect(pendingOp.seq).toBe(1);

      // Reconnect network
      mockNetworkOnline = true;

      // Flush again
      const reconnectFlush = await flushLiveProgress(TEST_IDENTITY);
      expect(reconnectFlush.status).toBe('synced');
      expect(getSyncStatus()).toBe(SYNC_STATUS.SYNCED);

      // Pending op was confirmed and cleared
      const pendingAfter = await getPendingSyncOp(TEST_IDENTITY);
      expect(pendingAfter).toBeNull();

      // Cloud received the state
      const cloudSnapshot = mockCloudDatabases[TEST_UID];
      expect(cloudSnapshot).toBeDefined();
      expect(cloudSnapshot.progression.totalXp).toBe(localP.totalXp);
    });

    test('lost ACK / restart retries exact same immutable pending op without duplicate XP', async () => {
      // Stage some progress
      await addStagedRepeatableXp(TEST_IDENTITY, 50);
      const deviceId = await getDeviceId();
      const op = await createPendingSyncOpFromStaged({ identity: TEST_IDENTITY, deviceId });

      // Simulate: Cloud transaction succeeded, but client was killed before receiving ACK
      await applySyncOperation(TEST_UID, op);
      const cloudXpAfterFirst = mockCloudDatabases[TEST_UID].progression.totalXp;
      expect(cloudXpAfterFirst).toBe(50);

      // App restarts with pendingSyncOp still in storage
      // Dispatcher retries exact same pending op
      const retryResult = await flushLiveProgress(TEST_IDENTITY);
      expect(retryResult.status).toBe('synced');

      // Pending op cleared
      expect(await getPendingSyncOp(TEST_IDENTITY)).toBeNull();

      // Cloud totalXp MUST NOT double!
      expect(mockCloudDatabases[TEST_UID].progression.totalXp).toBe(cloudXpAfterFirst);
    });

    test('post-op gameplay earned while op is pending is preserved upon ACK', async () => {
      // 1. Stage and enqueue Op 1 (50 XP)
      await addStagedRepeatableXp(TEST_IDENTITY, 50);
      const deviceId = await getDeviceId();
      const op1 = await createPendingSyncOpFromStaged({ identity: TEST_IDENTITY, deviceId });

      // 2. Player earns 30 MORE XP while Op 1 is pending/in-flight
      await addStagedRepeatableXp(TEST_IDENTITY, 30);

      // 3. Cloud confirms Op 1
      const flushResult = await flushLiveProgress(TEST_IDENTITY);
      expect(flushResult.status).toBe('synced');

      // Local XP must reflect Cloud (50) + post-op unsynced (30) = 80!
      // In the loop, liveProgressSync also flushes Op 2 (30 XP), reaching final 80 in cloud as well.
      const localP = await loadScopedPlayerProgress(TEST_IDENTITY);
      expect(localP.totalXp).toBe(80);
      expect(mockCloudDatabases[TEST_UID].progression.totalXp).toBe(80);
    });

    test('guest identity never writes to Firebase', async () => {
      await setActiveIdentity('guest');
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

      await processBattleResult('battle_guest', finalState, 'L1-S1');
      const flushResult = await flushLiveProgress('guest');
      expect(flushResult.status).toBe('skipped_guest');

      // Firebase never called for guest
      expect(mockCloudDatabases['guest']).toBeUndefined();
    });

    test('account switching never leaks Account A pending operation to Account B', async () => {
      // Account A creates pending op
      await setActiveIdentity('uid:AccountA');
      setCloudSyncReady('uid:AccountA', true);
      await addStagedRepeatableXp('uid:AccountA', 100);
      const devId = await getDeviceId();
      const opA = await createPendingSyncOpFromStaged({ identity: 'uid:AccountA', deviceId: devId });
      expect(opA).toBeDefined();

      // Account A signs out, Account B signs in
      await setActiveIdentity('uid:AccountB');
      setCloudSyncReady('uid:AccountB', true);
      // Account B has no pending op
      const pendingB = await getPendingSyncOp('uid:AccountB');
      expect(pendingB).toBeNull();

      // Account B flushes
      const flushB = await flushLiveProgress('uid:AccountB');
      expect(flushB.status).toBe('synced');
      // Account B never wrote Account A's data
      expect(mockCloudDatabases['AccountB']).toBeUndefined();

      // Account A signs back in
      await setActiveIdentity('uid:AccountA');
      const pendingA = await getPendingSyncOp('uid:AccountA');
      expect(pendingA.opId).toBe(opA.opId);

      // Account A flushes
      const flushA = await flushLiveProgress('uid:AccountA');
      expect(flushA.status).toBe('synced');
      expect(mockCloudDatabases['AccountA'].progression.totalXp).toBe(100);
    });
  });
});
