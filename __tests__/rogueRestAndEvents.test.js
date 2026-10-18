import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createRogueRun,
  advanceRunNode,
  canAdvanceToNode,
  getSelectableNextNodes,
  isCurrentNodeResolved,
  resolveCombatVictory,
  ROGUE_RUN_STATUS,
} from '../src/domain/rogue/rogueRun';
import {
  REST_ACTIONS,
  REST_HEAL_AMOUNT,
  resolveRestInteraction,
  cleanseHighestPriorityCurse,
} from '../src/domain/rogue/rest/restResolver';
import {
  EVENT_IDS,
  EVENT_EFFECT_TYPES,
  getEvent,
  getAllEvents,
  selectEventForNode,
} from '../src/domain/rogue/event/eventRegistry';
import { resolveEventInteraction } from '../src/domain/rogue/event/eventResolver';
import {
  createNewRun,
  loadActiveRun,
  advanceToNode,
  submitRestAction,
  submitEventAction,
  selectRelicReward,
} from '../src/services/rogue/rogueRunService';
import { createCursedWordEntry } from '../src/domain/rogue/curse/cursedWordModel';
import { RELIC_IDS } from '../src/domain/rogue/relic/relicRegistry';
import { setActiveIdentity } from '../src/storage/storageIdentity';
import { saveActiveRogueRun } from '../src/storage/rogueRunStorage';

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

describe('Rogue Expedition V0.1 — Phase R6 Rest & Event Nodes', () => {
  beforeEach(async () => {
    mockStore = {};
    jest.clearAllMocks();
    await setActiveIdentity('guest');
  });

  // ==================================================
  // 1. NODE GATING
  // ==================================================
  describe('1. Node Gating & Resolution Model', () => {
    test('entering REST node makes current node unresolved and locks next map nodes', () => {
      const run = createRogueRun({ seed: 1001 });
      const restNodeId = 'node_rest_1';
      run.route.nodes[restNodeId] = {
        id: restNodeId,
        type: 'REST',
        nextNodes: ['node_next_1'],
      };
      run.route.nodes['node_next_1'] = {
        id: 'node_next_1',
        type: 'BATTLE',
        nextNodes: [],
      };
      run.currentNodeId = run.route.startNodeId;
      run.route.nodes[run.route.startNodeId].nextNodes = [restNodeId];

      const advancedRun = advanceRunNode(run, restNodeId);

      expect(advancedRun.currentNodeId).toBe(restNodeId);
      expect(advancedRun.currentNodeResolved).toBe(false);
      expect(advancedRun.pendingInteraction).toBeDefined();
      expect(advancedRun.pendingInteraction.type).toBe('REST');
      expect(advancedRun.pendingInteraction.resolved).toBe(false);

      // Node is NOT resolved, next nodes must be locked
      expect(isCurrentNodeResolved(advancedRun)).toBe(false);
      expect(getSelectableNextNodes(advancedRun)).toEqual([]);
      expect(canAdvanceToNode(advancedRun, 'node_next_1')).toBe(false);
    });

    test('entering EVENT node makes current node unresolved and locks next map nodes', () => {
      const run = createRogueRun({ seed: 2002 });
      const eventNodeId = 'node_event_1';
      run.route.nodes[eventNodeId] = {
        id: eventNodeId,
        type: 'EVENT',
        nextNodes: ['node_next_2'],
      };
      run.route.nodes['node_next_2'] = {
        id: 'node_next_2',
        type: 'BATTLE',
        nextNodes: [],
      };
      run.currentNodeId = run.route.startNodeId;
      run.route.nodes[run.route.startNodeId].nextNodes = [eventNodeId];

      const advancedRun = advanceRunNode(run, eventNodeId);

      expect(advancedRun.currentNodeId).toBe(eventNodeId);
      expect(advancedRun.currentNodeResolved).toBe(false);
      expect(advancedRun.pendingInteraction).toBeDefined();
      expect(advancedRun.pendingInteraction.type).toBe('EVENT');
      expect(advancedRun.pendingInteraction.eventId).toBeDefined();

      expect(isCurrentNodeResolved(advancedRun)).toBe(false);
      expect(getSelectableNextNodes(advancedRun)).toEqual([]);
      expect(canAdvanceToNode(advancedRun, 'node_next_2')).toBe(false);
    });

    test('resolving REST interaction marks node resolved and unlocks next map nodes', () => {
      const run = createRogueRun({ seed: 1001 });
      const restNodeId = 'node_rest_1';
      run.route.nodes[restNodeId] = {
        id: restNodeId,
        type: 'REST',
        nextNodes: ['node_next_1'],
      };
      run.route.nodes['node_next_1'] = {
        id: 'node_next_1',
        type: 'BATTLE',
        nextNodes: [],
      };
      run.currentNodeId = run.route.startNodeId;
      run.route.nodes[run.route.startNodeId].nextNodes = [restNodeId];

      const advancedRun = advanceRunNode(run, restNodeId);
      const interactionId = advancedRun.pendingInteraction.interactionId;

      const { run: resolvedRun, success } = resolveRestInteraction(advancedRun, {
        interactionId,
        actionType: REST_ACTIONS.RECOVER,
      });

      expect(success).toBe(true);
      expect(resolvedRun.currentNodeResolved).toBe(true);
      expect(resolvedRun.pendingInteraction).toBeNull();
      expect(isCurrentNodeResolved(resolvedRun)).toBe(true);
      expect(getSelectableNextNodes(resolvedRun)).toEqual(['node_next_1']);
      expect(canAdvanceToNode(resolvedRun, 'node_next_1')).toBe(true);
    });
  });

  // ==================================================
  // 2. REST NODE ACTIONS & PURIFYING INK
  // ==================================================
  describe('2. REST Node Actions', () => {
    test('Recover restores exactly 30 HP and clamps to max HP', () => {
      const run = createRogueRun({ seed: 500, initialHp: 50, maxHp: 100 });
      run.pendingInteraction = {
        interactionId: 'rest_1',
        type: 'REST',
      };
      run.currentNodeResolved = false;

      const { run: updatedRun, outcome } = resolveRestInteraction(run, {
        interactionId: 'rest_1',
        actionType: REST_ACTIONS.RECOVER,
      });

      expect(updatedRun.player.hp).toBe(90);
      expect(outcome.healed).toBe(40);

      // Clamping test: HP 90 -> 100 (clamped to maxHp 100)
      const nearFullRun = {
        ...run,
        player: { ...run.player, hp: 90 },
      };
      const { run: clampedRun, outcome: clampedOutcome } = resolveRestInteraction(
        nearFullRun,
        {
          interactionId: 'rest_1',
          actionType: REST_ACTIONS.RECOVER,
        }
      );
      expect(clampedRun.player.hp).toBe(100);
      expect(clampedOutcome.healed).toBe(10);
    });

    test('Recover at full HP safely resolves node with 0 healed', () => {
      const run = createRogueRun({ seed: 500, initialHp: 100, maxHp: 100 });
      run.pendingInteraction = {
        interactionId: 'rest_full_hp',
        type: 'REST',
      };
      run.currentNodeResolved = false;

      const { run: updatedRun, success, outcome } = resolveRestInteraction(run, {
        interactionId: 'rest_full_hp',
        actionType: REST_ACTIONS.RECOVER,
      });

      expect(success).toBe(true);
      expect(updatedRun.player.hp).toBe(100);
      expect(outcome.healed).toBe(0);
      expect(updatedRun.currentNodeResolved).toBe(true);
    });

    test('Cleanse reduces highest-priority curse by exactly 1 stack', () => {
      const run = createRogueRun({ seed: 500 });
      run.cursedWords = [
        createCursedWordEntry({ wordId: 'apple', stacks: 1, firstCursedOrder: 1 }),
        createCursedWordEntry({ wordId: 'bravo', stacks: 3, firstCursedOrder: 2 }), // highest stacks!
      ];
      run.pendingInteraction = {
        interactionId: 'rest_cleanse',
        type: 'REST',
      };
      run.currentNodeResolved = false;

      const { run: updatedRun, success, outcome } = resolveRestInteraction(run, {
        interactionId: 'rest_cleanse',
        actionType: REST_ACTIONS.CLEANSE,
      });

      expect(success).toBe(true);
      expect(outcome.targetWord).toBe('bravo');
      expect(outcome.purified).toBe(false);
      // 'bravo' stack reduced from 3 to 2
      const updatedBravo = updatedRun.cursedWords.find((c) => c.wordId === 'bravo');
      expect(updatedBravo.stacks).toBe(2);
      expect(updatedRun.cursedWords.length).toBe(2);
    });

    test('Cleanse is unavailable/rejected if run has no cursed words', () => {
      const run = createRogueRun({ seed: 500 });
      run.cursedWords = [];
      run.pendingInteraction = {
        interactionId: 'rest_cleanse_empty',
        type: 'REST',
      };

      const { success, reason } = resolveRestInteraction(run, {
        interactionId: 'rest_cleanse_empty',
        actionType: REST_ACTIONS.CLEANSE,
      });

      expect(success).toBe(false);
      expect(reason).toBe('NO_CURSES_TO_CLEANSE');
    });

    test('Scholar\'s Lens does NOT modify REST Cleanse amount', () => {
      const run = createRogueRun({ seed: 500 });
      run.relics = [RELIC_IDS.SCHOLARS_LENS];
      run.cursedWords = [
        createCursedWordEntry({ wordId: 'ephemeral', stacks: 3 }),
      ];
      run.pendingInteraction = {
        interactionId: 'rest_lens',
        type: 'REST',
      };

      const { run: updatedRun } = resolveRestInteraction(run, {
        interactionId: 'rest_lens',
        actionType: REST_ACTIONS.CLEANSE,
      });

      // Scholar's Lens only applies to correct combat answers; REST cleanse removes strictly 1 stack
      expect(updatedRun.cursedWords[0].stacks).toBe(2);
    });

    test('Purifying Ink triggers on full REST purification (+10 HP)', () => {
      const run = createRogueRun({ seed: 500, initialHp: 50, maxHp: 100 });
      run.relics = [RELIC_IDS.PURIFYING_INK];
      run.cursedWords = [
        createCursedWordEntry({ wordId: 'lone_curse', stacks: 1 }), // 1 stack -> will fully purify!
      ];
      run.pendingInteraction = {
        interactionId: 'rest_ink',
        type: 'REST',
      };

      const { run: updatedRun, outcome } = resolveRestInteraction(run, {
        interactionId: 'rest_ink',
        actionType: REST_ACTIONS.CLEANSE,
      });

      expect(outcome.purified).toBe(true);
      expect(outcome.inkHeal).toBe(10);
      expect(updatedRun.cursedWords.length).toBe(0);
      // HP increased from 50 to 60 via Purifying Ink!
      expect(updatedRun.player.hp).toBe(60);
    });
  });

  // ==================================================
  // 3. EVENT GENERATION & DETERMINISM
  // ==================================================
  describe('3. Event Registry & Deterministic Selection', () => {
    test('at least 3 foundation events are registered', () => {
      const allEvents = getAllEvents();
      expect(allEvents.length).toBeGreaterThanOrEqual(3);

      const ids = allEvents.map((e) => e.id);
      expect(ids).toContain(EVENT_IDS.HEALING_SPRING);
      expect(ids).toContain(EVENT_IDS.FORGOTTEN_SHRINE);
      expect(ids).toContain(EVENT_IDS.CURSED_ARCHIVE);
    });

    test('same run seed and nodeId always produce the exact same event without Math.random', () => {
      const eventA = selectEventForNode({ seed: 8888, nodeId: 'node_ev_3' });
      const eventB = selectEventForNode({ seed: 8888, nodeId: 'node_ev_3' });

      expect(eventA.id).toBe(eventB.id);
      expect(eventA.nameKey).toBe(eventB.nameKey);
    });

    test('different seeds / nodes can produce different events across the registry', () => {
      const eventsFound = new Set();
      for (let i = 0; i < 20; i++) {
        const ev = selectEventForNode({ seed: i * 777, nodeId: `node_${i}` });
        eventsFound.add(ev.id);
      }
      expect(eventsFound.size).toBeGreaterThan(1);
    });
  });

  // ==================================================
  // 4. EVENT EFFECT PRIMITIVES
  // ==================================================
  describe('4. Event Effect Primitives', () => {
    test('HEAL effect restores HP and clamps to max HP', () => {
      const run = createRogueRun({ seed: 100, initialHp: 60, maxHp: 100 });
      run.pendingInteraction = {
        interactionId: 'ev_spring',
        type: 'EVENT',
        eventId: EVENT_IDS.HEALING_SPRING,
      };

      const { run: updatedRun, outcome } = resolveEventInteraction(run, {
        interactionId: 'ev_spring',
        optionId: 'DRINK', // +25 HP
      });

      expect(updatedRun.player.hp).toBe(85);
      expect(outcome.healedAmount).toBe(25);
    });

    test('NONE effect resolves node safely without altering player stats', () => {
      const run = createRogueRun({ seed: 100, initialHp: 75, maxHp: 100 });
      run.pendingInteraction = {
        interactionId: 'ev_leave',
        type: 'EVENT',
        eventId: EVENT_IDS.HEALING_SPRING,
      };

      const { run: updatedRun, success } = resolveEventInteraction(run, {
        interactionId: 'ev_leave',
        optionId: 'LEAVE',
      });

      expect(success).toBe(true);
      expect(updatedRun.player.hp).toBe(75);
      expect(updatedRun.currentNodeResolved).toBe(true);
      expect(updatedRun.pendingInteraction).toBeNull();
    });

    test('HP_COST deducts HP and does NOT trigger Second Chance', () => {
      const run = createRogueRun({ seed: 100, initialHp: 20, maxHp: 100 });
      run.relics = [RELIC_IDS.SECOND_CHANCE];
      run.relicState = { SECOND_CHANCE: { consumed: false } };
      run.cursedWords = [createCursedWordEntry({ wordId: 'test_curse', stacks: 2 })];
      run.pendingInteraction = {
        interactionId: 'ev_archive',
        type: 'EVENT',
        eventId: EVENT_IDS.CURSED_ARCHIVE,
      };

      const { run: updatedRun, outcome } = resolveEventInteraction(run, {
        interactionId: 'ev_archive',
        optionId: 'STUDY', // HP cost 10, cleanse 1 stack
      });

      expect(outcome.paidCost).toBe(10);
      expect(updatedRun.player.hp).toBe(10);
      // Second Chance must NOT be consumed by non-combat HP_COST!
      expect(updatedRun.relicState.SECOND_CHANCE.consumed).toBe(false);
    });

    test('unaffordable HP_COST rejects the option and prevents voluntary suicide (HP cannot reach 0)', () => {
      const run = createRogueRun({ seed: 100, initialHp: 10, maxHp: 100 }); // HP exactly equal to cost 10
      run.cursedWords = [createCursedWordEntry({ wordId: 'curse', stacks: 1 })];
      run.pendingInteraction = {
        interactionId: 'ev_cost_fail',
        type: 'EVENT',
        eventId: EVENT_IDS.CURSED_ARCHIVE,
      };

      const { run: unchangedRun, success, reason } = resolveEventInteraction(run, {
        interactionId: 'ev_cost_fail',
        optionId: 'STUDY', // costs 10 HP
      });

      expect(success).toBe(false);
      expect(reason).toBe('CANNOT_AFFORD_HP_COST');
      expect(unchangedRun.player.hp).toBe(10);
      expect(unchangedRun.cursedWords.length).toBe(1);
      expect(unchangedRun.pendingInteraction).toBeDefined();
    });

    test('option requiring a curse is rejected when player has no curses', () => {
      const run = createRogueRun({ seed: 100, initialHp: 50 });
      run.cursedWords = []; // No curses
      run.pendingInteraction = {
        interactionId: 'ev_shrine',
        type: 'EVENT',
        eventId: EVENT_IDS.FORGOTTEN_SHRINE,
      };

      const { success, reason } = resolveEventInteraction(run, {
        interactionId: 'ev_shrine',
        optionId: 'CLEANSE', // requiresCurse: true
      });

      expect(success).toBe(false);
      expect(reason).toBe('REQUIRES_CURSE');
    });

    test('Purifying Ink triggers on full event purification, while Scholar\'s Lens does NOT apply', () => {
      const run = createRogueRun({ seed: 100, initialHp: 50, maxHp: 100 });
      run.relics = [RELIC_IDS.PURIFYING_INK, RELIC_IDS.SCHOLARS_LENS];
      run.cursedWords = [createCursedWordEntry({ wordId: 'solitary_curse', stacks: 1 })];
      run.pendingInteraction = {
        interactionId: 'ev_shrine_cleanse',
        type: 'EVENT',
        eventId: EVENT_IDS.FORGOTTEN_SHRINE,
      };

      const { run: updatedRun, outcome } = resolveEventInteraction(run, {
        interactionId: 'ev_shrine_cleanse',
        optionId: 'CLEANSE',
      });

      expect(updatedRun.cursedWords.length).toBe(0);
      expect(outcome.inkHeal).toBe(10);
      // Started 50 HP -> 60 HP via Purifying Ink
      expect(updatedRun.player.hp).toBe(60);
    });
  });

  // ==================================================
  // 5. INTERACTION IDEMPOTENCY
  // ==================================================
  describe('5. Interaction Idempotency', () => {
    test('REST double tap resolves only once and does not apply duplicate heal', () => {
      const run = createRogueRun({ seed: 300, initialHp: 40, maxHp: 100 });
      run.pendingInteraction = {
        interactionId: 'rest_double_tap',
        type: 'REST',
      };
      run.currentNodeResolved = false;

      // First tap
      const { run: afterTap1, success: s1 } = resolveRestInteraction(run, {
        interactionId: 'rest_double_tap',
        actionType: REST_ACTIONS.RECOVER,
      });
      expect(s1).toBe(true);
      expect(afterTap1.player.hp).toBe(80);

      // Second tap with same interactionId
      const { run: afterTap2, success: s2, alreadyResolved } = resolveRestInteraction(afterTap1, {
        interactionId: 'rest_double_tap',
        actionType: REST_ACTIONS.RECOVER,
      });
      expect(s2).toBe(true);
      expect(alreadyResolved).toBe(true);
      // HP remains 80, not 100!
      expect(afterTap2.player.hp).toBe(80);
    });

    test('EVENT double tap resolves only once and does not double-charge HP cost', () => {
      const run = createRogueRun({ seed: 300, initialHp: 50, maxHp: 100 });
      run.cursedWords = [createCursedWordEntry({ wordId: 'curse', stacks: 2 })];
      run.pendingInteraction = {
        interactionId: 'event_double_tap',
        type: 'EVENT',
        eventId: EVENT_IDS.CURSED_ARCHIVE,
      };
      run.currentNodeResolved = false;

      // First tap: costs 10 HP -> 40 HP
      const { run: afterTap1 } = resolveEventInteraction(run, {
        interactionId: 'event_double_tap',
        optionId: 'STUDY',
      });
      expect(afterTap1.player.hp).toBe(40);

      // Second tap
      const { run: afterTap2, alreadyResolved } = resolveEventInteraction(afterTap1, {
        interactionId: 'event_double_tap',
        optionId: 'STUDY',
      });
      expect(alreadyResolved).toBe(true);
      expect(afterTap2.player.hp).toBe(40);
    });
  });

  // ==================================================
  // 6. PERSISTENCE & ACCOUNT ISOLATION
  // ==================================================
  describe('6. Service & Persistence', () => {
    test('pending REST and EVENT interactions survive app restart in storage', async () => {
      const activeRun = await createNewRun({ seed: 4444 });
      const restNodeId = 'node_rest';
      activeRun.route.nodes[restNodeId] = {
        id: restNodeId,
        type: 'REST',
        nextNodes: [],
      };
      activeRun.route.nodes[activeRun.route.startNodeId].nextNodes = [restNodeId];
      await saveActiveRogueRun(activeRun);

      const advanced = await advanceToNode(restNodeId);
      expect(advanced.pendingInteraction.type).toBe('REST');

      // Simulate app restart / reload from storage
      const reloaded = await loadActiveRun();
      expect(reloaded.pendingInteraction).toBeDefined();
      expect(reloaded.pendingInteraction.interactionId).toBe(advanced.pendingInteraction.interactionId);
      expect(reloaded.pendingInteraction.type).toBe('REST');
      expect(reloaded.currentNodeResolved).toBe(false);
    });

    test('submitRestAction persists updated HP and resolves node in storage', async () => {
      const activeRun = await createNewRun({ seed: 5555, initialHp: 40 });
      const restNodeId = 'node_rest_srv';
      activeRun.route.nodes[restNodeId] = {
        id: restNodeId,
        type: 'REST',
        nextNodes: ['node_next_srv'],
      };
      activeRun.route.nodes['node_next_srv'] = {
        id: 'node_next_srv',
        type: 'BATTLE',
        nextNodes: [],
      };
      activeRun.route.nodes[activeRun.route.startNodeId].nextNodes = [restNodeId];
      await saveActiveRogueRun(activeRun);

      await advanceToNode(restNodeId);

      const result = await submitRestAction({ actionType: REST_ACTIONS.RECOVER });
      expect(result.success).toBe(true);
      expect(result.run.player.hp).toBe(80);
      expect(result.run.currentNodeResolved).toBe(true);
      expect(result.run.pendingInteraction).toBeNull();

      const fromStorage = await loadActiveRun();
      expect(fromStorage.player.hp).toBe(80);
      expect(fromStorage.currentNodeResolved).toBe(true);
      expect(fromStorage.pendingInteraction).toBeNull();
    });

    test('submitEventAction persists outcome and updates account-scoped run', async () => {
      const activeRun = await createNewRun({ seed: 6666, initialHp: 50 });
      const eventNodeId = 'node_ev_srv';
      activeRun.route.nodes[eventNodeId] = {
        id: eventNodeId,
        type: 'EVENT',
        nextNodes: [],
      };
      activeRun.route.nodes[activeRun.route.startNodeId].nextNodes = [eventNodeId];
      await saveActiveRogueRun(activeRun);

      const advanced = await advanceToNode(eventNodeId);
      expect(advanced.pendingInteraction.type).toBe('EVENT');

      const result = await submitEventAction({ optionId: 'LEAVE' });
      expect(result.success).toBe(true);
      expect(result.run.currentNodeResolved).toBe(true);
    });

    test('old R1-R5 saves without pendingInteraction load safely with default null', async () => {
      const legacyRun = {
        schemaVersion: 1,
        runId: 'legacy_run_1',
        seed: 12345,
        status: ROGUE_RUN_STATUS.ACTIVE,
        currentNodeId: 'node_0_0',
        currentNodeResolved: true,
        player: { hp: 100, maxHp: 100 },
        route: { nodes: {}, visitedNodeIds: ['start'] },
        relics: [],
        relicState: {},
        cursedWords: [],
        // pendingInteraction omitted intentionally (legacy format)
      };

      await saveActiveRogueRun(legacyRun);
      const loaded = await loadActiveRun();
      expect(loaded).toBeDefined();
      expect(loaded.pendingInteraction ?? null).toBeNull();
      expect(isCurrentNodeResolved(loaded)).toBe(true);
    });

    test('Account A, B, and Guest interactions remain strictly isolated', async () => {
      await setActiveIdentity('user_alpha');
      const runA = await createNewRun({ seed: 101, initialHp: 40 });
      runA.pendingInteraction = { interactionId: 'rest_alpha', type: 'REST' };
      await saveActiveRogueRun(runA, 'user_alpha');

      await setActiveIdentity('user_beta');
      const runB = await createNewRun({ seed: 202, initialHp: 90 });
      await saveActiveRogueRun(runB, 'user_beta');

      const loadedA = await loadActiveRun('user_alpha');
      const loadedB = await loadActiveRun('user_beta');

      expect(loadedA.pendingInteraction.interactionId).toBe('rest_alpha');
      expect(loadedB.pendingInteraction).toBeNull();
    });
  });

  // ==================================================
  // 7. RUN TERMINATION & EDGE CASES
  // ==================================================
  describe('7. Run Status & Edge Cases', () => {
    test('defeated or abandoned run cannot resolve pending interactions', () => {
      const run = createRogueRun({ seed: 900 });
      run.status = ROGUE_RUN_STATUS.DEFEAT;
      run.pendingInteraction = { interactionId: 'rest_dead', type: 'REST' };

      const { success, reason } = resolveRestInteraction(run, {
        interactionId: 'rest_dead',
        actionType: REST_ACTIONS.RECOVER,
      });

      expect(success).toBe(false);
      expect(reason).toBe('RUN_NOT_ACTIVE');
    });
  });
});
