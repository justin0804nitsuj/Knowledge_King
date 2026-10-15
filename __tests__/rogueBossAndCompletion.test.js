/**
 * ROGUE EXPEDITION V0.1 — PHASE R7 TESTS
 * BOSS PHASES, RUN LIFECYCLE (VICTORY/DEFEAT), AND FINAL RUN SUMMARY
 */

import {
  createRogueRun,
  advanceRunNode,
  resolveCombatVictory,
  resolveCombatDefeat,
  defeatRogueRun,
  completeRogueRun,
  createRunSummary,
  getSelectableNextNodes,
  isRunActive,
  isRunOver,
  ROGUE_RUN_STATUS,
} from '../src/domain/rogue/rogueRun';
import {
  createEncounter,
  resolveEncounterTurn,
  ENCOUNTER_STATUS,
} from '../src/domain/rogue/combat/rogueCombat';
import {
  ARCHETYPE_IDS,
  INTENT_TYPES,
  getIntentForTurn,
} from '../src/domain/rogue/combat/enemyArchetypes';
import { RELIC_IDS } from '../src/domain/rogue/relic/relicRegistry';
import {
  createNewRun,
  loadActiveRun,
  advanceToNode,
  submitCombatAnswer,
  selectRelicReward,
  submitRestAction,
  submitEventAction,
} from '../src/services/rogue/rogueRunService';
import { clearActiveRogueRun, saveActiveRogueRun } from '../src/storage/rogueRunStorage';

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
  }),
}));

describe('Phase R7 — Boss Phases & Run Completion Lifecycle', () => {
  beforeEach(async () => {
    mockStore = {};
    await clearActiveRogueRun();
  });

  // =========================================================================
  // 1. BOSS PHASE
  // =========================================================================
  describe('1. Boss Phase Transitions & Intent Cycles', () => {
    it('Boss starts in Phase 1 with 80 HP and initial ATTACK 20 intent', () => {
      const bossEncounter = createEncounter({
        nodeId: 'node-boss',
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        seed: 42,
      });

      expect(bossEncounter.archetypeId).toBe(ARCHETYPE_IDS.OVERLORD);
      expect(bossEncounter.enemy.hp).toBe(80);
      expect(bossEncounter.enemy.maxHp).toBe(80);
      expect(bossEncounter.bossPhase).toBe(1);
      expect(bossEncounter.enemy.intent).toEqual({
        type: INTENT_TYPES.ATTACK,
        value: 20,
      });
    });

    it('crosses into Phase 2 when HP <= 40, without altering telegraphed current intent', () => {
      // Create encounter with Boss at 50 HP, telegraphed intent ATTACK 20
      const encounter = createEncounter({
        nodeId: 'node-boss',
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        playerHp: 100,
        customQuestion: {
          token: 'token-turn-1',
          correctChoiceId: 'c1',
          wordId: 'w1',
        },
      });
      encounter.enemy.hp = 50;
      encounter.enemy.intent = { type: INTENT_TYPES.ATTACK, value: 20 };

      // Player answers correctly dealing 20 damage -> Boss HP becomes 30 (<= 40)
      const res = resolveEncounterTurn(
        encounter,
        { choiceId: 'c1', token: 'token-turn-1' },
        { seed: 101 }
      );

      expect(res.resolved).toBe(true);
      // Visible intent ATTACK 20 still executed during turn 1!
      expect(res.resolution.executedIntent).toEqual({
        type: INTENT_TYPES.ATTACK,
        value: 20,
      });
      expect(res.resolution.enemyDamage).toBe(20);
      expect(res.encounter.player.hp).toBe(80); // 100 - 20 = 80
      expect(res.encounter.enemy.hp).toBe(30);

      // Boss transitioned to Phase 2 for upcoming turn
      expect(res.encounter.bossPhase).toBe(2);
      expect(res.resolution.bossPhaseTransition).toBe(true);

      // Next turn intent must follow Phase 2 cycle: first is HEAVY_ATTACK 30!
      expect(res.encounter.enemy.intent).toEqual({
        type: INTENT_TYPES.HEAVY_ATTACK,
        value: 30,
      });
    });

    it('follows the deterministic Phase 2 cycle: HEAVY_ATTACK -> ATTACK -> HEAVY_ATTACK -> GUARD', () => {
      // In Phase 2:
      // Turn 1 in phase -> HEAVY_ATTACK 30
      // Turn 2 in phase -> ATTACK 20
      // Turn 3 in phase -> HEAVY_ATTACK 30
      // Turn 4 in phase -> GUARD 10
      // Turn 5 in phase -> HEAVY_ATTACK 30
      const phase2StartTurn = 4;
      const t1 = getIntentForTurn(ARCHETYPE_IDS.OVERLORD, 4, {
        bossPhase: 2,
        phase2StartTurn,
      });
      const t2 = getIntentForTurn(ARCHETYPE_IDS.OVERLORD, 5, {
        bossPhase: 2,
        phase2StartTurn,
      });
      const t3 = getIntentForTurn(ARCHETYPE_IDS.OVERLORD, 6, {
        bossPhase: 2,
        phase2StartTurn,
      });
      const t4 = getIntentForTurn(ARCHETYPE_IDS.OVERLORD, 7, {
        bossPhase: 2,
        phase2StartTurn,
      });
      const t5 = getIntentForTurn(ARCHETYPE_IDS.OVERLORD, 8, {
        bossPhase: 2,
        phase2StartTurn,
      });

      expect(t1).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 30 });
      expect(t2).toEqual({ type: INTENT_TYPES.ATTACK, value: 20 });
      expect(t3).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 30 });
      expect(t4).toEqual({ type: INTENT_TYPES.GUARD, value: 10 });
      expect(t5).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 30 });
    });

    it('preserves Boss phase, HP, and intent across serialization and reload', async () => {
      const run = createRogueRun({ seed: 777 });
      const bossEncounter = createEncounter({
        nodeId: run.route.bossNodeId,
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        playerHp: 80,
      });
      bossEncounter.bossPhase = 2;
      bossEncounter.phase2StartTurn = 3;
      bossEncounter.enemy.hp = 25;
      bossEncounter.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 30 };

      run.encounter = bossEncounter;
      run.currentNodeId = run.route.bossNodeId;
      run.currentNodeResolved = false;

      await saveActiveRogueRun(run);

      // Reload
      const loaded = await loadActiveRun();
      expect(loaded.encounter.bossPhase).toBe(2);
      expect(loaded.encounter.phase2StartTurn).toBe(3);
      expect(loaded.encounter.enemy.hp).toBe(25);
      expect(loaded.encounter.enemy.intent).toEqual({
        type: INTENT_TYPES.HEAVY_ATTACK,
        value: 30,
      });
    });
  });

  // =========================================================================
  // 2. BOSS COMBAT & RELIC INTERACTIONS
  // =========================================================================
  describe('2. Boss Combat Mechanics & Relics', () => {
    it('applies Glass Quill damage bonus and Piercing Nib against Boss guard', () => {
      const encounter = createEncounter({
        nodeId: 'node-boss',
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        relics: [RELIC_IDS.GLASS_QUILL, RELIC_IDS.PIERCING_NIB],
        customQuestion: {
          token: 'token-gq',
          correctChoiceId: 'c1',
          wordId: 'w1',
        },
      });
      // Set Boss intent to GUARD 10
      encounter.enemy.intent = { type: INTENT_TYPES.GUARD, value: 10 };

      // Correct answer: base 20 + 10 Glass Quill = 30.
      // Correct answer: base 20 + 10 Glass Quill = 30.
      // Guard mitigation 10 pierced by 10 (Piercing Nib) = 0 mitigated.
      // Net player damage = 30.
      const res = resolveEncounterTurn(
        encounter,
        { choiceId: 'c1', token: 'token-gq' },
        { seed: 999 }
      );

      expect(res.resolution.playerDamage).toBe(30);
      expect(res.resolution.guardPierced).toBe(10);
      expect(res.encounter.enemy.hp).toBe(80 - 30);
    });

    it('lethal Boss hit skips enemy counterattack and concludes combat immediately', () => {
      const encounter = createEncounter({
        nodeId: 'node-boss',
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        playerHp: 20,
        customQuestion: {
          token: 'token-lethal',
          correctChoiceId: 'c1',
          wordId: 'w1',
        },
      });
      encounter.enemy.hp = 15;
      encounter.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 30 };

      const res = resolveEncounterTurn(
        encounter,
        { choiceId: 'c1', token: 'token-lethal' },
        { seed: 999 }
      );

      expect(res.encounter.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(res.encounter.enemy.hp).toBe(0);
      expect(res.resolution.enemyDamage).toBe(0);
      expect(res.encounter.player.hp).toBe(20); // Player takes NO damage
      expect(res.resolution.bossPhaseTransition).toBe(false);
    });

    it('Second Chance prevents death during Boss fight and does not recharge', () => {
      const encounter = createEncounter({
        nodeId: 'node-boss',
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        playerHp: 20,
        relics: [RELIC_IDS.SECOND_CHANCE],
        relicState: { [RELIC_IDS.SECOND_CHANCE]: { consumed: false } },
        customQuestion: {
          token: 'token-sc',
          correctChoiceId: 'c1',
          wordId: 'w1',
        },
      });
      // Wrong answer -> 0 damage dealt. Boss hits for 30.
      encounter.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 30 };

      const res = resolveEncounterTurn(
        encounter,
        { choiceId: 'wrong', token: 'token-sc' },
        { seed: 999 }
      );

      expect(res.encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);
      expect(res.encounter.player.hp).toBe(1); // Saved at 1 HP!
      expect(res.encounter.runRelicState[RELIC_IDS.SECOND_CHANCE].consumed).toBe(true);

      // Set enemy intent on turn 2 to an attack
      res.encounter.enemy.intent = { type: INTENT_TYPES.ATTACK, value: 20 };

      // Next lethal hit will result in DEFEAT because Second Chance is consumed
      const res2 = resolveEncounterTurn(
        res.encounter,
        { choiceId: 'wrong2', token: res.encounter.question.token },
        { seed: 1000 }
      );
      expect(res2.encounter.status).toBe(ENCOUNTER_STATUS.DEFEAT);
      expect(res2.encounter.player.hp).toBe(0);
    });
  });

  // =========================================================================
  // 3. RUN VICTORY & DEFEAT LIFECYCLE
  // =========================================================================
  describe('3. Run Victory, Defeat & Node Termination', () => {
    it('Boss victory sets run.status to VICTORY, resolves node, and generates NO relic draft', () => {
      const run = createRogueRun({ seed: 123 });
      run.currentNodeId = run.route.bossNodeId;
      run.currentNodeResolved = false;

      const bossEncounter = createEncounter({
        nodeId: run.route.bossNodeId,
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        playerHp: 65,
      });
      bossEncounter.status = ENCOUNTER_STATUS.VICTORY;
      bossEncounter.enemy.hp = 0;

      const victoryRun = resolveCombatVictory(run, bossEncounter);

      expect(victoryRun.status).toBe(ROGUE_RUN_STATUS.VICTORY);
      expect(victoryRun.currentNodeResolved).toBe(true);
      expect(victoryRun.pendingReward).toBeNull();
      expect(victoryRun.player.hp).toBe(65);
      expect(getSelectableNextNodes(victoryRun)).toEqual([]);
      expect(victoryRun.finalSummary).toBeDefined();
      expect(victoryRun.finalSummary.result).toBe(ROGUE_RUN_STATUS.VICTORY);
    });

    it('ELITE victory generates a relic draft reward whereas BOSS victory never does', () => {
      const run = createRogueRun({ seed: 123 });
      // 1. Mock Elite node
      const eliteNodeId = Object.keys(run.route.nodes).find(
        (id) => run.route.nodes[id].type === 'ELITE'
      );
      run.currentNodeId = eliteNodeId;
      run.currentNodeResolved = false;

      const eliteEncounter = createEncounter({
        nodeId: eliteNodeId,
        nodeType: 'ELITE',
      });
      eliteEncounter.status = ENCOUNTER_STATUS.VICTORY;

      const eliteRun = resolveCombatVictory(run, eliteEncounter);
      expect(eliteRun.pendingReward).not.toBeNull();
      expect(eliteRun.pendingReward.type).toBe('RELIC_DRAFT');

      // 2. Boss node
      run.currentNodeId = run.route.bossNodeId;
      const bossEncounter = createEncounter({
        nodeId: run.route.bossNodeId,
        nodeType: 'BOSS',
      });
      bossEncounter.status = ENCOUNTER_STATUS.VICTORY;

      const bossRun = resolveCombatVictory(run, bossEncounter);
      expect(bossRun.pendingReward).toBeNull();
    });

    it('player death sets run.status to DEFEAT and finalizes the run summary', () => {
      const run = createRogueRun({ seed: 456 });
      const encounter = createEncounter({
        nodeId: 'node-1-0',
        nodeType: 'BATTLE',
        playerHp: 0,
      });
      encounter.status = ENCOUNTER_STATUS.DEFEAT;

      const defeatRun = resolveCombatDefeat(run, encounter);

      expect(defeatRun.status).toBe(ROGUE_RUN_STATUS.DEFEAT);
      expect(defeatRun.player.hp).toBe(0);
      expect(getSelectableNextNodes(defeatRun)).toEqual([]);
      expect(defeatRun.finalSummary).toBeDefined();
      expect(defeatRun.finalSummary.result).toBe(ROGUE_RUN_STATUS.DEFEAT);
    });
  });

  // =========================================================================
  // 4. FINISHED RUN IMMUTABILITY
  // =========================================================================
  describe('4. Finished Run Immutability', () => {
    it('rejects advance, combat answer, relic draft, rest, and event on a VICTORY run', async () => {
      const run = createRogueRun({ seed: 999 });
      run.status = ROGUE_RUN_STATUS.VICTORY;
      run.finalSummary = createRunSummary(run, ROGUE_RUN_STATUS.VICTORY);
      await saveActiveRogueRun(run);

      // 1. Advance
      await expect(advanceToNode('node-1-0')).rejects.toThrow();

      // 2. Combat Answer
      const combatRes = await submitCombatAnswer({
        choiceId: 'c1',
        token: 'any-token',
      });
      expect(combatRes.resolved).toBe(false);
      expect(combatRes.reason).toBe('RUN_NOT_ACTIVE');

      // 3. Relic reward
      const relicRes = await selectRelicReward({
        rewardId: 'rew-1',
        relicId: RELIC_IDS.SCHOLARS_LENS,
      });
      expect(relicRes.success).toBe(false);
      expect(relicRes.reason).toBe('RUN_NOT_ACTIVE');

      // 4. Rest
      const restRes = await submitRestAction({ actionType: 'RECOVER' });
      expect(restRes.success).toBe(false);
      expect(restRes.reason).toBe('RUN_NOT_ACTIVE');

      // 5. Event
      const eventRes = await submitEventAction({ optionId: 'drink' });
      expect(eventRes.success).toBe(false);
      expect(eventRes.reason).toBe('RUN_NOT_ACTIVE');
    });

    it('rejects mutations on a DEFEAT run', async () => {
      const run = createRogueRun({ seed: 888 });
      run.status = ROGUE_RUN_STATUS.DEFEAT;
      run.finalSummary = createRunSummary(run, ROGUE_RUN_STATUS.DEFEAT);
      await saveActiveRogueRun(run);

      const combatRes = await submitCombatAnswer({ choiceId: 'c1', token: 'any' });
      expect(combatRes.resolved).toBe(false);
      expect(combatRes.reason).toBe('RUN_NOT_ACTIVE');

      const restRes = await submitRestAction({ actionType: 'RECOVER' });
      expect(restRes.success).toBe(false);
      expect(restRes.reason).toBe('RUN_NOT_ACTIVE');
    });
  });

  // =========================================================================
  // 5. RUN SUMMARY CREATION & STABILITY
  // =========================================================================
  describe('5. Final Run Summary Creation & Calculations', () => {
    it('creates accurate summary snapshot with safe zero-answer accuracy', () => {
      const run = createRogueRun({ seed: 333 });
      run.relics = [RELIC_IDS.PURIFYING_INK, RELIC_IDS.GLASS_QUILL];
      run.cursedWords = [
        { wordId: 'w1', stacks: 2 },
        { wordId: 'w2', stacks: 0 },
      ];
      run.runStats = {
        battlesWon: 3,
        correctAnswers: 9,
        wrongAnswers: 1,
        nodesVisited: 5,
      };
      run.player.hp = 70;

      const summary = createRunSummary(run, ROGUE_RUN_STATUS.VICTORY);

      expect(summary.result).toBe(ROGUE_RUN_STATUS.VICTORY);
      expect(summary.seed).toBe(333);
      expect(summary.finalHp).toBe(70);
      expect(summary.battlesWon).toBe(3);
      expect(summary.correctAnswers).toBe(9);
      expect(summary.wrongAnswers).toBe(1);
      expect(summary.accuracy).toBe(90); // 9 / 10 = 90%
      expect(summary.relics).toEqual([RELIC_IDS.PURIFYING_INK, RELIC_IDS.GLASS_QUILL]);
      expect(summary.cursesRemaining).toBe(1); // Only w1 has stacks > 0

      // Zero-answer safety
      const zeroRun = createRogueRun({ seed: 1 });
      zeroRun.runStats = { correctAnswers: 0, wrongAnswers: 0 };
      const zeroSummary = createRunSummary(zeroRun, ROGUE_RUN_STATUS.DEFEAT);
      expect(zeroSummary.accuracy).toBe(0);
    });

    it('snapshot remains stable and does not recalculate if already present', () => {
      const run = createRogueRun({ seed: 555 });
      const initialSummary = {
        result: ROGUE_RUN_STATUS.VICTORY,
        seed: 555,
        finalHp: 50,
        accuracy: 100,
        frozen: true,
      };
      run.finalSummary = initialSummary;

      const returned = createRunSummary(run, ROGUE_RUN_STATUS.DEFEAT);
      expect(returned).toBe(initialSummary);
      expect(returned.result).toBe(ROGUE_RUN_STATUS.VICTORY);
    });
  });

  // =========================================================================
  // 6. IDEMPOTENCY
  // =========================================================================
  describe('6. Idempotency on Lethal Submission', () => {
    it('submitting the same lethal answer twice resolves once without duplicating victory', async () => {
      const run = await createNewRun({ seed: 777 });
      const bossEncounter = createEncounter({
        nodeId: run.route.bossNodeId,
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        playerHp: 50,
        customQuestion: {
          token: 'token-lethal-idemp',
          correctChoiceId: 'c1',
          wordId: 'lethal_word',
        },
      });
      bossEncounter.enemy.hp = 10;
      run.currentNodeId = run.route.bossNodeId;
      run.currentNodeResolved = false;
      run.encounter = bossEncounter;
      await saveActiveRogueRun(run);

      // First submission -> Lethal victory
      const res1 = await submitCombatAnswer({
        choiceId: 'c1',
        token: 'token-lethal-idemp',
      });
      expect(res1.resolved).toBe(true);
      expect(res1.run.status).toBe(ROGUE_RUN_STATUS.VICTORY);
      expect(res1.run.runStats.battlesWon).toBe(1);

      // Second submission -> Idempotent no-op (token already resolved or run not active)
      const res2 = await submitCombatAnswer({
        choiceId: 'c1',
        token: 'token-lethal-idemp',
      });
      expect(res2.resolved).toBe(false);
      expect(res2.run.runStats.battlesWon).toBe(1); // NOT incremented twice
    });
  });

  // =========================================================================
  // 7. NEW EXPEDITION RESET
  // =========================================================================
  describe('7. New Expedition Clean Reset', () => {
    it('createNewRun after Victory resets all run-local state without leaks', async () => {
      // 1. Setup finished run with relics, curses, and consumed Second Chance
      const oldRun = createRogueRun({ seed: 101 });
      oldRun.status = ROGUE_RUN_STATUS.VICTORY;
      oldRun.relics = [RELIC_IDS.SECOND_CHANCE, RELIC_IDS.GLASS_QUILL];
      oldRun.relicState = { [RELIC_IDS.SECOND_CHANCE]: { consumed: true } };
      oldRun.cursedWords = [{ wordId: 'ancient_curse', stacks: 3 }];
      oldRun.runStats = { battlesWon: 10, correctAnswers: 20, wrongAnswers: 5 };
      oldRun.finalSummary = createRunSummary(oldRun, ROGUE_RUN_STATUS.VICTORY);
      await saveActiveRogueRun(oldRun);

      // 2. Start brand new run
      const freshRun = await createNewRun({ seed: 202 });

      expect(freshRun.seed).toBe(202);
      expect(freshRun.status).toBe(ROGUE_RUN_STATUS.ACTIVE);
      expect(freshRun.player.hp).toBe(100);
      expect(freshRun.relics).toEqual([]);
      expect(freshRun.relicState).toEqual({});
      expect(freshRun.cursedWords).toEqual([]);
      expect(freshRun.pendingReward).toBeNull();
      expect(freshRun.pendingInteraction).toBeNull();
      expect(freshRun.encounter).toBeNull();
      expect(freshRun.finalSummary).toBeNull();
      expect(freshRun.runStats).toEqual({
        battlesWon: 0,
        correctAnswers: 0,
        wrongAnswers: 0,
        nodesVisited: 1,
      });

      // Storage verification
      const loaded = await loadActiveRun();
      expect(loaded.seed).toBe(202);
      expect(loaded.relics).toEqual([]);
      expect(loaded.cursedWords).toEqual([]);
    });
  });
});
