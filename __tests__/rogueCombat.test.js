import {
  createEncounter,
  selectActionInEncounter,
  resolveEncounterTurn,
  PLAYER_ACTION_IDS,
  ENCOUNTER_STATUS,
} from '../src/domain/rogue/combat/rogueCombat';
import {
  ROGUE_COMBAT_CONSTANTS,
  getRogueQuestionDifficulty,
  getEnemyConfigForNodeType,
} from '../src/domain/rogue/combat/rogueCombatConfig';
import { getRogueQuestion } from '../src/domain/rogue/combat/rogueQuestionProvider';

describe('Rogue Expedition V0.1 — Phase R2 Combat Foundation Domain', () => {
  const mockQuestion = {
    questionId: 'q_test_1',
    token: 'tok_test_1',
    word: 'resilient',
    partOfSpeech: 'adj.',
    level: 1,
    choices: [
      { id: 'c1', text: '有彈性的 / 能迅速恢復的' },
      { id: 'c2', text: '脆弱的' },
      { id: 'c3', text: '緩慢的' },
      { id: 'c4', text: '憤怒的' },
    ],
    correctChoiceId: 'c1',
  };

  describe('1. Combat Initialization & Configurations', () => {
    test('creates initial active encounter with correct enemy stats and intent', () => {
      const encounter = createEncounter({
        nodeId: 'node-1-0',
        nodeType: 'BATTLE',
        playerHp: 100,
        playerMaxHp: 100,
        customQuestion: mockQuestion,
      });

      expect(encounter.status).toBe(ENCOUNTER_STATUS.ACTIVE);
      expect(encounter.turn).toBe(1);
      expect(encounter.player.hp).toBe(100);
      expect(encounter.player.maxHp).toBe(100);
      expect(encounter.selectedAction).toBeNull();
      expect(encounter.recoverCooldown).toBe(0);
      expect(encounter.temporaryBlock).toBe(0);

      // Enemy config (R9.1 Scout: 80 HP, 8 base damage)
      expect(encounter.enemy.hp).toBe(80);
      expect(encounter.enemy.maxHp).toBe(80);
      expect(encounter.enemy.intent).toEqual({ type: 'ATTACK', value: 8 });

      // Question
      expect(encounter.question.token).toBe('tok_test_1');
      expect(encounter.question.choices.length).toBe(4);
      // Secret correctChoiceId is not exposed inside choices
      for (const choice of encounter.question.choices) {
        expect(choice.isCorrect).toBeUndefined();
      }
    });

    test('scales baseline stats for ELITE and BOSS encounters', () => {
      const elite = createEncounter({ nodeId: 'node-3-0', nodeType: 'ELITE', customQuestion: mockQuestion });
      expect(elite.enemy.hp).toBe(125);
      expect(elite.enemy.intent.value).toBe(10);

      const boss = createEncounter({ nodeId: 'node-4-0', nodeType: 'BOSS', customQuestion: mockQuestion });
      expect(boss.enemy.hp).toBe(175);
      expect(boss.enemy.intent.value).toBe(10);
    });

    test('centralized difficulty mapping scales with floors', () => {
      expect(getRogueQuestionDifficulty({ row: 0, type: 'START' })).toBe(1);
      expect(getRogueQuestionDifficulty({ row: 1, type: 'BATTLE' })).toBe(1);
      expect(getRogueQuestionDifficulty({ row: 2, type: 'BATTLE' })).toBe(2);
      expect(getRogueQuestionDifficulty({ row: 3, type: 'ELITE' })).toBe(2);
      expect(getRogueQuestionDifficulty({ row: 4, type: 'BOSS' })).toBe(3);
    });
  });

  describe('2. Answer -> Action Core Loop & Damage Formulas', () => {
    test('requires action selection before resolving an answer', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        customQuestion: mockQuestion,
      });

      // Attempt to answer without selecting an action
      const result = resolveEncounterTurn(initial, {
        choiceId: 'c1',
        token: 'tok_test_1',
      });

      expect(result.resolved).toBe(false);
      expect(result.reason).toBe('ACTION_REQUIRED');
      expect(result.encounter.turn).toBe(1);
      expect(result.encounter.player.hp).toBe(100);
      expect(result.encounter.enemy.hp).toBe(80);
    });

    test('correct answer deals expected player damage (25) and triggers enemy response (8)', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        customQuestion: mockQuestion,
      });

      const nextMockQ = {
        questionId: 'q_test_2',
        token: 'tok_test_2',
        word: 'tenacious',
        choices: [{ id: 'c1', text: '頑強的' }],
        correctChoiceId: 'c1',
      };

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(
        armed,
        { choiceId: 'c1', token: 'tok_test_1' },
        { nextQuestion: nextMockQ }
      );

      expect(result.resolved).toBe(true);
      const enc = result.encounter;

      // Enemy took 25 damage: 80 - 25 = 55
      expect(enc.enemy.hp).toBe(55);
      // Enemy was not defeated, so it attacked for 8: 100 - 8 = 92
      expect(enc.player.hp).toBe(92);
      expect(enc.status).toBe(ENCOUNTER_STATUS.ACTIVE);
      expect(enc.turn).toBe(2);
      expect(enc.question.token).toBe('tok_test_2');

      // Stats
      expect(enc.stats.correctAnswers).toBe(1);
      expect(enc.stats.wrongAnswers).toBe(0);
      expect(enc.stats.totalDamageDealt).toBe(25);
      expect(enc.stats.totalDamageTaken).toBe(8);
    });

    test('wrong answer deals 0 player damage and triggers enemy response (8)', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        customQuestion: mockQuestion,
      });

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(
        armed,
        { choiceId: 'c2', token: 'tok_test_1' }, // c2 is wrong
        { nextQuestion: mockQuestion }
      );

      expect(result.resolved).toBe(true);
      const enc = result.encounter;

      // Enemy took 0 damage
      expect(enc.enemy.hp).toBe(80);
      // Enemy dealt 8 damage to player
      expect(enc.player.hp).toBe(92);
      expect(enc.status).toBe(ENCOUNTER_STATUS.ACTIVE);

      expect(enc.stats.correctAnswers).toBe(0);
      expect(enc.stats.wrongAnswers).toBe(1);
      expect(enc.stats.totalDamageDealt).toBe(0);
      expect(enc.stats.totalDamageTaken).toBe(8);
    });

    test('enemy does not attack after lethal correct answer', () => {
      // Enemy starts at 25 HP so 1 correct ATTACK kills it
      const initial = createEncounter({
        nodeId: 'node-1-0',
        playerHp: 100,
        customQuestion: mockQuestion,
      });
      initial.enemy.hp = 25;

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(armed, {
        choiceId: 'c1', // Correct
        token: 'tok_test_1',
      });

      expect(result.resolved).toBe(true);
      const enc = result.encounter;

      expect(enc.enemy.hp).toBe(0);
      // Lethal answer killed enemy before attack: player HP remains unchanged at 100!
      expect(enc.player.hp).toBe(100);
      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(result.resolution.enemyDamage).toBe(0);
    });

    test('player defeat when player HP reaches 0', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        playerHp: 8, // Equal to enemy 8 damage
        customQuestion: mockQuestion,
      });

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(armed, {
        choiceId: 'c2', // Wrong answer
        token: 'tok_test_1',
      });

      expect(result.resolved).toBe(true);
      const enc = result.encounter;

      expect(enc.player.hp).toBe(0);
      expect(enc.status).toBe(ENCOUNTER_STATUS.DEFEAT);
    });
  });

  describe('3. HP Boundaries', () => {
    test('player HP cannot go below zero', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        playerHp: 5,
        customQuestion: mockQuestion,
      });
      initial.enemy.intent.value = 50; // Overkill damage

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(armed, {
        choiceId: 'c2',
        token: 'tok_test_1',
      });

      expect(result.encounter.player.hp).toBe(0);
    });

    test('enemy HP cannot go below zero', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        customQuestion: mockQuestion,
      });
      initial.enemy.hp = 10; // Less than 25 damage

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(armed, {
        choiceId: 'c1',
        token: 'tok_test_1',
      });

      expect(result.encounter.enemy.hp).toBe(0);
    });
  });

  describe('4. Turn Idempotency', () => {
    test('same question submitted twice resolves exactly once', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        customQuestion: mockQuestion,
      });

      // First submission
      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const first = resolveEncounterTurn(armed, {
        choiceId: 'c1',
        token: 'tok_test_1',
      });
      expect(first.resolved).toBe(true);
      expect(first.encounter.enemy.hp).toBe(55);

      // Duplicate submission of the same token
      const duplicate = resolveEncounterTurn(first.encounter, {
        choiceId: 'c1',
        token: 'tok_test_1',
      });

      expect(duplicate.resolved).toBe(false);
      expect(duplicate.reason).toBe('TOKEN_MISMATCH'); // current question already moved or token mismatch
      expect(duplicate.encounter.enemy.hp).toBe(55); // No double damage!
      expect(duplicate.encounter.stats.correctAnswers).toBe(1); // No double stats!
    });

    test('rejected when answering with invalid or mismatched token', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        customQuestion: mockQuestion,
      });

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const res = resolveEncounterTurn(armed, {
        choiceId: 'c1',
        token: 'invalid_token_999',
      });

      expect(res.resolved).toBe(false);
      expect(res.reason).toBe('TOKEN_MISMATCH');
      expect(res.encounter.enemy.hp).toBe(80);
    });
  });

  describe('5. Offline Question Provider & Vocabulary Integration', () => {
    test('offline question provider generates question from local vocabulary repository without network', () => {
      const q = getRogueQuestion({ level: 1, encounterId: 'enc_offline', turn: 1, seed: 12345 });

      expect(q).toBeDefined();
      expect(typeof q.word).toBe('string');
      expect(q.choices.length).toBe(4);
      expect(q.token).toBeDefined();
      expect(q.correctChoiceId).toBeDefined();

      // Ensure isCorrect is stripped from UI choices
      for (const c of q.choices) {
        expect(c.isCorrect).toBeUndefined();
      }
    });

    test('deterministic question generation from identical seed', () => {
      const q1 = getRogueQuestion({ level: 2, encounterId: 'enc_seed', turn: 1, seed: 99999 });
      const q2 = getRogueQuestion({ level: 2, encounterId: 'enc_seed', turn: 1, seed: 99999 });

      expect(q1.word).toBe(q2.word);
      expect(q1.choices).toEqual(q2.choices);
      expect(q1.correctChoiceId).toBe(q2.correctChoiceId);
    });
  });
});
