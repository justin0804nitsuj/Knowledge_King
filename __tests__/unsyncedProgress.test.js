import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createDefaultUnsyncedProgress,
  validateUnsyncedProgress,
  stageRepeatableXp,
  stageUniqueClaim,
  stageCampaignProgress,
  drainStagedItems,
  isUnsyncedEmpty
} from '../src/domain/sync/unsyncedProgress';
import {
  reconcileProgressOnOpAck,
  createSyncOperation
} from '../src/domain/sync/syncOperation';
import {
  getUnsyncedProgress,
  saveUnsyncedProgress,
  addStagedRepeatableXp,
  addStagedUniqueClaim,
  addStagedCampaignProgress,
  clearUnsyncedProgress
} from '../src/storage/unsyncedProgressStorage';
import {
  createPendingSyncOpFromStaged,
  getPendingSyncOp,
  hasPendingSyncOp,
  clearPendingSyncOp
} from '../src/storage/syncOutboxStorage';
import { getScopedKey } from '../src/storage/storageIdentity';

// In-memory mock storage for AsyncStorage
let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => (mockStore[key] !== undefined ? mockStore[key] : null)),
  setItem: jest.fn(async (key, value) => {
    mockStore[key] = String(value);
  }),
  removeItem: jest.fn(async (key) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  })
}));

const DEVICE_A = 'dev-uuid-aaa-111';
const DEVICE_B = 'dev-uuid-bbb-222';

describe('Local Unsynced Accumulator & Optimistic Claim Safety (Phase 3.5)', () => {
  beforeEach(() => {
    mockStore = {};
    jest.clearAllMocks();
  });

  describe('1. Unsynced Staging Accumulator Domain Logic', () => {
    test('initializes default empty accumulator with separate categories', () => {
      const defaultState = createDefaultUnsyncedProgress();
      expect(defaultState.repeatableXpDelta).toBe(0);
      expect(defaultState.uniqueClaims).toEqual({});
      expect(defaultState.campaignProgress.clearedStages).toEqual({});
      expect(defaultState.lastEnqueuedOpId).toBeNull();
      expect(isUnsyncedEmpty(defaultState)).toBe(true);
    });

    test('stages repeatable XP independently and rejects negative/invalid XP', () => {
      const state1 = createDefaultUnsyncedProgress();
      const state2 = stageRepeatableXp(state1, 50);
      expect(state2.repeatableXpDelta).toBe(50);

      const state3 = stageRepeatableXp(state2, 30);
      expect(state3.repeatableXpDelta).toBe(80);

      expect(() => stageRepeatableXp(state3, -10)).toThrow();
      expect(() => stageRepeatableXp(state3, NaN)).toThrow();
    });

    test('stages unique claims independently with canonical reward resolution', () => {
      const state1 = createDefaultUnsyncedProgress();
      const state2 = stageUniqueClaim(state1, { claimId: 'firstClear:L1-S1' });

      expect(state2.uniqueClaims['firstClear:L1-S1']).toEqual({
        claimId: 'firstClear:L1-S1',
        xpReward: 20
      });
      // Repeatable XP is NOT polluted by unique claim
      expect(state2.repeatableXpDelta).toBe(0);
    });

    test('strictly rejects duplicate staged claim IDs', () => {
      const state1 = createDefaultUnsyncedProgress();
      const state2 = stageUniqueClaim(state1, { claimId: 'firstClear:L1-S1' });

      expect(() => stageUniqueClaim(state2, { claimId: 'firstClear:L1-S1' })).toThrow(
        /Duplicate staged unique claim/
      );
    });

    test('stages campaign progress independently with high-water marks', () => {
      const state1 = createDefaultUnsyncedProgress();
      const state2 = stageCampaignProgress(state1, {
        clearedStages: ['L1-S1'],
        stageStars: { 'L1-S1': 2 },
        stageScores: { 'L1-S1': 500 },
        bestCombo: 5
      });

      expect(state2.campaignProgress.clearedStages['L1-S1']).toBe(true);
      expect(state2.campaignProgress.stageStars['L1-S1']).toBe(2);
      expect(state2.campaignProgress.stageScores['L1-S1']).toBe(500);
      expect(state2.campaignProgress.bestCombo).toBe(5);

      // Higher score/star updates high-water mark; lower does not downgrade
      const state3 = stageCampaignProgress(state2, {
        stageStars: { 'L1-S1': 3 },
        stageScores: { 'L1-S1': 400 },
        bestCombo: 8
      });

      expect(state3.campaignProgress.stageStars['L1-S1']).toBe(3);
      expect(state3.campaignProgress.stageScores['L1-S1']).toBe(500);
      expect(state3.campaignProgress.bestCombo).toBe(8);
    });
  });

  describe('2. Pending Op Construction & Staging Drain', () => {
    test('creates pending op from staged accumulator and drains staged items safely', async () => {
      const identity = 'uid:player_one';

      // 1. Stage progress
      await addStagedRepeatableXp(identity, 60);
      await addStagedUniqueClaim(identity, { claimId: 'firstClear:L1-S1' });
      await addStagedCampaignProgress(identity, { clearedStages: ['L1-S1'] });

      // 2. Create pending op from staged data
      const op = await createPendingSyncOpFromStaged({ identity, deviceId: DEVICE_A });

      expect(op).not.toBeNull();
      expect(op.opId).toBe(`${DEVICE_A}:1`);
      expect(op.repeatableXpDelta).toBe(60);
      expect(op.uniqueClaims).toHaveLength(1);
      expect(op.uniqueClaims[0].claimId).toBe('firstClear:L1-S1');

      // 3. Verify accumulator is drained of the enqueued items
      const afterDrain = await getUnsyncedProgress(identity);
      expect(afterDrain.repeatableXpDelta).toBe(0);
      expect(afterDrain.uniqueClaims['firstClear:L1-S1']).toBeUndefined();
      expect(afterDrain.lastEnqueuedOpId).toBe(op.opId);
    });

    test('new progress accumulates separately while pending op remains pending & immutable', async () => {
      const identity = 'uid:player_one';

      // 1. Create first batch (seq=1)
      await addStagedRepeatableXp(identity, 50);
      await addStagedUniqueClaim(identity, { claimId: 'firstClear:L1-S1' });
      const op1 = await createPendingSyncOpFromStaged({ identity, deviceId: DEVICE_A });

      // 2. Player keeps playing while op1 is pending: earns +40 repeatable XP and completes daily mission
      await addStagedRepeatableXp(identity, 40);
      await addStagedUniqueClaim(identity, { claimId: 'daily:2026-10-14:m1' });

      // 3. Verify pending op1 is COMPLETELY UNTOUCHED (immutable batch)
      const pendingRead = await getPendingSyncOp(identity);
      expect(pendingRead.opId).toBe(op1.opId);
      expect(pendingRead.repeatableXpDelta).toBe(50);
      expect(pendingRead.uniqueClaims).toHaveLength(1);
      expect(pendingRead.uniqueClaims[0].claimId).toBe('firstClear:L1-S1');

      // 4. Verify unsynced accumulator contains the NEW progress
      const unsynced = await getUnsyncedProgress(identity);
      expect(unsynced.repeatableXpDelta).toBe(40);
      expect(unsynced.uniqueClaims['daily:2026-10-14:m1']).toBeDefined();
    });

    test('returns null if there are no staged changes to sync', async () => {
      const identity = 'uid:player_empty';
      const op = await createPendingSyncOpFromStaged({ identity, deviceId: DEVICE_A });
      expect(op).toBeNull();
      expect(await hasPendingSyncOp(identity)).toBe(false);
    });
  });

  describe('3. Crash Safety & Partial-Write Recovery', () => {
    test('recovers safely if app killed after pending op write but before accumulator drain', async () => {
      const identity = 'uid:player_crash';

      // Simulate state where pendingSyncOp was saved with opId dev:1,
      // but the app crashed before unsyncedProgress was drained (lastEnqueuedOpId is null)
      const op = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1,
        repeatableXpDelta: 50,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }]
      });

      const pendingKey = getScopedKey('pendingSyncOp', identity);
      const unsyncedKey = getScopedKey('unsyncedProgress', identity);

      await AsyncStorage.setItem(pendingKey, JSON.stringify(op));

      // Unsynced accumulator still has the old 50 XP and firstClear claim
      const unDrained = {
        repeatableXpDelta: 50,
        uniqueClaims: {
          'firstClear:L1-S1': { claimId: 'firstClear:L1-S1', xpReward: 20 }
        },
        campaignProgress: { clearedStages: {}, stageStars: {}, stageScores: {}, bestCombo: 0 },
        lastEnqueuedOpId: null // Not updated due to crash
      };
      await AsyncStorage.setItem(unsyncedKey, JSON.stringify(unDrained));

      // On next read / app restart, getUnsyncedProgress detects the crash inconsistency
      const recovered = await getUnsyncedProgress(identity);

      // Successfully drained: NO DUPLICATE DATA
      expect(recovered.repeatableXpDelta).toBe(0);
      expect(recovered.uniqueClaims['firstClear:L1-S1']).toBeUndefined();
      expect(recovered.lastEnqueuedOpId).toBe(op.opId);

      // Idempotent: repeated reads remain consistent
      const secondRead = await getUnsyncedProgress(identity);
      expect(secondRead.repeatableXpDelta).toBe(0);
      expect(secondRead.lastEnqueuedOpId).toBe(op.opId);
    });
  });

  describe('4. Reconciliation Contract & Deduplication Under ACK', () => {
    test('CRITICAL SCENARIO: Duplicate first-clear claim by another device removes optimistic duplicate XP without polluting new repeatable XP', () => {
      /**
       * Initial Setup:
       * - Cloud authoritative totalXp = 100 (which already granted firstClear:L1-S1 to Device A).
       * - Cloud uniqueClaims = { 'firstClear:L1-S1': true }.
       * - Device B constructed pending op containing firstClear:L1-S1 (+20).
       * - While op is pending, user earns +30 repeatable XP locally.
       */
      const cloudSnapshot = {
        progression: { totalXp: 100 },
        uniqueClaims: { 'firstClear:L1-S1': true },
        campaign: { clearedStages: ['L1-S1'] }
      };

      // Progress staged in unsyncedProgress AFTER op creation:
      const unsyncedProgress = {
        repeatableXpDelta: 30, // +30 new repeatable XP
        uniqueClaims: {},      // No new unique claims
        campaignProgress: { clearedStages: {} }
      };

      const reconciled = reconcileProgressOnOpAck({
        cloudSnapshot,
        unsyncedProgress
      });

      // Expected Result:
      // Local MUST equal: Cloud authoritative state (100) + 30 new repeatable XP = 130 XP!
      // NOT: Cloud (100) + 30 + duplicate 20 = 150.
      expect(reconciled.progression.totalXp).toBe(130);
      expect(reconciled.progression.postOpEarnedRepeatableXp).toBe(30);
      expect(reconciled.progression.postOpUnresolvedUniqueXp).toBe(0);
    });

    test('Accepted unique claim reconciles correctly alongside post-op earnings', () => {
      // Cloud accepted firstClear:L1-S1, bringing cloud from 80 to 100 XP
      const cloudSnapshot = {
        progression: { totalXp: 100 },
        uniqueClaims: { 'firstClear:L1-S1': true },
        campaign: { clearedStages: ['L1-S1'] }
      };

      // Player earned +50 repeatable XP and completed a NEW daily mission m1 (+30) after op was built
      const unsyncedProgress = {
        repeatableXpDelta: 50,
        uniqueClaims: {
          'daily:2026-10-14:m1': { claimId: 'daily:2026-10-14:m1', xpReward: 30 }
        },
        campaignProgress: { clearedStages: {} }
      };

      const reconciled = reconcileProgressOnOpAck({
        cloudSnapshot,
        unsyncedProgress
      });

      // Cloud (100) + postOpRepeatable (50) + postOpUnresolvedDaily (30) = 180 XP
      expect(reconciled.progression.totalXp).toBe(180);
      expect(reconciled.progression.postOpEarnedRepeatableXp).toBe(50);
      expect(reconciled.progression.postOpUnresolvedUniqueXp).toBe(30);
    });
  });

  describe('5. Multi-Account / Guest Staging Isolation', () => {
    test('staged progress is isolated between Account A, Account B, and Guest', async () => {
      await addStagedRepeatableXp('uid:player_A', 100);
      await addStagedUniqueClaim('uid:player_A', { claimId: 'firstClear:L1-S1' });

      await addStagedRepeatableXp('uid:player_B', 200);
      await addStagedUniqueClaim('uid:player_B', { claimId: 'firstClear:L1-E1' });

      await addStagedRepeatableXp('guest', 15);

      const stagedA = await getUnsyncedProgress('uid:player_A');
      const stagedB = await getUnsyncedProgress('uid:player_B');
      const stagedGuest = await getUnsyncedProgress('guest');

      expect(stagedA.repeatableXpDelta).toBe(100);
      expect(stagedA.uniqueClaims['firstClear:L1-S1']).toBeDefined();
      expect(stagedA.uniqueClaims['firstClear:L1-E1']).toBeUndefined();

      expect(stagedB.repeatableXpDelta).toBe(200);
      expect(stagedB.uniqueClaims['firstClear:L1-E1']).toBeDefined();
      expect(stagedB.uniqueClaims['firstClear:L1-S1']).toBeUndefined();

      expect(stagedGuest.repeatableXpDelta).toBe(15);
      expect(Object.keys(stagedGuest.uniqueClaims)).toHaveLength(0);
    });
  });
});
