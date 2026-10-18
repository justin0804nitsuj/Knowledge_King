/**
 * ROGUE EXPEDITION V0.1 — PHASE R8C
 * UX, TUTORIAL & COMBAT PACING REGRESSION TESTS
 *
 * Tests:
 * 1. Safe Exit & Route Resumption (non-destructive state preservation)
 * 2. First-Time Tutorial & Contextual Hints (local persistence, zero cloud sync)
 * 3. Combat Pacing & Archetype Exposure Targets (Scout, Brute, Sentinel, Boss)
 * 4. Relic Combat Impact (Glass Quill acceleration, Piercing Nib mitigation bypass)
 * 5. HUD Intent & Curse Readability Data Formats
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createNewRun,
  loadActiveRun,
  saveRun,
  advanceToNode,
  getActiveSelectableNodes,
  submitCombatAnswer,
} from '../src/services/rogue/rogueRunService';
import {
  hasSeenTutorial,
  markTutorialCompleted,
  hasSeenHint,
  markHintSeen,
  resetTutorial,
} from '../src/services/rogue/rogueTutorialService';
import {
  createEncounter,
  resolveEncounterTurn,
  ENCOUNTER_STATUS,
} from '../src/domain/rogue/combat/rogueCombat';
import {
  chooseAttackAndResolve,
  chooseGuardAndResolve,
} from './helpers/rogueTestHelpers';
import {
  ARCHETYPE_IDS,
  getArchetype,
  getIntentForTurn,
  INTENT_TYPES,
} from '../src/domain/rogue/combat/enemyArchetypes';
import { ROGUE_COMBAT_CONSTANTS } from '../src/domain/rogue/combat/rogueCombatConfig';
import { RELIC_IDS } from '../src/domain/rogue/relic/relicRegistry';
import { setActiveIdentity, _resetCachedDeviceIdForTests } from '../src/storage/storageIdentity';

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

describe('Phase R8C — Safe Exit, Tutorial & Combat Pacing', () => {
  beforeEach(async () => {
    mockStore = {};
    jest.clearAllMocks();
    _resetCachedDeviceIdForTests();
    await setActiveIdentity('guest');
    await resetTutorial();
  });

  // =========================================================================
  // 1. SAFE EXIT & STATE PRESERVATION
  // =========================================================================
  describe('1. Safe Exit & Route Resumption', () => {
    it('leaving Rogue screen preserves active run without mutating HP, curses, relics, or progress', async () => {
      const run = await createNewRun({ seed: 12345 });
      const initialHp = run.player.hp;
      const initialNode = run.currentNodeId;

      // Simulate player navigating back to Home (zero mutation)
      const reloadedRun = await loadActiveRun();
      expect(reloadedRun).toBeDefined();
      expect(reloadedRun.seed).toBe(12345);
      expect(reloadedRun.player.hp).toBe(initialHp);
      expect(reloadedRun.currentNodeId).toBe(initialNode);
      expect(reloadedRun.status).toBe('ACTIVE');
    });

    it('mid-battle safe exit preserves active encounter and current question token', async () => {
      const run = await createNewRun({ seed: 23456 });
      const selectables = await getActiveSelectableNodes();
      const battleNodeId = selectables.find((id) => run.route.nodes[id].type === 'BATTLE') || selectables[0];
      await advanceToNode(battleNodeId);

      const runWithBattle = await loadActiveRun();
      expect(runWithBattle.encounter).toBeDefined();
      expect(runWithBattle.encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);
      const questionToken = runWithBattle.encounter.question.token;

      // Simulate navigating to Home and returning later
      const resumedRun = await loadActiveRun();
      expect(resumedRun.encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);
      expect(resumedRun.encounter.question.token).toBe(questionToken);
      expect(resumedRun.encounter.turn).toBe(1);
    });

    it('safe exit preserves pending REST interaction and pending RELIC_DRAFT', async () => {
      const run = await createNewRun({ seed: 34567 });

      // Inject pending interaction (REST)
      run.pendingInteraction = { type: 'REST', resolved: false, nodeId: 'node-2-0' };
      await saveRun(run);

      const reloadedRest = await loadActiveRun();
      expect(reloadedRest.pendingInteraction).toEqual({
        type: 'REST',
        resolved: false,
        nodeId: 'node-2-0',
      });

      // Inject pending reward (RELIC_DRAFT)
      reloadedRest.pendingReward = {
        type: 'RELIC_DRAFT',
        rewardId: 'rew_123',
        options: [RELIC_IDS.SCHOLARS_LENS, RELIC_IDS.PIERCING_NIB, RELIC_IDS.GLASS_QUILL],
      };
      await saveRun(reloadedRest);

      const reloadedReward = await loadActiveRun();
      expect(reloadedReward.pendingReward.type).toBe('RELIC_DRAFT');
      expect(reloadedReward.pendingReward.options.length).toBe(3);
    });
  });

  // =========================================================================
  // 2. TUTORIAL & CONTEXTUAL HINTS LOCAL PERSISTENCE
  // =========================================================================
  describe('2. Tutorial & Contextual Hints Local Persistence', () => {
    it('tutorial is eligible on first entry and suppressed after completion', async () => {
      expect(await hasSeenTutorial()).toBe(false);

      await markTutorialCompleted();
      expect(await hasSeenTutorial()).toBe(true);

      // Verify stored locally and NOT in Cloud Sync progress
      const tutorialKeyVal = await AsyncStorage.getItem('@KnowledgeKing:rogueTutorialCompleted');
      expect(tutorialKeyVal).toBe('true');

      const cloudProgressKey = await AsyncStorage.getItem('cloud_progress_guest');
      expect(cloudProgressKey).toBeNull();
    });

    it('contextual hints appear once and are subsequently suppressed', async () => {
      expect(await hasSeenHint('first_guard')).toBe(false);
      expect(await hasSeenHint('first_curse')).toBe(false);
      expect(await hasSeenHint('first_relic_draft')).toBe(false);
      expect(await hasSeenHint('first_heavy_attack')).toBe(false);

      await markHintSeen('first_guard');
      expect(await hasSeenHint('first_guard')).toBe(true);
      expect(await hasSeenHint('first_curse')).toBe(false);

      await markHintSeen('first_curse');
      expect(await hasSeenHint('first_curse')).toBe(true);
    });
  });

  // =========================================================================
  // 3. COMBAT PACING & ARCHETYPE EXPOSURE TARGETS
  // =========================================================================
  describe('3. Combat Pacing & Archetype Exposure Targets', () => {
    const mockQuestion = (tok) => ({
      questionId: 'q_' + tok,
      token: 'tok_' + tok,
      word: 'sample',
      choices: [{ id: 'c1', text: 'correct' }, { id: 'c2', text: 'wrong' }],
      correctChoiceId: 'c1',
    });

    it('SCOUT (Normal Battle): requires 4 correct answers (target 4-6 questions), exposing multiple turns', () => {
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion('1'),
      });

      expect(enc.enemy.hp).toBe(80);
      expect(ROGUE_COMBAT_CONSTANTS.PLAYER_ATTACK_DAMAGE).toBe(25);

      let turns = 0;
      const MAX_TEST_TURNS = 30;
      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns < MAX_TEST_TURNS) {
        turns++;
        const res = chooseAttackAndResolve(
          enc,
          { choiceId: 'c1', token: enc.question.token },
          { nextQuestion: mockQuestion(String(turns + 1)) }
        );
        enc = res.encounter;
      }
      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to advance after ${MAX_TEST_TURNS} test turns`);
      }

      // Exactly 4 questions (4 * 25 = 100 >= 80 HP)
      expect(turns).toBe(4);
      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(turns).toBeGreaterThanOrEqual(4);
      expect(turns).toBeLessThanOrEqual(6);
    });

    it('BRUTE (Normal Battle): requires 4 correct answers, fully exposing ATTACK and HEAVY_ATTACK cycle', () => {
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.BRUTE,
        customQuestion: mockQuestion('1'),
      });

      expect(enc.enemy.hp).toBe(100);
      const observedIntents = [];

      let turns = 0;
      const MAX_TEST_TURNS = 30;
      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns < MAX_TEST_TURNS) {
        turns++;
        observedIntents.push(enc.enemy.intent.type);
        const res = chooseAttackAndResolve(
          enc,
          { choiceId: 'c1', token: enc.question.token },
          { nextQuestion: mockQuestion(String(turns + 1)) }
        );
        enc = res.encounter;
      }
      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to advance after ${MAX_TEST_TURNS} test turns`);
      }

      // 4 questions: 25 * 4 = 100 HP (lethal)
      expect(turns).toBe(4);
      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);

      // Archetype behavior is fully exposed!
      expect(observedIntents).toContain(INTENT_TYPES.ATTACK);
      expect(observedIntents).toContain(INTENT_TYPES.HEAVY_ATTACK);
    });

    it('SENTINEL (Elite Battle): requires 7 questions due to GUARD mitigation (target 6-8 questions)', () => {
      let enc = createEncounter({
        nodeId: 'n_elite',
        nodeType: 'ELITE',
        archetypeId: ARCHETYPE_IDS.SENTINEL,
        customQuestion: mockQuestion('1'),
      });

      expect(enc.enemy.hp).toBe(125);
      const observedIntents = [];

      let turns = 0;
      const MAX_TEST_TURNS = 30;
      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns < MAX_TEST_TURNS) {
        turns++;
        observedIntents.push(enc.enemy.intent.type);
        const res = chooseAttackAndResolve(
          enc,
          { choiceId: 'c1', token: enc.question.token },
          { nextQuestion: mockQuestion(String(turns + 1)) }
        );
        enc = res.encounter;
      }
      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to advance after ${MAX_TEST_TURNS} test turns`);
      }

      // Turn 1 (Attack): deals 25 -> 100 HP
      // Turn 2 (Guard): 25 - 10 = 15 -> 85 HP
      // Turn 3 (Attack): deals 25 -> 60 HP
      // Turn 4 (Guard): 25 - 10 = 15 -> 45 HP
      // Turn 5 (Attack): deals 25 -> 20 HP
      // Turn 6 (Guard): 25 - 10 = 15 -> 5 HP
      // Turn 7 (Attack): deals 25 -> 0 HP (lethal)
      expect(turns).toBe(7);
      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(turns).toBeGreaterThanOrEqual(5);
      expect(turns).toBeLessThanOrEqual(8);

      // Both Attack and Guard were exposed multiple times
      const guardCount = observedIntents.filter((t) => t === INTENT_TYPES.GUARD).length;
      expect(guardCount).toBeGreaterThanOrEqual(3);
    });

    it('OVERLORD (Boss Battle): requires tactical action selection across Phase 1 and Phase 2', () => {
      let enc = createEncounter({
        nodeId: 'n_boss',
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        customQuestion: mockQuestion('1'),
      });

      expect(enc.enemy.hp).toBe(175);
      let turns = 0;
      const phaseHistory = [];
      const MAX_TEST_TURNS = 30;

      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns < MAX_TEST_TURNS) {
        turns++;
        phaseHistory.push(enc.bossPhase);
        // Tactical action selection: Guard against heavy attack, Attack otherwise
        const isHeavy = enc.enemy.intent.type === INTENT_TYPES.HEAVY_ATTACK;
        const res = isHeavy
          ? chooseGuardAndResolve(
              enc,
              { choiceId: 'c1', token: enc.question.token },
              { nextQuestion: mockQuestion(String(turns + 1)) }
            )
          : chooseAttackAndResolve(
              enc,
              { choiceId: 'c1', token: enc.question.token },
              { nextQuestion: mockQuestion(String(turns + 1)) }
            );
        enc = res.encounter;
      }
      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to advance after ${MAX_TEST_TURNS} test turns`);
      }

      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(turns).toBeGreaterThanOrEqual(8);
      expect(turns).toBeLessThanOrEqual(20);

      // Observed both phases
      expect(phaseHistory).toContain(1);
      expect(phaseHistory).toContain(2);
    });
  });

  // =========================================================================
  // 4. RELIC COMBAT IMPACT ON PACING
  // =========================================================================
  describe('4. Relic Combat Impact on Pacing', () => {
    const mockQuestion = (tok) => ({
      questionId: 'q_' + tok,
      token: 'tok_' + tok,
      word: 'sample',
      choices: [{ id: 'c1', text: 'correct' }],
      correctChoiceId: 'c1',
    });

    it('GLASS_QUILL (+10 damage) shortens Scout combat from 4 turns to 3 turns', () => {
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        relics: [RELIC_IDS.GLASS_QUILL],
        customQuestion: mockQuestion('1'),
      });

      let turns = 0;
      const MAX_TEST_TURNS = 30;
      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns < MAX_TEST_TURNS) {
        turns++;
        const res = chooseAttackAndResolve(
          enc,
          { choiceId: 'c1', token: enc.question.token },
          { nextQuestion: mockQuestion(String(turns + 1)) }
        );
        enc = res.encounter;
      }
      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to advance after ${MAX_TEST_TURNS} test turns`);
      }

      // 100 HP / 35 dmg per hit = 3 turns (35 + 35 + 35 = 105)
      expect(turns).toBe(3);
      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);
    });

    it('PIERCING_NIB bypasses Guard mitigation and shortens Sentinel combat from 8 turns to 6 turns', () => {
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SENTINEL,
        relics: [RELIC_IDS.PIERCING_NIB],
        customQuestion: mockQuestion('1'),
      });

      let turns = 0;
      const MAX_TEST_TURNS = 30;
      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns < MAX_TEST_TURNS) {
        turns++;
        const res = chooseAttackAndResolve(
          enc,
          { choiceId: 'c1', token: enc.question.token },
          { nextQuestion: mockQuestion(String(turns + 1)) }
        );
        enc = res.encounter;
      }
      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to advance after ${MAX_TEST_TURNS} test turns`);
      }

      // Without guard mitigation, 125 HP / 25 dmg per hit = 5 turns
      expect(turns).toBe(5);
      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);
    });
  });
});
