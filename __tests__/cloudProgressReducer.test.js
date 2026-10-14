import {
  reduceCloudProgress,
  createVirginCloudProgress
} from '../src/domain/sync/cloudProgressReducer';
import { createSyncOperation } from '../src/domain/sync/syncOperation';

const DEVICE_A = 'dev-uuid-aaa-111';
const DEVICE_B = 'dev-uuid-bbb-222';

describe('Pure Cloud Progress Reducer (Phase 4)', () => {
  const fixedNow = 1728950400000;

  describe('1. Virgin Account Initialization', () => {
    test('initializes schemaVersion 1, revision 0, and structured defaults when state is null', () => {
      const virgin = createVirginCloudProgress(fixedNow);
      expect(virgin.schemaVersion).toBe(1);
      expect(virgin.revision).toBe(0);
      expect(virgin.updatedAt).toBe(fixedNow);
      expect(virgin.appliedOps).toEqual({});
      expect(virgin.progression.totalXp).toBe(0);
      expect(virgin.campaign.clearedStages).toEqual({});
      expect(virgin.campaign.stageStars).toEqual({});
      expect(virgin.campaign.stageScores).toEqual({});
      expect(virgin.campaign.bestCombo).toBe(0);
      expect(virgin.uniqueClaims).toEqual({});
    });

    test('first operation initializes virgin record and increments revision to 1', () => {
      const op = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1,
        repeatableXpDelta: 50
      });

      const next = reduceCloudProgress(null, op, { now: fixedNow });
      expect(next.schemaVersion).toBe(1);
      expect(next.revision).toBe(1);
      expect(next.progression.totalXp).toBe(50);
      expect(next.appliedOps[DEVICE_A]).toBe(1);
      expect(next.updatedAt).toBe(fixedNow);
    });
  });

  describe('2. Repeatable XP & Revision Monotonicity', () => {
    test('advances repeatable XP and sequence monotonically', () => {
      let state = null;

      // Op 1: +50 XP
      const op1 = createSyncOperation({ deviceId: DEVICE_A, seq: 1, repeatableXpDelta: 50 });
      state = reduceCloudProgress(state, op1, { now: fixedNow });
      expect(state.progression.totalXp).toBe(50);
      expect(state.revision).toBe(1);
      expect(state.appliedOps[DEVICE_A]).toBe(1);

      // Op 2: +75 XP
      const op2 = createSyncOperation({ deviceId: DEVICE_A, seq: 2, repeatableXpDelta: 75 });
      state = reduceCloudProgress(state, op2, { now: fixedNow + 1000 });
      expect(state.progression.totalXp).toBe(125);
      expect(state.revision).toBe(2);
      expect(state.appliedOps[DEVICE_A]).toBe(2);
    });
  });

  describe('3. Lost-Ack & Duplicate Idempotency', () => {
    test('duplicate op with seq <= appliedOps is a complete no-op (same state returned)', () => {
      const op1 = createSyncOperation({ deviceId: DEVICE_A, seq: 5, repeatableXpDelta: 100 });
      const state1 = reduceCloudProgress(null, op1, { now: fixedNow });
      expect(state1.progression.totalXp).toBe(100);
      expect(state1.revision).toBe(1);

      // Same op re-submitted (e.g. retry after lost ACK)
      const state2 = reduceCloudProgress(state1, op1, { now: fixedNow + 2000 });
      expect(state2).toBe(state1); // Exact reference returned unchanged
      expect(state2.progression.totalXp).toBe(100);
      expect(state2.revision).toBe(1);

      // Stale op with seq < appliedOps (e.g. seq 4 arriving after seq 5)
      const staleOp = createSyncOperation({ deviceId: DEVICE_A, seq: 4, repeatableXpDelta: 50 });
      const state3 = reduceCloudProgress(state1, staleOp, { now: fixedNow + 3000 });
      expect(state3).toBe(state1);
      expect(state3.progression.totalXp).toBe(100);
      expect(state3.revision).toBe(1);
    });
  });

  describe('4. Canonical Unique Rewards & Multi-Device Deduplication', () => {
    test('credits canonical unique reward on first claim', () => {
      const op = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }]
      });

      const state = reduceCloudProgress(null, op, { now: fixedNow });
      // Canonical firstClear:L1-S1 = +20 XP
      expect(state.progression.totalXp).toBe(20);
      expect(state.uniqueClaims['firstClear:L1-S1']).toEqual({
        claimedAt: fixedNow,
        deviceId: DEVICE_A
      });
    });

    test('canonical reward resolution derives XP from authoritative definition regardless of claim omission', () => {
      const op = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }] // xpReward omitted in raw call
      });

      const state = reduceCloudProgress(null, op, { now: fixedNow });
      // Reducer re-resolves canonical value (+20)
      expect(state.progression.totalXp).toBe(20);
    });

    test('Device B submitting the same unique claim is deduplicated (0 XP added)', () => {
      // Device A clears L1-S1
      const opA = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1,
        repeatableXpDelta: 10,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }]
      });
      const stateAfterA = reduceCloudProgress(null, opA, { now: fixedNow });
      // 10 repeatable + 20 canonical firstClear = 30 XP
      expect(stateAfterA.progression.totalXp).toBe(30);

      // Device B also offline cleared L1-S1 and submits
      const opB = createSyncOperation({
        deviceId: DEVICE_B,
        seq: 1,
        repeatableXpDelta: 25,
        uniqueClaims: [{ claimId: 'firstClear:L1-S1' }]
      });
      const stateAfterB = reduceCloudProgress(stateAfterA, opB, { now: fixedNow + 1000 });

      // Repeatable XP from Device B (+25) is credited, but duplicate firstClear (+20) is NOT added again!
      // Total = 30 + 25 = 55 XP
      expect(stateAfterB.progression.totalXp).toBe(55);
      expect(stateAfterB.uniqueClaims['firstClear:L1-S1'].deviceId).toBe(DEVICE_A); // Original claimant preserved
      expect(stateAfterB.appliedOps[DEVICE_A]).toBe(1);
      expect(stateAfterB.appliedOps[DEVICE_B]).toBe(1);
    });
  });

  describe('5. Campaign Merging & High-Water Marks', () => {
    test('unions cleared stages and preserves max stars, scores, and combo', () => {
      const op1 = createSyncOperation({
        deviceId: DEVICE_A,
        seq: 1,
        campaignProgress: {
          clearedStages: ['L1-S1'],
          stageStars: { 'L1-S1': 2 },
          stageScores: { 'L1-S1': 500 },
          bestCombo: 6
        }
      });
      const state1 = reduceCloudProgress(null, op1, { now: fixedNow });

      const op2 = createSyncOperation({
        deviceId: DEVICE_B,
        seq: 1,
        campaignProgress: {
          clearedStages: ['L1-S1', 'L1-S2'],
          stageStars: { 'L1-S1': 3, 'L1-S2': 1 },
          stageScores: { 'L1-S1': 450, 'L1-S2': 700 }, // lower score on S1, new stage S2
          bestCombo: 10
        }
      });
      const state2 = reduceCloudProgress(state1, op2, { now: fixedNow + 1000 });

      expect(state2.campaign.clearedStages['L1-S1']).toBe(true);
      expect(state2.campaign.clearedStages['L1-S2']).toBe(true);
      expect(state2.campaign.stageStars['L1-S1']).toBe(3); // max(2, 3)
      expect(state2.campaign.stageStars['L1-S2']).toBe(1);
      expect(state2.campaign.stageScores['L1-S1']).toBe(500); // max(500, 450)
      expect(state2.campaign.stageScores['L1-S2']).toBe(700);
      expect(state2.campaign.bestCombo).toBe(10); // max(6, 10)
    });
  });

  describe('6. Two-Device Concurrency & Order Invariance', () => {
    test('two-device additive repeatable XP is order-invariant', () => {
      const opA = createSyncOperation({ deviceId: DEVICE_A, seq: 1, repeatableXpDelta: 30 });
      const opB = createSyncOperation({ deviceId: DEVICE_B, seq: 1, repeatableXpDelta: 50 });

      // Order 1: A then B
      const stateAB = reduceCloudProgress(reduceCloudProgress(null, opA), opB);
      // Order 2: B then A
      const stateBA = reduceCloudProgress(reduceCloudProgress(null, opB), opA);

      expect(stateAB.progression.totalXp).toBe(80);
      expect(stateBA.progression.totalXp).toBe(80);
      expect(stateAB.appliedOps).toEqual(stateBA.appliedOps);
    });
  });

  describe('7. Validation Refusals', () => {
    test('refuses invalid deviceId', () => {
      expect(() => reduceCloudProgress(null, { opId: ':1', deviceId: '', seq: 1, createdAt: Date.now() })).toThrow();
    });

    test('refuses invalid seq', () => {
      expect(() => reduceCloudProgress(null, { opId: 'dev:0', deviceId: 'dev', seq: 0, createdAt: Date.now() })).toThrow();
      expect(() => reduceCloudProgress(null, { opId: 'dev:-5', deviceId: 'dev', seq: -5, createdAt: Date.now() })).toThrow();
    });

    test('refuses mismatched opId', () => {
      expect(() => reduceCloudProgress(null, { opId: 'wrong:1', deviceId: 'dev', seq: 1, createdAt: Date.now() })).toThrow();
    });

    test('refuses negative repeatable XP', () => {
      expect(() => reduceCloudProgress(null, {
        opId: 'dev:1',
        deviceId: 'dev',
        seq: 1,
        createdAt: Date.now(),
        repeatableXpDelta: -50
      })).toThrow();
    });

    test('refuses malformed unique claims', () => {
      expect(() => reduceCloudProgress(null, {
        opId: 'dev:1',
        deviceId: 'dev',
        seq: 1,
        createdAt: Date.now(),
        uniqueClaims: [{ claimId: 'unknownFamily:something' }]
      })).toThrow();
    });

    test('refuses arbitrary xpReward mismatch in unique claim', () => {
      expect(() => reduceCloudProgress(null, {
        opId: 'dev:1',
        deviceId: 'dev',
        seq: 1,
        createdAt: Date.now(),
        uniqueClaims: [{ claimId: 'firstClear:L1-S1', xpReward: 9999 }]
      })).toThrow();
    });

    test('refuses malformed campaign data', () => {
      expect(() => reduceCloudProgress(null, {
        opId: 'dev:1',
        deviceId: 'dev',
        seq: 1,
        createdAt: Date.now(),
        campaignProgress: { bestCombo: -10 }
      })).toThrow();
    });
  });
});
