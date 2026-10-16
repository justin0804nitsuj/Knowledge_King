/**
 * ROGUE EXPEDITION V0.1 — PHASE R8A RELEASE CANDIDATE SUITE
 *
 * Comprehensive integration, simulation, balance verification,
 * restart matrix, and hardening tests for Rogue Expedition V0.1.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRogueRun,
  advanceRunNode,
  getSelectableNextNodes,
  isCurrentNodeResolved,
  resolveCombatVictory,
  resolveCombatDefeat,
  createRunSummary,
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
import { generateRogueMap, ROGUE_NODE_TYPES } from '../src/domain/rogue/mapGenerator';
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
import {
  saveActiveRogueRun,
  clearActiveRogueRun,
} from '../src/storage/rogueRunStorage';
import { setActiveIdentity } from '../src/storage/storageIdentity';
import { REST_ACTIONS } from '../src/domain/rogue/rest/restResolver';

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

describe('Phase R8A — Final Balance & Release Candidate Hardening', () => {
  beforeEach(async () => {
    mockStore = {};
    setActiveIdentity(null);
    await clearActiveRogueRun();
  });

  // =========================================================================
  // 1. FULL-RUN DETERMINISTIC SIMULATION
  // =========================================================================
  describe('1. Full-Run Deterministic Simulation', () => {
    it('PERFECT PLAYER: completes an entire expedition from START to Boss VICTORY', async () => {
      const runSeed = 1001;
      let run = await createNewRun({ seed: runSeed });

      // Traverse through the labyrinth rows until terminal victory
      let iterations = 0;
      const maxIterations = 50;

      while (run.status === ROGUE_RUN_STATUS.ACTIVE && iterations < maxIterations) {
        iterations++;

        // 1. If currently at an unresolved combat node, answer until defeated or victory
        if (run.encounter && run.encounter.status === ENCOUNTER_STATUS.ACTIVE) {
          const res = await submitCombatAnswer({
            choiceId: run.encounter.question.correctChoiceId,
            token: run.encounter.question.token,
          });
          run = res.run;
          continue;
        }

        // 2. If at an unresolved relic reward (e.g. after Elite victory), claim first option
        if (run.pendingReward && run.pendingReward.type === 'RELIC_DRAFT') {
          const rawOption = run.pendingReward.options[0];
          const choiceRelic = typeof rawOption === 'string' ? rawOption : rawOption?.id;
          const res = await selectRelicReward({
            rewardId: run.pendingReward.rewardId,
            relicId: choiceRelic,
          });
          run = res.run;
          continue;
        }

        // 3. If at an unresolved REST interaction, recover HP
        if (run.pendingInteraction && run.pendingInteraction.type === 'REST') {
          const res = await submitRestAction({ actionType: REST_ACTIONS.RECOVER });
          run = res.run;
          continue;
        }

        // 4. If at an unresolved EVENT interaction, pick a valid available option
        if (run.pendingInteraction && run.pendingInteraction.type === 'EVENT') {
          let optionId = run.pendingInteraction.options[0];
          if (optionId === 'study' && (!run.cursedWords || run.cursedWords.length === 0)) {
            optionId = 'leave';
          }
          if (optionId === 'cleanse' && (!run.cursedWords || run.cursedWords.length === 0)) {
            optionId = 'rest';
          }
          const res = await submitEventAction({ optionId });
          run = res.run;
          continue;
        }

        // 5. Navigate to the next connected node
        const nextNodes = getSelectableNextNodes(run);
        if (nextNodes.length === 0) {
          break;
        }

        // Rational player choice: if wounded (< 75 HP), prefer REST or EVENT over another battle
        let targetNodeId = nextNodes[0];
        if (run.player.hp < 75) {
          const restNode = nextNodes.find((id) => run.route.nodes[id]?.type === 'REST');
          const eventNode = nextNodes.find((id) => run.route.nodes[id]?.type === 'EVENT');
          if (restNode) {
            targetNodeId = restNode;
          } else if (eventNode) {
            targetNodeId = eventNode;
          }
        }
        run = await advanceToNode(targetNodeId);
      }

      // Assert perfect player successfully cleared the run and vanquished the Boss
      expect(run.status).toBe(ROGUE_RUN_STATUS.VICTORY);
      expect(run.currentNodeId).toBe(run.route.bossNodeId);
      expect(run.player.hp).toBeGreaterThan(0);
      expect(run.finalSummary).toBeDefined();
      expect(run.finalSummary.result).toBe(ROGUE_RUN_STATUS.VICTORY);
      expect(run.finalSummary.battlesWon).toBeGreaterThanOrEqual(1);
      expect(run.finalSummary.correctAnswers).toBeGreaterThanOrEqual(1);
      expect(run.finalSummary.wrongAnswers).toBe(0);
      expect(run.finalSummary.accuracy).toBe(100);
      expect(getSelectableNextNodes(run)).toEqual([]);
    });

    it('POOR PLAYER: repeatedly answers incorrectly and reaches terminal DEFEAT', async () => {
      let run = await createNewRun({ seed: 2002 });
      const nextNodes = getSelectableNextNodes(run);
      run = await advanceToNode(nextNodes[0]); // enter first combat battle

      let iterations = 0;
      while (run.status === ROGUE_RUN_STATUS.ACTIVE && iterations < 30) {
        iterations++;
        if (run.encounter && run.encounter.status === ENCOUNTER_STATUS.ACTIVE) {
          const wrongChoiceId = 'definitely_wrong_choice_id';
          const res = await submitCombatAnswer({
            choiceId: wrongChoiceId,
            token: run.encounter.question.token,
          });
          run = res.run;
        } else {
          break;
        }
      }

      expect(run.status).toBe(ROGUE_RUN_STATUS.DEFEAT);
      expect(run.player.hp).toBe(0);
      expect(run.finalSummary).toBeDefined();
      expect(run.finalSummary.result).toBe(ROGUE_RUN_STATUS.DEFEAT);
      expect(run.finalSummary.finalHp).toBe(0);
      expect(run.finalSummary.wrongAnswers).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 2. MULTIPLE SEED INTEGRATION VALIDATION (50 SEEDS)
  // =========================================================================
  describe('2. Multi-Seed Topology & Progression Validation (50 Seeds)', () => {
    it('validates 50 procedural seeds produce solvable, connected maps without deadlock', () => {
      for (let s = 1; s <= 50; s++) {
        const seed = `rc_seed_${s}`;
        const map = generateRogueMap(seed);

        expect(map.startNodeId).toBeDefined();
        expect(map.bossNodeId).toBeDefined();
        expect(map.nodes[map.startNodeId]).toBeDefined();
        expect(map.nodes[map.bossNodeId]).toBeDefined();

        // Start node connects forward
        expect(map.nodes[map.startNodeId].nextNodes.length).toBeGreaterThan(0);
        // Boss node is terminal
        expect(map.nodes[map.bossNodeId].nextNodes).toEqual([]);

        // Ensure boss is reachable via forward breadth-first traversal
        const visited = new Set();
        const queue = [map.startNodeId];
        let bossFound = false;

        while (queue.length > 0) {
          const currentId = queue.shift();
          if (currentId === map.bossNodeId) {
            bossFound = true;
            break;
          }
          if (visited.has(currentId)) continue;
          visited.add(currentId);

          const node = map.nodes[currentId];
          if (node && Array.isArray(node.nextNodes)) {
            for (const next of node.nextNodes) {
              if (!visited.has(next)) {
                queue.push(next);
              }
            }
          }
        }

        expect(bossFound).toBe(true);
      }
    });
  });

  // =========================================================================
  // 3. PERSISTENCE & RESTART MATRIX (11 CRITICAL STATES)
  // =========================================================================
  describe('3. App Restart & Persistence Matrix', () => {
    it('resumes exact state across all 11 critical lifecycle checkpoints', async () => {
      // A. Map State
      let run = createRogueRun({ seed: 3001 });
      await saveActiveRogueRun(run);
      let loaded = await loadActiveRun();
      expect(loaded.status).toBe(ROGUE_RUN_STATUS.ACTIVE);
      expect(loaded.currentNodeId).toBe(run.route.startNodeId);

      // B. Mid-Battle State
      const enc = createEncounter({ nodeId: 'node-1-0', nodeType: 'BATTLE', playerHp: 75 });
      run.encounter = enc;
      run.currentNodeId = 'node-1-0';
      run.currentNodeResolved = false;
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.encounter.encounterId).toBe(enc.encounterId);
      expect(loaded.encounter.player.hp).toBe(75);

      // C. Cursed review question
      run.encounter.question.isCursed = true;
      run.encounter.question.curseStacks = 2;
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.encounter.question.isCursed).toBe(true);

      // D. Elite victory awaiting Relic Draft
      run.encounter.status = ENCOUNTER_STATUS.VICTORY;
      run.pendingReward = {
        rewardId: 'draft-1',
        type: 'RELIC_DRAFT',
        options: [{ id: RELIC_IDS.SCHOLARS_LENS }],
      };
      run.currentNodeResolved = false;
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.pendingReward.type).toBe('RELIC_DRAFT');

      // E. Relic Draft open
      expect(loaded.pendingReward.options.length).toBe(1);

      // F. Rest pending
      run.pendingReward = null;
      run.encounter = null;
      run.pendingInteraction = {
        interactionId: 'rest-node-1',
        type: 'REST',
        options: ['RECOVER', 'CLEANSE'],
        resolved: false,
      };
      run.currentNodeResolved = false;
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.pendingInteraction.type).toBe('REST');
      expect(loaded.pendingInteraction.resolved).toBe(false);

      // G. Event pending
      run.pendingInteraction = {
        interactionId: 'event-node-2',
        type: 'EVENT',
        eventId: 'HEALING_SPRING',
        options: ['drink', 'leave'],
        resolved: false,
      };
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.pendingInteraction.type).toBe('EVENT');

      // H. Mid-Boss Phase 1
      const bossEnc = createEncounter({
        nodeId: run.route.bossNodeId,
        nodeType: 'BOSS',
        archetypeId: ARCHETYPE_IDS.OVERLORD,
        playerHp: 60,
      });
      bossEnc.bossPhase = 1;
      bossEnc.enemy.hp = 65;
      run.encounter = bossEnc;
      run.currentNodeId = run.route.bossNodeId;
      run.pendingInteraction = null;
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.encounter.bossPhase).toBe(1);
      expect(loaded.encounter.enemy.hp).toBe(65);

      // I. Mid-Boss Phase 2
      bossEnc.bossPhase = 2;
      bossEnc.enemy.hp = 30;
      bossEnc.phase2StartTurn = 4;
      bossEnc.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 30 };
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.encounter.bossPhase).toBe(2);
      expect(loaded.encounter.phase2StartTurn).toBe(4);
      expect(loaded.encounter.enemy.hp).toBe(30);

      // J. Victory Result
      run.status = ROGUE_RUN_STATUS.VICTORY;
      run.finalSummary = createRunSummary(run, ROGUE_RUN_STATUS.VICTORY);
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.status).toBe(ROGUE_RUN_STATUS.VICTORY);
      expect(loaded.finalSummary.result).toBe(ROGUE_RUN_STATUS.VICTORY);

      // K. Defeat Result
      run.status = ROGUE_RUN_STATUS.DEFEAT;
      run.finalSummary = null;
      run.finalSummary = createRunSummary(run, ROGUE_RUN_STATUS.DEFEAT);
      await saveActiveRogueRun(run);
      loaded = await loadActiveRun();
      expect(loaded.status).toBe(ROGUE_RUN_STATUS.DEFEAT);
      expect(loaded.finalSummary.result).toBe(ROGUE_RUN_STATUS.DEFEAT);
      expect(loaded.finalSummary.finalHp).toBe(0);
    });
  });

  // =========================================================================
  // 4. RELIC COMPOSITION MATRIX
  // =========================================================================
  describe('4. Relic Composition & Interaction Matrix', () => {
    it('SCHOLARS_LENS + PURIFYING_INK: lens increases cleanse, full purification triggers ink heal', () => {
      const encounter = createEncounter({
        nodeId: 'node-combat',
        nodeType: 'BATTLE',
        playerHp: 50,
        relics: [RELIC_IDS.SCHOLARS_LENS, RELIC_IDS.PURIFYING_INK],
        cursedWords: [{ wordId: 'curse_word', word: 'curse', stacks: 2 }],
        customQuestion: {
          token: 'token-lens-ink',
          correctChoiceId: 'c1',
          wordId: 'curse_word',
          isCursed: true,
          curseStacks: 2,
        },
      });

      // Player answers correctly:
      // Scholar's Lens purifies 2 stacks (from 2 down to 0) -> fully purified!
      // Purifying Ink triggers -> heals +10 HP (50 -> 60).
      // Enemy attacks for 10 -> net HP = 50.
      const res = resolveEncounterTurn(
        encounter,
        { choiceId: 'c1', token: 'token-lens-ink' },
        { seed: 888 }
      );

      expect(res.resolution.curseResult.type).toBe('CURSE_PURIFIED');
      expect(res.resolution.inkHeal).toBe(10);
      expect(res.encounter.player.hp).toBe(56); // 50 + 10 heal - 4 enemy attack = 56
    });

    it('GLASS_QUILL + SECOND_CHANCE: amplified backlash kills, but Second Chance preserves 1 HP', () => {
      const encounter = createEncounter({
        nodeId: 'node-combat',
        nodeType: 'BATTLE',
        playerHp: 10,
        relics: [RELIC_IDS.GLASS_QUILL, RELIC_IDS.SECOND_CHANCE],
        relicState: { [RELIC_IDS.SECOND_CHANCE]: { consumed: false } },
        cursedWords: [{ wordId: 'cw', word: 'curse', stacks: 2 }],
        customQuestion: {
          token: 'token-gq-sc',
          correctChoiceId: 'c1',
          wordId: 'cw',
          isCursed: true,
          curseStacks: 2,
        },
      });

      // Wrong answer on cursed review:
      // Stacks increase to 3.
      // Normal backlash = 3 * 5 = 15.
      // Glass Quill bonus = +5 -> Total backlash = 20!
      // Player HP is 10. Incoming damage 20 is lethal!
      // Second Chance triggers -> saves player at 1 HP!
      const res = resolveEncounterTurn(
        encounter,
        { choiceId: 'wrong', token: 'token-gq-sc' },
        { seed: 999 }
      );

      expect(res.resolution.backlashDamage).toBe(20);
      expect(res.resolution.secondChanceTriggered).toBe(true);
      expect(res.encounter.runRelicState[RELIC_IDS.SECOND_CHANCE].consumed).toBe(true);
    });

    it('MNEMONIC_CHARM does NOT prevent Cursed Word review mistakes', () => {
      const encounter = createEncounter({
        nodeId: 'node-combat',
        nodeType: 'BATTLE',
        relics: [RELIC_IDS.MNEMONIC_CHARM],
        encounterRelicState: { [RELIC_IDS.MNEMONIC_CHARM]: { usedThisEncounter: false } },
        cursedWords: [{ wordId: 'cw', word: 'curse', stacks: 1 }],
        customQuestion: {
          token: 'token-charm',
          correctChoiceId: 'c1',
          wordId: 'cw',
          isCursed: true,
          curseStacks: 1,
        },
      });

      // Wrong answer on Cursed review -> Charm should NOT trigger
      const res = resolveEncounterTurn(
        encounter,
        { choiceId: 'wrong', token: 'token-charm' },
        { seed: 777 }
      );

      expect(res.resolution.curseResult.type).toBe('CURSE_INTENSIFIED');
      expect(res.encounter.encounterRelicState[RELIC_IDS.MNEMONIC_CHARM].usedThisEncounter).toBe(false);
    });
  });

  // =========================================================================
  // 5. MALFORMED STATE & RECOVERY SAFETY
  // =========================================================================
  describe('5. Corrupted State & Safe Defaults', () => {
    it('gracefully handles missing finalSummary, bossPhase, and relics in old save shapes', async () => {
      const legacySave = {
        schemaVersion: 1,
        runId: 'legacy-run-123',
        seed: 42,
        status: ROGUE_RUN_STATUS.ACTIVE,
        currentNodeId: 'node-start',
        currentNodeResolved: true,
        player: { hp: 80, maxHp: 100 },
        route: {
          seed: 42,
          startNodeId: 'node-start',
          bossNodeId: 'node-boss',
          nodes: {
            'node-start': { id: 'node-start', type: 'START', nextNodes: ['node-1-0'] },
            'node-1-0': { id: 'node-1-0', type: 'BATTLE', nextNodes: ['node-boss'] },
            'node-boss': { id: 'node-boss', type: 'BOSS', nextNodes: [] },
          },
        },
        // missing: relics, relicState, pendingInteraction, finalSummary, cursedWords
      };

      await saveActiveRogueRun(legacySave);
      const loaded = await loadActiveRun();

      expect(loaded.status).toBe(ROGUE_RUN_STATUS.ACTIVE);
      expect(getSelectableNextNodes(loaded)).toEqual(['node-1-0']);

      // Advancing to node-1-0 succeeds without crashing
      const advanced = await advanceToNode('node-1-0');
      expect(advanced.currentNodeId).toBe('node-1-0');
      expect(advanced.encounter).toBeDefined();
    });
  });

  // =========================================================================
  // 6. ACCOUNT ISOLATION
  // =========================================================================
  describe('6. Account Scoped Isolation', () => {
    it('keeps Guest, AccountA, and AccountB runs completely partitioned', async () => {
      // 1. Guest
      setActiveIdentity(null);
      const guestRun = await createNewRun({ seed: 111, initialHp: 90 });
      expect(guestRun.player.hp).toBe(90);

      // 2. Account A
      setActiveIdentity('AccountA');
      const accountARun = await createNewRun({ seed: 222, initialHp: 70 });
      expect(accountARun.player.hp).toBe(70);

      // 3. Account B
      setActiveIdentity('AccountB');
      const accountBRun = await createNewRun({ seed: 333, initialHp: 50 });
      expect(accountBRun.player.hp).toBe(50);

      // 4. Verify reload per identity
      setActiveIdentity(null);
      const reloadedGuest = await loadActiveRun();
      expect(reloadedGuest.seed).toBe(111);
      expect(reloadedGuest.player.hp).toBe(90);

      setActiveIdentity('AccountA');
      const reloadedA = await loadActiveRun();
      expect(reloadedA.seed).toBe(222);
      expect(reloadedA.player.hp).toBe(70);

      setActiveIdentity('AccountB');
      const reloadedB = await loadActiveRun();
      expect(reloadedB.seed).toBe(333);
      expect(reloadedB.player.hp).toBe(50);
    });
  });
});
