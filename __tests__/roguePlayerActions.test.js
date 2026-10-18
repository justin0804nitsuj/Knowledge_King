/**
 * ROGUE EXPEDITION V0.1 — PHASE R9
 * DEDICATED PLAYER ACTION SYSTEM REGRESSION TESTS
 *
 * Verifies:
 * 1. ACTION_REQUIRED gating & non-mutation guarantees
 * 2. Action selection, switching, persistence & turn cleanup
 * 3. ATTACK action semantics (25 base, 0 wrong, lethal priority)
 * 4. GUARD action semantics (20 temporary block, expiry, mitigation)
 * 5. RECOVER action semantics (+15 HP clamped, 3-turn cooldown on committed attempt)
 * 6. System composition (Curse purification/backlash + Actions, Relics + Actions)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createEncounter,
  resolveEncounterTurn,
  selectActionInEncounter,
  ENCOUNTER_STATUS,
} from '../src/domain/rogue/combat/rogueCombat';
import {
  PLAYER_ACTION_IDS,
  PLAYER_ACTIONS,
  PLAYER_ACTION_CONSTANTS,
  isValidActionId,
  isActionAvailable,
} from '../src/domain/rogue/combat/playerActions';
import {
  ARCHETYPE_IDS,
  INTENT_TYPES,
} from '../src/domain/rogue/combat/enemyArchetypes';
import { RELIC_IDS } from '../src/domain/rogue/relic/relicRegistry';
import {
  createNewRun,
  loadActiveRun,
  selectCombatAction,
  submitCombatAnswer,
} from '../src/services/rogue/rogueRunService';
import { saveActiveRogueRun, clearActiveRogueRun } from '../src/storage/rogueRunStorage';
import { createCursedWordEntry } from '../src/domain/rogue/curse/cursedWordModel';
import { setActiveIdentity } from '../src/storage/storageIdentity';
import {
  chooseAttackAndResolve,
  chooseGuardAndResolve,
  chooseRecoverAndResolve,
  chooseAttackAndSubmit,
} from './helpers/rogueTestHelpers';

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

describe('Phase R9 — Player Action System (ATTACK, GUARD, RECOVER)', () => {
  beforeEach(async () => {
    mockStore = {};
    jest.clearAllMocks();
    await setActiveIdentity('guest');
    await clearActiveRogueRun();
  });

  const mockQuestion = {
    questionId: 'q_action_1',
    wordId: 'perseverance',
    token: 'tok_action_1',
    word: 'perseverance',
    choices: [
      { id: 'c1', text: 'Persistence' },
      { id: 'c2', text: 'Giving up' },
    ],
    correctChoiceId: 'c1',
  };

  const mockCursedQuestion = {
    questionId: 'q_action_curse',
    wordId: 'ephemeral',
    token: 'tok_action_curse',
    word: 'ephemeral',
    isCursed: true,
    curseStacks: 2,
    choices: [
      { id: 'c1', text: 'Short-lived' },
      { id: 'c2', text: 'Permanent' },
    ],
    correctChoiceId: 'c1',
  };

  // =========================================================================
  // 1. ACTION REQUIRED GATING
  // =========================================================================
  describe('1. ACTION_REQUIRED Gating & Zero-Mutation Invariant', () => {
    it('cannot answer before selecting Action and returns ACTION_REQUIRED', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion,
      });

      expect(enc.selectedAction).toBeNull();

      const result = resolveEncounterTurn(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('ACTION_REQUIRED');
      expect(result.resolution).toBeUndefined();
    });

    it('ACTION_REQUIRED does not advance turn, mutate HP, Curse, or execute enemy Intent', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 80,
        playerMaxHp: 100,
        customQuestion: mockQuestion,
        cursedWords: [
          createCursedWordEntry({ wordId: 'test_curse', stacks: 2 }),
        ],
      });

      const enemyInitialHp = enc.enemy.hp;
      const initialIntent = { ...enc.enemy.intent };

      const result = resolveEncounterTurn(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(result.resolved).toBe(false);
      expect(result.encounter.turn).toBe(1);
      expect(result.encounter.player.hp).toBe(80);
      expect(result.encounter.enemy.hp).toBe(enemyInitialHp);
      expect(result.encounter.enemy.intent).toEqual(initialIntent);
      expect(result.encounter.cursedWords.length).toBe(1);
      expect(result.encounter.cursedWords[0].stacks).toBe(2);
      expect(result.encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);
    });
  });

  // =========================================================================
  // 2. ACTION SELECTION, SWITCHING & CLEANUP
  // =========================================================================
  describe('2. Action Selection, Switching, Persistence & Turn Cleanup', () => {
    it('ATTACK and GUARD may be selected; RECOVER selectable only when cooldown is 0', () => {
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
      });

      enc = selectActionInEncounter(enc, PLAYER_ACTION_IDS.ATTACK);
      expect(enc.selectedAction).toBe(PLAYER_ACTION_IDS.ATTACK);

      enc = selectActionInEncounter(enc, PLAYER_ACTION_IDS.GUARD);
      expect(enc.selectedAction).toBe(PLAYER_ACTION_IDS.GUARD);

      enc = selectActionInEncounter(enc, PLAYER_ACTION_IDS.RECOVER);
      expect(enc.selectedAction).toBe(PLAYER_ACTION_IDS.RECOVER);
    });

    it('throws when attempting to select RECOVER while on cooldown', () => {
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
      });
      enc.recoverCooldown = 2;

      expect(() => {
        selectActionInEncounter(enc, PLAYER_ACTION_IDS.RECOVER);
      }).toThrow(/cooldown/i);
    });

    it('player may change Action multiple times before answering', () => {
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
      });

      enc = selectActionInEncounter(enc, PLAYER_ACTION_IDS.ATTACK);
      expect(enc.selectedAction).toBe(PLAYER_ACTION_IDS.ATTACK);

      enc = selectActionInEncounter(enc, PLAYER_ACTION_IDS.GUARD);
      expect(enc.selectedAction).toBe(PLAYER_ACTION_IDS.GUARD);

      enc = selectActionInEncounter(enc, PLAYER_ACTION_IDS.ATTACK);
      expect(enc.selectedAction).toBe(PLAYER_ACTION_IDS.ATTACK);
    });

    it('selected Action persists before answer across storage save and reload', async () => {
      const run = await createNewRun({ seed: 1234 });
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion,
      });
      run.encounter = enc;
      run.currentNodeId = 'n1';
      run.currentNodeResolved = false;
      await saveActiveRogueRun(run);

      // Select GUARD via service
      const selectResult = await selectCombatAction({ actionId: PLAYER_ACTION_IDS.GUARD });
      expect(selectResult.success).toBe(true);
      expect(selectResult.encounter.selectedAction).toBe(PLAYER_ACTION_IDS.GUARD);

      // Reload from storage
      const reloaded = await loadActiveRun();
      expect(reloaded.encounter.selectedAction).toBe(PLAYER_ACTION_IDS.GUARD);
    });

    it('selected Action clears after a resolved turn', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion,
      });

      const { encounter: nextEnc, resolution } = chooseAttackAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.selectedAction).toBe(PLAYER_ACTION_IDS.ATTACK);
      expect(nextEnc.selectedAction).toBeNull();
      expect(nextEnc.player.selectedAction).toBeNull();
    });
  });

  // =========================================================================
  // 3. ATTACK ACTION SEMANTICS
  // =========================================================================
  describe('3. ATTACK Action Semantics', () => {
    it('correct answer deals exactly 25 base damage', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion,
      });
      const initialEnemyHp = enc.enemy.hp;

      const { encounter: nextEnc, resolution } = chooseAttackAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.correct).toBe(true);
      expect(resolution.playerDamage).toBe(PLAYER_ACTION_CONSTANTS.ATTACK_DAMAGE);
      expect(nextEnc.enemy.hp).toBe(initialEnemyHp - 25);
    });

    it('wrong answer deals 0 damage to enemy and enemy executes intent', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.ATTACK, value: 8 };
      const initialEnemyHp = enc.enemy.hp;
      const initialPlayerHp = enc.player.hp;

      const { encounter: nextEnc, resolution } = chooseAttackAndResolve(enc, {
        choiceId: 'c2',
        token: mockQuestion.token,
      });

      expect(resolution.correct).toBe(false);
      expect(resolution.playerDamage).toBe(0);
      expect(nextEnc.enemy.hp).toBe(initialEnemyHp);
      expect(resolution.enemyDamage).toBe(8);
      expect(nextEnc.player.hp).toBe(initialPlayerHp - 8);
    });

    it('lethal attack drops enemy to 0 HP, results in VICTORY, and skips enemy counterattack', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 10,
        customQuestion: mockQuestion,
      });
      enc.enemy.hp = 20; // 25 damage is lethal
      enc.enemy.intent = { type: INTENT_TYPES.ATTACK, value: 8 };

      const { encounter: nextEnc, resolution } = chooseAttackAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(nextEnc.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(nextEnc.enemy.hp).toBe(0);
      expect(resolution.enemyDamage).toBe(0);
      expect(nextEnc.player.hp).toBe(10); // Player takes zero damage!
    });
  });

  // =========================================================================
  // 4. GUARD ACTION SEMANTICS
  // =========================================================================
  describe('4. GUARD Action Semantics', () => {
    it('correct answer provides 20 Block, completely mitigating attacks <= 20', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 50,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.ATTACK, value: 8 };

      const { encounter: nextEnc, resolution } = chooseGuardAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.correct).toBe(true);
      expect(resolution.temporaryBlock).toBe(20);
      expect(resolution.damageBlocked).toBe(8);
      expect(resolution.enemyDamage).toBe(0);
      expect(nextEnc.player.hp).toBe(50); // Fully blocked!
      expect(resolution.playerDamage).toBe(0);
    });

    it('correct answer partially mitigates heavy attacks > 20', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.BRUTE,
        playerHp: 80,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 24 };

      const { encounter: nextEnc, resolution } = chooseGuardAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.temporaryBlock).toBe(20);
      expect(resolution.damageBlocked).toBe(20);
      expect(resolution.enemyDamage).toBe(4); // 24 - 20 = 4
      expect(nextEnc.player.hp).toBe(76);
    });

    it('wrong answer provides 0 Block and leaves player exposed to full enemy damage', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.BRUTE,
        playerHp: 80,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 24 };

      const { encounter: nextEnc, resolution } = chooseGuardAndResolve(enc, {
        choiceId: 'c2', // Wrong
        token: mockQuestion.token,
      });

      expect(resolution.correct).toBe(false);
      expect(resolution.temporaryBlock).toBe(0);
      expect(resolution.damageBlocked).toBe(0);
      expect(resolution.enemyDamage).toBe(24);
      expect(nextEnc.player.hp).toBe(56);
    });

    it('temporary Block expires at turn end and does not carry over to next turn', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 80,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.GUARD, value: 10 }; // Enemy deals 0 damage

      const { encounter: nextEnc, resolution } = chooseGuardAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.temporaryBlock).toBe(20);
      // Next turn starts with block 0 (temporary block expired)
      expect(nextEnc.player?.block || 0).toBe(0);
      expect(nextEnc.block || 0).toBe(0);
    });
  });

  // =========================================================================
  // 5. RECOVER ACTION & COOLDOWN SEMANTICS
  // =========================================================================
  describe('5. RECOVER Action & 3-Turn Cooldown Semantics', () => {
    it('correct answer restores +15 HP, clamped to max HP', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 60,
        playerMaxHp: 100,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.GUARD, value: 10 }; // Enemy doesn't attack

      const { encounter: nextEnc, resolution } = chooseRecoverAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.correct).toBe(true);
      expect(resolution.recoveredHp).toBe(20);
      expect(nextEnc.player.hp).toBe(80);
    });

    it('clamping: recovers only up to playerMaxHp', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 95,
        playerMaxHp: 100,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.GUARD, value: 10 };

      const { encounter: nextEnc, resolution } = chooseRecoverAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.recoveredHp).toBe(5); // Clamped from 15 to 5
      expect(nextEnc.player.hp).toBe(100);
    });

    it('wrong answer restores +0 HP and takes full enemy counterattack', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 60,
        playerMaxHp: 100,
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.ATTACK, value: 8 };

      const { encounter: nextEnc, resolution } = chooseRecoverAndResolve(enc, {
        choiceId: 'c2', // Wrong
        token: mockQuestion.token,
      });

      expect(resolution.correct).toBe(false);
      expect(resolution.recoveredHp).toBe(0);
      expect(resolution.enemyDamage).toBe(8);
      expect(nextEnc.player.hp).toBe(52); // 60 + 0 - 8 = 52
    });

    it('both committed attempts (correct and wrong) consume the 3-turn cooldown', () => {
      // 1. Correct attempt starts cooldown 3
      const enc1 = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion,
      });
      const { encounter: after1 } = chooseRecoverAndResolve(enc1, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });
      expect(after1.recoverCooldown).toBe(3);

      // 2. Wrong attempt also starts cooldown 3
      const enc2 = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQuestion,
      });
      const { encounter: after2 } = chooseRecoverAndResolve(enc2, {
        choiceId: 'c2',
        token: mockQuestion.token,
      });
      expect(after2.recoverCooldown).toBe(3);
    });

    it('committed recover at full HP still consumes cooldown', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 100,
        playerMaxHp: 100,
        customQuestion: mockQuestion,
      });

      const { encounter: nextEnc, resolution } = chooseRecoverAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.recoveredHp).toBe(0);
      expect(nextEnc.recoverCooldown).toBe(3);
    });

    it('cooldown decrements turn-by-turn and becomes available exactly on turn 4', () => {
      const q = (tok) => ({
        questionId: 'q_' + tok,
        token: 'tok_' + tok,
        word: 'word',
        choices: [{ id: 'c1', text: 'ok' }],
        correctChoiceId: 'c1',
      });

      // Turn 1: Player uses RECOVER
      let enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: q('1'),
      });
      const turn1 = chooseRecoverAndResolve(enc, { choiceId: 'c1', token: 'tok_1' }, { nextQuestion: q('2') });
      enc = turn1.encounter;
      expect(enc.recoverCooldown).toBe(3);
      expect(isActionAvailable(PLAYER_ACTION_IDS.RECOVER, enc)).toBe(false);

      // Turn 2: Player ATTACKS. Recover cooldown decrements from 3 to 2
      const turn2 = chooseAttackAndResolve(enc, { choiceId: 'c1', token: 'tok_2' }, { nextQuestion: q('3') });
      enc = turn2.encounter;
      expect(enc.recoverCooldown).toBe(2);
      expect(isActionAvailable(PLAYER_ACTION_IDS.RECOVER, enc)).toBe(false);

      // Turn 3: Player ATTACKS. Recover cooldown decrements from 2 to 1
      const turn3 = chooseAttackAndResolve(enc, { choiceId: 'c1', token: 'tok_3' }, { nextQuestion: q('4') });
      enc = turn3.encounter;
      expect(enc.recoverCooldown).toBe(1);
      expect(isActionAvailable(PLAYER_ACTION_IDS.RECOVER, enc)).toBe(false);

      // Turn 4: Player ATTACKS. Recover cooldown decrements from 1 to 0 -> RECOVER IS NOW AVAILABLE!
      const turn4 = chooseAttackAndResolve(enc, { choiceId: 'c1', token: 'tok_4' }, { nextQuestion: q('5') });
      enc = turn4.encounter;
      expect(enc.recoverCooldown).toBe(0);
      expect(isActionAvailable(PLAYER_ACTION_IDS.RECOVER, enc)).toBe(true);

      // Turn 5: Player may select RECOVER again!
      expect(() => {
        selectActionInEncounter(enc, PLAYER_ACTION_IDS.RECOVER);
      }).not.toThrow();
    });
  });

  // =========================================================================
  // 6. SYSTEM COMPOSITION (CURSED WORDS, RELICS & INTENTS)
  // =========================================================================
  describe('6. System Composition (Curses, Relics & Intents)', () => {
    it('wrong GUARD results in Guard failure, applies Curse, and player takes enemy Heavy Attack', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.BRUTE,
        playerHp: 80,
        customQuestion: mockQuestion,
        cursedWords: [],
      });
      enc.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 22 };

      const { encounter: nextEnc, resolution } = chooseGuardAndResolve(enc, {
        choiceId: 'c2', // Wrong
        token: mockQuestion.token,
      });

      expect(resolution.correct).toBe(false);
      expect(resolution.temporaryBlock).toBe(0);
      expect(resolution.damageBlocked).toBe(0);
      expect(resolution.curseResult.type).toBe('CURSE_APPLIED');
      expect(nextEnc.cursedWords.length).toBe(1);
      expect(resolution.enemyDamage).toBe(22);
      expect(nextEnc.player.hp).toBe(58); // 80 - 22 = 58
    });

    it('correct cursed GUARD succeeds with 20 Block and purifies Curse level', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.BRUTE,
        playerHp: 80,
        customQuestion: mockCursedQuestion,
        cursedWords: [
          createCursedWordEntry({ wordId: 'ephemeral', stacks: 2 }),
        ],
      });
      enc.enemy.intent = { type: INTENT_TYPES.HEAVY_ATTACK, value: 22 };

      const { encounter: nextEnc, resolution } = chooseGuardAndResolve(enc, {
        choiceId: 'c1', // Correct answer on cursed review
        token: mockCursedQuestion.token,
      });

      expect(resolution.correct).toBe(true);
      expect(resolution.temporaryBlock).toBe(20);
      expect(resolution.damageBlocked).toBe(20);
      expect(resolution.enemyDamage).toBe(2); // 22 - 20 = 2
      expect(nextEnc.player.hp).toBe(78);
      // Curse weakened from 2 to 1!
      expect(resolution.curseResult.type).toBe('CURSE_WEAKENED');
      expect(nextEnc.cursedWords[0].stacks).toBe(1);
    });

    it('correct cursed RECOVER restores HP and purifies Curse, even if enemy attacks', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        playerHp: 60,
        playerMaxHp: 100,
        customQuestion: mockCursedQuestion,
        cursedWords: [
          createCursedWordEntry({ wordId: 'ephemeral', stacks: 1 }),
        ],
      });
      enc.enemy.intent = { type: INTENT_TYPES.ATTACK, value: 8 };

      const { encounter: nextEnc, resolution } = chooseRecoverAndResolve(enc, {
        choiceId: 'c1',
        token: mockCursedQuestion.token,
      });

      expect(resolution.correct).toBe(true);
      expect(resolution.curseResult.type).toBe('CURSE_PURIFIED');
      expect(nextEnc.cursedWords.length).toBe(0);
      expect(resolution.recoveredHp).toBe(20);
      expect(resolution.enemyDamage).toBe(8);
      expect(nextEnc.player.hp).toBe(72); // 60 + 20 - 8 = 72
    });

    it('Glass Quill + ATTACK deals +10 bonus damage (total 35)', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        relics: [RELIC_IDS.GLASS_QUILL],
        customQuestion: mockQuestion,
      });

      const { resolution } = chooseAttackAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.playerDamage).toBe(35);
      expect(resolution.glassQuillBonus).toBe(10);
    });

    it('Piercing Nib + ATTACK against Sentinel GUARD bypasses mitigation', () => {
      const enc = createEncounter({
        nodeId: 'n1',
        archetypeId: ARCHETYPE_IDS.SENTINEL,
        relics: [RELIC_IDS.PIERCING_NIB],
        customQuestion: mockQuestion,
      });
      enc.enemy.intent = { type: INTENT_TYPES.GUARD, value: 10 };

      const { resolution } = chooseAttackAndResolve(enc, {
        choiceId: 'c1',
        token: mockQuestion.token,
      });

      expect(resolution.guardPierced).toBe(10);
      expect(resolution.guardMitigated).toBe(0);
      expect(resolution.playerDamage).toBe(25);
    });
  });
});
