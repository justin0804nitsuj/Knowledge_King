import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalDailyKey, DAILY_MISSIONS, claimDailyMission, _resetDailyClaimLocksForTests } from '../src/domain/player/dailySystem';
import {
  loadPlayerProgress,
  savePlayerProgress,
  createDefaultPlayerProgress,
  processDayRollover
} from '../src/storage/playerProgressStorage';
import { processBattleResult } from '../src/domain/game/resultProcessor';
import { processReviewAnswer } from '../src/domain/game/reviewProcessor';
import { applyCloudToLocalProgress, setLastSyncedSnapshot } from '../src/services/sync/cloudRestoreAdapter';
import { getUnsyncedProgress } from '../src/storage/unsyncedProgressStorage';
import { reduceCloudProgress, createVirginCloudProgress } from '../src/domain/sync/cloudProgressReducer';
import { reconcileProgressOnOpAck } from '../src/domain/sync/syncOperation';
import { getScopedKey, setActiveIdentity } from '../src/storage/storageIdentity';
import { _resetSyncLocksForTesting } from '../src/storage/syncLock';
import { BATTLE_STATES } from '../src/domain/game/battleEngine';

jest.mock('@react-native-async-storage/async-storage', () => {
  let store = {};
  return {
    getItem: jest.fn(async (key) => store[key] !== undefined ? store[key] : null),
    setItem: jest.fn(async (key, value) => { store[key] = String(value); }),
    removeItem: jest.fn(async (key) => { delete store[key]; }),
    multiSet: jest.fn(async (pairs) => {
      for (const [k, v] of pairs) store[k] = String(v);
    }),
    multiGet: jest.fn(async (keys) => keys.map((k) => [k, store[k] !== undefined ? store[k] : null])),
    clear: jest.fn(async () => { store = {}; }),
    _getStore: () => store,
    _setStore: (s) => { store = s; }
  };
});

jest.mock('../src/services/sync/liveProgressSync', () => ({
  flushLiveProgress: jest.fn(async () => ({ status: 'mock_flushed' })),
  isCloudSyncReady: jest.fn(() => true)
}));

describe('Daily Quest Idempotency & Lifecycle Invariants (Phase 5B.3)', () => {
  const TEST_IDENTITY = 'uid:player_daily_tester';
  const TODAY = getLocalDailyKey();

  beforeEach(async () => {
    AsyncStorage._setStore({});
    _resetSyncLocksForTesting();
    _resetDailyClaimLocksForTests();
    await setActiveIdentity(TEST_IDENTITY);
  });

  // A. same mission claim called twice -> XP awarded once
  it('A. same mission claim called twice -> XP awarded once', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = TODAY;
    p.daily.missions.m1.progress = 20; // Reached target
    await savePlayerProgress(p, TEST_IDENTITY);

    const initialXp = p.totalXp;

    // First call
    const res1 = await claimDailyMission('m1', { identity: TEST_IDENTITY });
    expect(res1.success).toBe(true);
    expect(res1.alreadyClaimed).toBe(false);
    expect(res1.xpAwarded).toBe(DAILY_MISSIONS.MISSION_1.xpReward);

    const pAfterFirst = await loadPlayerProgress(TEST_IDENTITY);
    expect(pAfterFirst.totalXp).toBe(initialXp + DAILY_MISSIONS.MISSION_1.xpReward);
    expect(pAfterFirst.daily.missions.m1.claimed).toBe(true);

    // Second call (strict NO-OP)
    const res2 = await claimDailyMission('m1', { identity: TEST_IDENTITY });
    expect(res2.success).toBe(false);
    expect(res2.alreadyClaimed).toBe(true);
    expect(res2.xpAwarded).toBe(0);

    const pAfterSecond = await loadPlayerProgress(TEST_IDENTITY);
    expect(pAfterSecond.totalXp).toBe(pAfterFirst.totalXp);
    expect(pAfterSecond.daily.missions.m1.claimed).toBe(true);
  });

  // B. rapid double invocation -> XP awarded once
  it('B. rapid double invocation -> XP awarded once', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = TODAY;
    p.daily.missions.m1.progress = 20;
    await savePlayerProgress(p, TEST_IDENTITY);

    const initialXp = p.totalXp;

    // Concurrent invocations
    const [resA, resB] = await Promise.all([
      claimDailyMission('m1', { identity: TEST_IDENTITY }),
      claimDailyMission('m1', { identity: TEST_IDENTITY })
    ]);

    const successes = [resA, resB].filter((r) => r.success);
    const noops = [resA, resB].filter((r) => r.alreadyClaimed);

    expect(successes.length).toBe(1);
    expect(noops.length).toBe(1);
    expect(successes[0].xpAwarded).toBe(DAILY_MISSIONS.MISSION_1.xpReward);
    expect(noops[0].xpAwarded).toBe(0);

    const pFinal = await loadPlayerProgress(TEST_IDENTITY);
    expect(pFinal.totalXp).toBe(initialXp + DAILY_MISSIONS.MISSION_1.xpReward);
    expect(pFinal.daily.missions.m1.claimed).toBe(true);
  });

  // C. same-date app restart -> claimed remains true
  it('C. same-date app restart -> claimed remains true', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = TODAY;
    p.daily.missions.m1.progress = 20;
    p.daily.missions.m1.claimed = true;
    p.totalXp = 100;
    await savePlayerProgress(p, TEST_IDENTITY);

    // Simulate restart on same date
    const reloaded = await loadPlayerProgress(TEST_IDENTITY);
    expect(reloaded.daily.lastActiveDate).toBe(TODAY);
    expect(reloaded.daily.missions.m1.claimed).toBe(true);
    expect(reloaded.daily.missions.m1.progress).toBe(20);
    expect(reloaded.totalXp).toBe(100);
  });

  // D. HomeScreen remount -> claimed remains true
  it('D. HomeScreen remount -> claimed remains true', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = TODAY;
    p.daily.missions.m2.progress = 2;
    p.daily.missions.m2.claimed = true;
    await savePlayerProgress(p, TEST_IDENTITY);

    // Multiple screen focus/mount events reload progress
    const focus1 = await loadPlayerProgress(TEST_IDENTITY);
    expect(focus1.daily.missions.m2.claimed).toBe(true);

    const focus2 = await loadPlayerProgress(TEST_IDENTITY);
    expect(focus2.daily.missions.m2.claimed).toBe(true);
    expect(focus2.daily.missions.m2.progress).toBe(2);
  });

  // E. BattleResult processed twice -> Daily claim staged once
  it('E. BattleResult processed twice -> Daily claim staged once', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = TODAY;
    p.daily.missions.m1.progress = 15;
    await savePlayerProgress(p, TEST_IDENTITY);

    const finalState = {
      status: BATTLE_STATES.VICTORY,
      correctCount: 5,
      wrongCount: 1,
      timeoutCount: 0,
      questionNumber: 5, // 15 + 5 = 20 -> completes m1
      maxCombo: 5,
      score: 100,
      correctTargetIds: [],
      wrongTargetIds: ['word_wrong'],
      timeoutTargetIds: []
    };

    const res1 = await processBattleResult('battle_daily_e', finalState, 'L1-S1');
    expect(res1.xpEarned).toBeGreaterThan(0);

    const unsynced1 = await getUnsyncedProgress(TEST_IDENTITY);
    expect(unsynced1.uniqueClaims[`daily:${TODAY}:m1`]).toBeDefined();
    expect(Object.keys(unsynced1.uniqueClaims).filter((k) => k.startsWith('daily:')).length).toBe(1);

    // Call with same battleId again
    const res2 = await processBattleResult('battle_daily_e', finalState, 'L1-S1');
    expect(res2.xpEarned).toBe(res1.xpEarned);

    const unsynced2 = await getUnsyncedProgress(TEST_IDENTITY);
    expect(Object.keys(unsynced2.uniqueClaims).filter((k) => k.startsWith('daily:')).length).toBe(1);
  });

  // F. Review event processed twice -> Daily claim staged once
  it('F. Review event processed twice -> Daily claim staged once', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = TODAY;
    p.daily.missions.m1.progress = 19;
    await savePlayerProgress(p, TEST_IDENTITY);

    const res1 = await processReviewAnswer('rev_daily_f', 'word_rev_1', true);
    expect(res1.xpEarned).toBeGreaterThan(0);

    const unsynced1 = await getUnsyncedProgress(TEST_IDENTITY);
    expect(unsynced1.uniqueClaims[`daily:${TODAY}:m1`]).toBeDefined();

    // Call with same eventId again
    const res2 = await processReviewAnswer('rev_daily_f', 'word_rev_1', true);
    expect(res2.xpEarned).toBe(0);

    const unsynced2 = await getUnsyncedProgress(TEST_IDENTITY);
    expect(Object.keys(unsynced2.uniqueClaims).filter((k) => k.startsWith('daily:')).length).toBe(1);
  });

  // G. cloud restore containing today's daily claim -> local mission becomes claimed -> no extra XP granted
  it("G. cloud restore containing today's daily claim -> local mission becomes claimed -> no extra XP granted", () => {
    const cloudProgress = {
      schemaVersion: 1,
      revision: 5,
      progression: {
        totalXp: 1250 // Contains authoritative daily reward
      },
      campaign: {
        clearedStages: { 'L1-S1': true },
        stageStars: { 'L1-S1': 3 },
        stageScores: { 'L1-S1': 100 },
        bestCombo: 5
      },
      uniqueClaims: {
        [`daily:${TODAY}:m1`]: {
          claimedAt: Date.now() - 10000,
          deviceId: 'device_A'
        }
      }
    };

    // Device B clean local state
    const localPlayer = createDefaultPlayerProgress();
    localPlayer.daily.missions.m1.progress = 10;
    localPlayer.daily.missions.m1.claimed = false;

    const restored = applyCloudToLocalProgress(cloudProgress, localPlayer, {});

    // Mission is marked as claimed
    expect(restored.playerProgress.daily.missions.m1.claimed).toBe(true);
    // Unrelated progress is preserved
    expect(restored.playerProgress.daily.missions.m1.progress).toBe(10);
    // Cloud XP is accepted as-is; no +30 added on top
    expect(restored.playerProgress.totalXp).toBe(1250);
  });

  // H. Device A claims m1 -> Device B same account restores -> B cannot claim m1 again
  it('H. Device A claims m1 -> Device B same account restores -> B cannot claim m1 again', async () => {
    const cloudProgress = {
      schemaVersion: 1,
      revision: 2,
      progression: { totalXp: 500 },
      campaign: {},
      uniqueClaims: {
        [`daily:${TODAY}:m1`]: { claimedAt: Date.now(), deviceId: 'deviceA' }
      }
    };

    // Store cloud snapshot as acknowledged
    await setLastSyncedSnapshot(TEST_IDENTITY, cloudProgress);

    // Restore to Device B
    let localPlayer = createDefaultPlayerProgress();
    localPlayer.daily.missions.m1.progress = 20; // Device B also had enough progress
    localPlayer.daily.missions.m1.claimed = false;
    const restored = applyCloudToLocalProgress(cloudProgress, localPlayer, {});
    await savePlayerProgress(restored.playerProgress, TEST_IDENTITY);

    // Device B attempts to claim m1
    const claimRes = await claimDailyMission('m1', { identity: TEST_IDENTITY });
    expect(claimRes.success).toBe(false);
    expect(claimRes.alreadyClaimed).toBe(true);
    expect(claimRes.xpAwarded).toBe(0);

    const pFinal = await loadPlayerProgress(TEST_IDENTITY);
    expect(pFinal.totalXp).toBe(500); // XP remains exactly 500
  });

  // I. offline duplicate claims from A and B -> cloud credits canonical Daily XP once -> reconciliation removes duplicate optimistic credit
  it('I. offline duplicate claims from A and B -> cloud credits canonical Daily XP once -> reconciliation removes duplicate optimistic credit', () => {
    let cloud = createVirginCloudProgress();
    cloud.progression.totalXp = 1000;

    // Device A offline claims m1 (+30 XP)
    const opA = {
      opId: 'deviceA:1',
      deviceId: 'deviceA',
      seq: 1,
      createdAt: Date.now(),
      repeatableXpDelta: 0,
      uniqueClaims: [{ claimId: `daily:${TODAY}:m1`, xpReward: 30 }],
      campaignProgress: { clearedStages: [], stageStars: {}, stageScores: {}, bestCombo: 0 }
    };

    // Device B offline claims m1 (+30 XP) AND earns 15 repeatable XP
    const opB = {
      opId: 'deviceB:1',
      deviceId: 'deviceB',
      seq: 1,
      createdAt: Date.now(),
      repeatableXpDelta: 15,
      uniqueClaims: [{ claimId: `daily:${TODAY}:m1`, xpReward: 30 }],
      campaignProgress: { clearedStages: [], stageStars: {}, stageScores: {}, bestCombo: 0 }
    };

    // 1. Device A syncs first
    cloud = reduceCloudProgress(cloud, opA);
    expect(cloud.progression.totalXp).toBe(1030); // 1000 + 30
    expect(cloud.uniqueClaims[`daily:${TODAY}:m1`]).toBeDefined();

    // 2. Device B syncs second
    cloud = reduceCloudProgress(cloud, opB);
    // Cloud should add +15 repeatable XP, but REJECT duplicate m1 (+30)!
    expect(cloud.progression.totalXp).toBe(1045); // 1030 + 15

    // 3. Device B reconciles on Op ACK
    // Device B had optimistically added +30 and +15 locally (1045)
    const reconciledB = reconcileProgressOnOpAck({
      cloudSnapshot: cloud,
      unsyncedProgress: { repeatableXpDelta: 0, uniqueClaims: {} }
    });

    // Authoritative total converges cleanly to 1045; no duplicate daily reward!
    expect(reconciledB.progression.totalXp).toBe(1045);
  });

  // J. next calendar date -> mission resets normally -> new date claim can be earned once
  it('J. next calendar date -> mission resets normally -> new date claim can be earned once', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = '2020-01-01';
    p.daily.missions.m1.progress = 20;
    p.daily.missions.m1.claimed = true;
    p.totalXp = 500;
    await savePlayerProgress(p, TEST_IDENTITY);

    // Rollover to next date TODAY
    const rolledOver = processDayRollover(p, TODAY);
    expect(rolledOver.daily.lastActiveDate).toBe(TODAY);
    expect(rolledOver.daily.missions.m1.claimed).toBe(false);
    expect(rolledOver.daily.missions.m1.progress).toBe(0);

    // Save and earn new date's mission
    rolledOver.daily.missions.m1.progress = 20;
    await savePlayerProgress(rolledOver, TEST_IDENTITY);

    const claimRes = await claimDailyMission('m1', { identity: TEST_IDENTITY, dateKey: TODAY });
    expect(claimRes.success).toBe(true);
    expect(claimRes.xpAwarded).toBe(30);

    const pAfter = await loadPlayerProgress(TEST_IDENTITY);
    expect(pAfter.totalXp).toBe(530);
    expect(pAfter.daily.missions.m1.claimed).toBe(true);
  });

  // K. m1 claimed does not incorrectly mark m2/m3 claimed
  it('K. m1 claimed does not incorrectly mark m2/m3 claimed', async () => {
    let p = createDefaultPlayerProgress();
    p.daily.lastActiveDate = TODAY;
    p.daily.missions.m1.progress = 20;
    p.daily.missions.m2.progress = 1;
    p.daily.missions.m3.progress = 0;
    await savePlayerProgress(p, TEST_IDENTITY);

    await claimDailyMission('m1', { identity: TEST_IDENTITY });

    const pAfter = await loadPlayerProgress(TEST_IDENTITY);
    expect(pAfter.daily.missions.m1.claimed).toBe(true);
    expect(pAfter.daily.missions.m2.claimed).toBe(false);
    expect(pAfter.daily.missions.m2.progress).toBe(1);
    expect(pAfter.daily.missions.m3.claimed).toBe(false);
    expect(pAfter.daily.missions.m3.progress).toBe(0);
  });
});
