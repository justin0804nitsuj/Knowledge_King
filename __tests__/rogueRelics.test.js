import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  RELIC_IDS,
  RELIC_REGISTRY,
  getRelic,
  getAllRelics,
} from '../src/domain/rogue/relic/relicRegistry';
import {
  modifyPlayerAttackDamage,
  modifyGuardMitigation,
  getCursePurificationAmount,
  modifyCurseBacklashDamage,
  shouldPreventNewCurse,
  onCursePurified,
  applyLethalProtection,
} from '../src/domain/rogue/relic/relicEffects';
import {
  generateRelicDraft,
  claimRelicReward,
  REWARD_TYPES,
} from '../src/domain/rogue/relic/relicDraft';
import {
  createEncounter,
  resolveEncounterTurn,
  ENCOUNTER_STATUS,
} from '../src/domain/rogue/combat/rogueCombat';
import {
  createRogueRun,
  advanceRunNode,
  resolveCombatVictory,
  resolveCombatDefeat,
  canAdvanceToNode,
  getSelectableNextNodes,
  isCurrentNodeResolved,
  ROGUE_RUN_STATUS,
} from '../src/domain/rogue/rogueRun';
import {
  createNewRun,
  loadActiveRun,
  advanceToNode,
  submitCombatAnswer,
  selectRelicReward,
  getActiveSelectableNodes,
} from '../src/services/rogue/rogueRunService';
import {
  selectCursedWordForReview,
  applyCurseWrongAnswer,
  applyCurseCorrectAnswer,
  createCursedWordEntry,
} from '../src/domain/rogue/curse/cursedWordModel';
import { setActiveIdentity } from '../src/storage/storageIdentity';

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

describe('Rogue Expedition V0.1 — Phase R5 Relic & Build System', () => {
  beforeEach(async () => {
    mockStore = {};
    jest.clearAllMocks();
    await setActiveIdentity('guest');
  });

  const mockQuestion = {
    questionId: 'q_test_1',
    wordId: 'apple',
    token: 'tok_test_1',
    word: 'apple',
    choices: [
      { id: 'c1', text: 'Apple' },
      { id: 'c2', text: 'Banana' },
    ],
    correctChoiceId: 'c1',
  };

  const mockCursedQuestion = {
    questionId: 'q_test_curse',
    wordId: 'ephemeral',
    token: 'tok_test_curse',
    word: 'ephemeral',
    isCursed: true,
    curseStacks: 2,
    choices: [
      { id: 'c1', text: 'Short-lived' },
      { id: 'c2', text: 'Eternal' },
    ],
    correctChoiceId: 'c1',
  };

  // ==================================================
  // 1. R4 DETERMINISM PREFLIGHT
  // ==================================================
  describe('1. R4 Determinism Preflight', () => {
    test('cursed word selection priority does NOT depend on wall-clock time', () => {
      const words = [
        createCursedWordEntry({
          wordId: 'word_b',
          word: 'bravo',
          stacks: 2,
          firstCursedOrder: 10,
        }),
        createCursedWordEntry({
          wordId: 'word_a',
          word: 'alpha',
          stacks: 2,
          firstCursedOrder: 5, // older sequence index
        }),
      ];

      const selected = selectCursedWordForReview(words);
      expect(selected.wordId).toBe('word_a');
    });

    test('same gameplay inputs produce the exact same review ordering regardless of execution timing', () => {
      const words = [
        { wordId: 'beta', stacks: 1, firstCursedOrder: 2 },
        { wordId: 'gamma', stacks: 2, firstCursedOrder: 1 },
        { wordId: 'delta', stacks: 2, firstCursedOrder: 3 },
      ];

      // Highest stacks first, then oldest firstCursedOrder
      const selected = selectCursedWordForReview(words);
      expect(selected.wordId).toBe('gamma');
    });
  });

  // ==================================================
  // 2. REGISTRY
  // ==================================================
  describe('2. Relic Registry', () => {
    test('all relic IDs are unique and defined in canonical registry', () => {
      const all = getAllRelics();
      expect(all.length).toBe(6);

      const ids = all.map((r) => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(6);

      expect(ids).toContain(RELIC_IDS.SCHOLARS_LENS);
      expect(ids).toContain(RELIC_IDS.PIERCING_NIB);
      expect(ids).toContain(RELIC_IDS.MNEMONIC_CHARM);
      expect(ids).toContain(RELIC_IDS.PURIFYING_INK);
      expect(ids).toContain(RELIC_IDS.GLASS_QUILL);
      expect(ids).toContain(RELIC_IDS.SECOND_CHANCE);
    });

    test('unknown relic ID returns null and is handled safely without crashing', () => {
      expect(getRelic('UNKNOWN_NONEXISTENT_RELIC')).toBeNull();
      expect(getRelic(null)).toBeNull();

      // Effect helpers ignore unknown relic ID safely
      const { playerDamage } = modifyPlayerAttackDamage({
        baseDamage: 20,
        relics: ['UNKNOWN_RELIC'],
      });
      expect(playerDamage).toBe(20);
    });
  });

  // ==================================================
  // 3. DETERMINISTIC DRAFT & ACQUISITION
  // ==================================================
  describe('3. Deterministic Relic Rewards & Gating', () => {
    test('elite victory generates relic draft and locks node until choice is made', () => {
      const run = createRogueRun({ seed: 4455 });
      // Setup current node as ELITE node
      const eliteNodeId = 'node_0_1';
      run.route.nodes[eliteNodeId] = {
        id: eliteNodeId,
        row: 0,
        col: 1,
        type: 'ELITE',
        next: ['node_1_0'],
      };
      run.currentNodeId = eliteNodeId;
      run.currentNodeResolved = false;

      const encounter = createEncounter({
        nodeId: eliteNodeId,
        nodeType: 'ELITE',
        run,
      });

      const updatedRun = resolveCombatVictory(run, {
        ...encounter,
        player: { hp: 80, maxHp: 100 },
      });

      expect(updatedRun.pendingReward).toBeDefined();
      expect(updatedRun.pendingReward.type).toBe('RELIC_DRAFT');
      expect(updatedRun.pendingReward.options.length).toBe(3);
      expect(updatedRun.currentNodeResolved).toBe(false);

      // Node is locked: cannot advance
      expect(isCurrentNodeResolved(updatedRun)).toBe(false);
      expect(canAdvanceToNode(updatedRun, 'node_1_0')).toBe(false);
    });

    test('normal battle victory resolves immediately without generating a draft', () => {
      const run = createRogueRun({ seed: 1234 });
      const battleNodeId = 'node_0_0';
      run.route.nodes[battleNodeId] = {
        id: battleNodeId,
        row: 0,
        col: 0,
        type: 'BATTLE',
        next: ['node_1_0'],
      };
      run.currentNodeId = battleNodeId;
      run.currentNodeResolved = false;

      const encounter = createEncounter({
        nodeId: battleNodeId,
        nodeType: 'BATTLE',
        run,
      });

      const updatedRun = resolveCombatVictory(run, {
        ...encounter,
        player: { hp: 90, maxHp: 100 },
      });

      expect(updatedRun.pendingReward).toBeNull();
      expect(updatedRun.currentNodeResolved).toBe(true);
      expect(isCurrentNodeResolved(updatedRun)).toBe(true);
    });

    test('same seed and elite node generates the exact same draft choices', () => {
      const draftA = generateRelicDraft({ seed: 9999, nodeId: 'elite_1' });
      const draftB = generateRelicDraft({ seed: 9999, nodeId: 'elite_1' });

      expect(draftA.options).toEqual(draftB.options);
      expect(draftA.rewardId).toEqual(draftB.rewardId);
    });

    test('owned relics are excluded from the draft', () => {
      const owned = [RELIC_IDS.SCHOLARS_LENS, RELIC_IDS.PIERCING_NIB];
      const draft = generateRelicDraft({
        seed: 7777,
        nodeId: 'elite_2',
        ownedRelics: owned,
      });

      expect(draft.options.length).toBe(3);
      expect(draft.options).not.toContain(RELIC_IDS.SCHOLARS_LENS);
      expect(draft.options).not.toContain(RELIC_IDS.PIERCING_NIB);
    });

    test('valid choice adds relic, clears pending reward, and unlocks the node', () => {
      const run = createRogueRun({ seed: 8888 });
      const eliteNodeId = 'elite_node';
      run.route.nodes[eliteNodeId] = {
        id: eliteNodeId,
        type: 'ELITE',
        nextNodes: ['next_node'],
      };
      run.route.nodes['next_node'] = {
        id: 'next_node',
        type: 'BATTLE',
        nextNodes: [],
      };
      run.currentNodeId = eliteNodeId;
      run.currentNodeResolved = false;

      const draft = generateRelicDraft({
        seed: 8888,
        nodeId: eliteNodeId,
        ownedRelics: [],
      });
      run.pendingReward = draft;

      const chosenRelic = draft.options[0];
      const { run: claimedRun, success } = claimRelicReward(run, {
        rewardId: draft.rewardId,
        relicId: chosenRelic,
      });

      expect(success).toBe(true);
      expect(claimedRun.relics).toContain(chosenRelic);
      expect(claimedRun.pendingReward).toBeNull();
      expect(claimedRun.currentNodeResolved).toBe(true);
      expect(isCurrentNodeResolved(claimedRun)).toBe(true);
      expect(canAdvanceToNode(claimedRun, 'next_node')).toBe(true);
    });

    test('duplicate choice cannot add duplicate relic (idempotency)', () => {
      const run = createRogueRun({ seed: 8888 });
      const draft = generateRelicDraft({
        seed: 8888,
        nodeId: 'elite_x',
        ownedRelics: [],
      });
      run.pendingReward = draft;

      const chosenRelic = draft.options[0];
      const { run: claimedRun } = claimRelicReward(run, {
        rewardId: draft.rewardId,
        relicId: chosenRelic,
      });

      // Attempting to claim again with the same rewardId
      const repeatClaim = claimRelicReward(claimedRun, {
        rewardId: draft.rewardId,
        relicId: chosenRelic,
      });

      expect(repeatClaim.success).toBe(true);
      expect(repeatClaim.alreadyClaimed).toBe(true);
      // Relics count does not increase
      expect(repeatClaim.run.relics.length).toBe(1);
    });
  });

  // ==================================================
  // 4. SCHOLARS_LENS
  // ==================================================
  describe("4. Scholar's Lens", () => {
    test('cursed correct reduces 2 curse levels instead of 1', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [RELIC_IDS.SCHOLARS_LENS],
        customQuestion: {
          ...mockCursedQuestion,
          curseStacks: 3,
        },
        cursedWords: [
          createCursedWordEntry({
            wordId: 'ephemeral',
            stacks: 3,
          }),
        ],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c1',
          token: mockCursedQuestion.token,
        }
      );

      expect(resolution.correct).toBe(true);
      // Stacks reduced from 3 to 1 (purified by 2)
      expect(nextEncounter.cursedWords[0].stacks).toBe(1);
      expect(resolution.curseResult.type).toBe('CURSE_WEAKENED');
    });

    test('curse reduction cannot go below zero and purifies completely from 2 stacks', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [RELIC_IDS.SCHOLARS_LENS],
        customQuestion: {
          ...mockCursedQuestion,
          curseStacks: 2,
        },
        cursedWords: [
          createCursedWordEntry({
            wordId: 'ephemeral',
            stacks: 2,
          }),
        ],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c1',
          token: mockCursedQuestion.token,
        }
      );

      expect(resolution.curseResult.type).toBe('CURSE_PURIFIED');
      expect(nextEncounter.cursedWords.length).toBe(0);
    });
  });

  // ==================================================
  // 5. PIERCING_NIB
  // ==================================================
  describe('5. Piercing Nib', () => {
    test('reduces enemy Guard damage mitigation by 10', () => {
      // Sentinel guards with mitigation 10
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SENTINEL',
        relics: [RELIC_IDS.PIERCING_NIB],
        customQuestion: mockQuestion,
      });

      encounter.enemy.intent = { type: 'GUARD', value: 10 };

      expect(encounter.enemy.intent.type).toBe('GUARD');

      const { resolution } = resolveEncounterTurn(encounter, {
        choiceId: 'c1', // Correct answer
        token: mockQuestion.token,
      });

      // Normal base damage = 10. Sentinel Guard = 5. Piercing Nib reduces mitigation by 10 -> 0 mitigation!
      expect(resolution.guardPierced).toBe(10);
      expect(resolution.guardMitigated).toBe(0);
      expect(resolution.playerDamage).toBe(10);
    });

    test('mitigation cannot become negative and does not alter attack intents', () => {
      const { effectiveMitigation } = modifyGuardMitigation({
        mitigation: 5,
        relics: [RELIC_IDS.PIERCING_NIB],
      });
      expect(effectiveMitigation).toBe(0);

      // Scout attacks on turn 1
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [RELIC_IDS.PIERCING_NIB],
        customQuestion: mockQuestion,
      });

      expect(encounter.enemy.intent.type).toBe('ATTACK');
      const { resolution } = resolveEncounterTurn(encounter, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.guardPierced).toBe(0);
      expect(resolution.playerDamage).toBe(10);
    });
  });

  // ==================================================
  // 6. MNEMONIC_CHARM
  // ==================================================
  describe('6. Mnemonic Charm', () => {
    test('first normal mistake in encounter does NOT create a curse', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [RELIC_IDS.MNEMONIC_CHARM],
        customQuestion: mockQuestion,
        cursedWords: [],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c2', // Wrong answer
          token: mockQuestion.token,
        }
      );

      expect(resolution.correct).toBe(false);
      expect(resolution.curseResult.type).toBe('CURSE_PREVENTED');
      expect(nextEncounter.cursedWords.length).toBe(0);
      expect(nextEncounter.encounterRelicState[RELIC_IDS.MNEMONIC_CHARM].usedThisEncounter).toBe(true);
    });

    test('second normal mistake in the same encounter creates a curse normally', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [RELIC_IDS.MNEMONIC_CHARM],
        customQuestion: mockQuestion,
        cursedWords: [],
      });

      // 1st mistake (protected)
      const { encounter: turn2Encounter } = resolveEncounterTurn(encounter, {
        choiceId: 'c2',
        token: mockQuestion.token,
      });

      expect(turn2Encounter.cursedWords.length).toBe(0);

      // 2nd mistake with a new question
      const mockQuestion2 = {
        questionId: 'q2',
        wordId: 'banana',
        token: 'tok_2',
        word: 'banana',
        choices: [
          { id: 'b1', text: 'Banana' },
          { id: 'b2', text: 'Wrong' },
        ],
        correctChoiceId: 'b1',
      };
      turn2Encounter.question = mockQuestion2;

      const { encounter: turn3Encounter, resolution } = resolveEncounterTurn(
        turn2Encounter,
        {
          choiceId: 'b2',
          token: mockQuestion2.token,
        }
      );

      expect(resolution.curseResult.type).toBe('CURSE_APPLIED');
      expect(turn3Encounter.cursedWords.length).toBe(1);
      expect(turn3Encounter.cursedWords[0].wordId).toBe('banana');
    });

    test('does NOT protect already-cursed review mistakes', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [RELIC_IDS.MNEMONIC_CHARM],
        customQuestion: mockCursedQuestion,
        cursedWords: [
          createCursedWordEntry({
            wordId: 'ephemeral',
            stacks: 1,
          }),
        ],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c2', // Wrong on cursed review
          token: mockCursedQuestion.token,
        }
      );

      expect(resolution.curseResult.type).toBe('CURSE_INTENSIFIED');
      expect(nextEncounter.cursedWords[0].stacks).toBe(2);
      expect(resolution.backlashDamage).toBe(10); // 2 stacks * 5
      // Mnemonic Charm should NOT be consumed on cursed reviews
      expect(nextEncounter.encounterRelicState[RELIC_IDS.MNEMONIC_CHARM].usedThisEncounter).toBe(false);
    });
  });

  // ==================================================
  // 7. PURIFYING_INK
  // ==================================================
  describe('7. Purifying Ink', () => {
    test('full purification restores 10 HP clamped to max HP', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        playerHp: 50,
        playerMaxHp: 100,
        relics: [RELIC_IDS.PURIFYING_INK],
        customQuestion: {
          ...mockCursedQuestion,
          curseStacks: 1,
        },
        cursedWords: [
          createCursedWordEntry({
            wordId: 'ephemeral',
            stacks: 1,
          }),
        ],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c1', // Correct answer purifies 1 stack to 0
          token: mockCursedQuestion.token,
        }
      );

      expect(resolution.curseResult.type).toBe('CURSE_PURIFIED');
      expect(resolution.inkHeal).toBe(10);
      // Started 50, healed 10 = 60, scout deals 4 = 56
      expect(nextEncounter.player.hp).toBe(56);
    });

    test('partial curse weakening does NOT heal', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        playerHp: 50,
        playerMaxHp: 100,
        relics: [RELIC_IDS.PURIFYING_INK],
        customQuestion: {
          ...mockCursedQuestion,
          curseStacks: 2,
        },
        cursedWords: [
          createCursedWordEntry({
            wordId: 'ephemeral',
            stacks: 2,
          }),
        ],
      });

      const { resolution } = resolveEncounterTurn(encounter, {
        choiceId: 'c1', // Weakened to 1 stack
        token: mockCursedQuestion.token,
      });

      expect(resolution.curseResult.type).toBe('CURSE_WEAKENED');
      expect(resolution.inkHeal).toBe(0);
    });
  });

  // ==================================================
  // 8. GLASS_QUILL
  // ==================================================
  describe('8. Glass Quill', () => {
    test('correct attack deals +10 damage (10 -> 20)', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [RELIC_IDS.GLASS_QUILL],
        customQuestion: mockQuestion,
      });

      const { resolution } = resolveEncounterTurn(encounter, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.playerDamage).toBe(20);
      expect(resolution.glassQuillBonus).toBe(10);
    });

    test('curse backlash deals +5 flat damage when backlash occurs', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        playerHp: 80,
        relics: [RELIC_IDS.GLASS_QUILL],
        customQuestion: mockCursedQuestion,
        cursedWords: [
          createCursedWordEntry({
            wordId: 'ephemeral',
            stacks: 1,
          }),
        ],
      });

      const { resolution } = resolveEncounterTurn(encounter, {
        choiceId: 'c2', // Wrong on cursed review: stacks 1 -> 2
        token: mockCursedQuestion.token,
      });

      // 2 stacks normally = 10 backlash. Glass Quill adds +5 = 15 backlash!
      expect(resolution.backlashDamage).toBe(15);
    });

    test('first normal curse creation still has no backlash', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        playerHp: 80,
        relics: [RELIC_IDS.GLASS_QUILL],
        customQuestion: mockQuestion,
        cursedWords: [],
      });

      const { resolution } = resolveEncounterTurn(encounter, {
        choiceId: 'c2', // Normal mistake
        token: mockQuestion.token,
      });

      // Initial curse creation has 0 backlash, Glass Quill must NOT create artificial backlash
      expect(resolution.backlashDamage).toBe(0);
    });
  });

  // ==================================================
  // 9. SECOND_CHANCE
  // ==================================================
  describe('9. Second Chance', () => {
    test('lethal curse backlash leaves player at 1 HP and consumes relic charge', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        playerHp: 8,
        relics: [RELIC_IDS.SECOND_CHANCE],
        relicState: {
          SECOND_CHANCE: { consumed: false },
        },
        customQuestion: mockCursedQuestion,
        cursedWords: [
          createCursedWordEntry({
            wordId: 'ephemeral',
            stacks: 1,
          }),
        ],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c2', // Backlash = 10, lethal to 8 HP!
          token: mockCursedQuestion.token,
        }
      );

      // Backlash triggers Second Chance, saving player at 1 HP
      // Then enemy Scout attacks for 10 on the same turn, which now kills player
      expect(resolution.secondChanceTriggered).toBe(true);
      expect(nextEncounter.runRelicState[RELIC_IDS.SECOND_CHANCE].consumed).toBe(true);
      expect(nextEncounter.status).toBe(ENCOUNTER_STATUS.DEFEAT);
    });

    test('lethal enemy attack leaves player at 1 HP once when backlash was not lethal', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT', // deals 4 damage
        playerHp: 3,
        relics: [RELIC_IDS.SECOND_CHANCE],
        relicState: {
          SECOND_CHANCE: { consumed: false },
        },
        customQuestion: mockQuestion,
        cursedWords: [],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c2', // Wrong answer, enemy attacks for 4
          token: mockQuestion.token,
        }
      );

      expect(resolution.secondChanceTriggered).toBe(true);
      expect(nextEncounter.player.hp).toBe(1);
      expect(nextEncounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);
      expect(nextEncounter.runRelicState[RELIC_IDS.SECOND_CHANCE].consumed).toBe(true);
    });

    test('already consumed Second Chance does NOT trigger on subsequent lethal damage', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        playerHp: 3,
        relics: [RELIC_IDS.SECOND_CHANCE],
        relicState: {
          SECOND_CHANCE: { consumed: true },
        },
        customQuestion: mockQuestion,
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c2',
          token: mockQuestion.token,
        }
      );

      expect(resolution.secondChanceTriggered).toBe(false);
      expect(nextEncounter.player.hp).toBe(0);
      expect(nextEncounter.status).toBe(ENCOUNTER_STATUS.DEFEAT);
    });
  });

  // ==================================================
  // 10. SERVICE & PERSISTENCE
  // ==================================================
  describe('10. Service & Persistence', () => {
    test('selectRelicReward persists chosen relic and clears pendingReward in storage', async () => {
      const newRun = await createNewRun({ seed: 5566 });
      const eliteNodeId = 'elite_test';
      newRun.route.nodes[eliteNodeId] = {
        id: eliteNodeId,
        type: 'ELITE',
        next: ['next_1'],
      };
      newRun.currentNodeId = eliteNodeId;
      newRun.currentNodeResolved = false;

      const draft = generateRelicDraft({
        seed: 5566,
        nodeId: eliteNodeId,
        ownedRelics: [],
      });
      newRun.pendingReward = draft;

      // Save via service flow
      const { saveActiveRogueRun } = require('../src/storage/rogueRunStorage');
      await saveActiveRogueRun(newRun);

      const chosenRelic = draft.options[0];
      const result = await selectRelicReward({
        rewardId: draft.rewardId,
        relicId: chosenRelic,
      });

      expect(result.success).toBe(true);
      expect(result.run.relics).toContain(chosenRelic);
      expect(result.run.pendingReward).toBeNull();
      expect(result.run.currentNodeResolved).toBe(true);

      // Verify reload from storage
      const reloaded = await loadActiveRun();
      expect(reloaded.relics).toContain(chosenRelic);
      expect(reloaded.pendingReward).toBeNull();
      expect(reloaded.currentNodeResolved).toBe(true);
    });

    test('relic state and charges are strictly isolated between accounts', async () => {
      await setActiveIdentity('user_a');
      const runA = await createNewRun({ seed: 100 });
      runA.relics = [RELIC_IDS.SCHOLARS_LENS];
      const { saveActiveRogueRun } = require('../src/storage/rogueRunStorage');
      await saveActiveRogueRun(runA, 'user_a');

      await setActiveIdentity('user_b');
      const runB = await createNewRun({ seed: 200 });
      expect(runB.relics).toEqual([]);

      // Verify user_a still has relic
      const loadedA = await loadActiveRun('user_a');
      expect(loadedA.relics).toEqual([RELIC_IDS.SCHOLARS_LENS]);
    });
  });

  // ==================================================
  // 11. REGRESSION SAFETY
  // ==================================================
  describe('11. Regression Safety', () => {
    test('R3 enemy intents and R4 curse mechanics function identically when run has no relics', () => {
      const encounter = createEncounter({
        nodeId: 'n1',
        archetypeId: 'SCOUT',
        relics: [],
        customQuestion: mockQuestion,
        cursedWords: [],
      });

      const { encounter: nextEncounter, resolution } = resolveEncounterTurn(
        encounter,
        {
          choiceId: 'c1', // Correct answer
          token: mockQuestion.token,
        }
      );

      expect(resolution.playerDamage).toBe(10);
      expect(resolution.guardMitigated).toBe(0);
      expect(nextEncounter.relics).toEqual([]);
    });
  });
});
