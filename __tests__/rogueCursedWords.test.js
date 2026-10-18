import {
  CURSE_CONFIG,
  MAX_CURSE_STACKS,
  CURSED_REVIEW_INTERVAL,
  CURSE_BACKLASH_DAMAGE_PER_STACK,
} from '../src/domain/rogue/curse/curseConfig';
import {
  createCursedWordEntry,
  isCursedReviewSlot,
  selectCursedWordForReview,
  calculateCurseBacklash,
  applyCurseWrongAnswer,
  applyCurseCorrectAnswer,
  CURSE_TRANSITION_TYPES,
} from '../src/domain/rogue/curse/cursedWordModel';
import {
  createEncounter,
  selectActionInEncounter,
  resolveEncounterTurn,
  PLAYER_ACTION_IDS,
  ENCOUNTER_STATUS,
} from '../src/domain/rogue/combat/rogueCombat';
import { getRogueQuestion } from '../src/domain/rogue/combat/rogueQuestionProvider';
import {
  createRogueRun,
  advanceRunNode,
  resolveCombatVictory,
  resolveCombatDefeat,
} from '../src/domain/rogue/rogueRun';
import {
  createNewRun,
  loadActiveRun,
  advanceToNode,
  selectCombatAction,
  submitCombatAnswer,
  getActiveSelectableNodes,
} from '../src/services/rogue/rogueRunService';
import { setActiveIdentity } from '../src/storage/storageIdentity';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

describe('Rogue Expedition V0.1 — Phase R4 Cursed Word System', () => {
  beforeEach(async () => {
    mockStore = {};
    jest.clearAllMocks();
    await setActiveIdentity('guest');
  });

  const mockQuestionA = {
    questionId: 'q_apple',
    wordId: 'word_apple',
    word: 'apple',
    level: 1,
    token: 'tok_apple_1',
    choices: [{ id: 'c1', text: '蘋果' }, { id: 'c2', text: '香蕉' }],
    correctChoiceId: 'c1',
    isCursed: false,
    curseStacks: 0,
  };

  const mockQuestionB = {
    questionId: 'q_banana',
    wordId: 'word_banana',
    word: 'banana',
    level: 1,
    token: 'tok_banana_1',
    choices: [{ id: 'c1', text: '香蕉' }, { id: 'c2', text: '蘋果' }],
    correctChoiceId: 'c1',
    isCursed: false,
    curseStacks: 0,
  };

  describe('1. Curse Creation & Stacking Mechanics', () => {
    test('wrong answer on normal word creates initial curse with 1 stack and no backlash', () => {
      const initial = createEncounter({
        nodeId: 'node-1-0',
        customQuestion: mockQuestionA,
      });

      expect(initial.cursedWords).toEqual([]);

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(armed, {
        choiceId: 'c2', // wrong
        token: 'tok_apple_1',
      });

      expect(result.resolved).toBe(true);
      const enc = result.encounter;
      expect(enc.cursedWords.length).toBe(1);

      const cursed = enc.cursedWords[0];
      expect(cursed.wordId).toBe('word_apple');
      expect(cursed.word).toBe('apple');
      expect(cursed.stacks).toBe(1);
      expect(cursed.mistakeCount).toBe(1);

      // First mistake does NOT cause Curse Backlash!
      expect(result.resolution.backlashDamage).toBe(0);
      expect(result.resolution.curseResult.backlash).toBe(0);
      expect(result.resolution.curseResult.type).toBe(CURSE_TRANSITION_TYPES.CURSE_APPLIED);

      // Player took only normal enemy damage (8 from Scout in R9), not backlash
      expect(enc.player.hp).toBe(92);
    });

    test('same word does not create duplicate entries in cursedWords', () => {
      let words = [];
      const res1 = applyCurseWrongAnswer(words, {
        wordId: 'word_apple',
        word: 'apple',
        turn: 1,
        isCursedReview: false,
      });
      words = res1.cursedWords;
      expect(words.length).toBe(1);

      // Second wrong answer on same word
      const res2 = applyCurseWrongAnswer(words, {
        wordId: 'word_apple',
        word: 'apple',
        turn: 2,
        isCursedReview: false,
      });
      words = res2.cursedWords;
      expect(words.length).toBe(1);
      expect(words[0].stacks).toBe(2);
      expect(words[0].mistakeCount).toBe(2);
    });

    test('repeated mistakes on cursed review increase stack up to MAX_CURSE_STACKS (3)', () => {
      let words = [createCursedWordEntry({ wordId: 'w1', word: 'abandon', stacks: 1 })];

      // Mistake 2 -> stack 2
      const step2 = applyCurseWrongAnswer(words, {
        wordId: 'w1',
        word: 'abandon',
        turn: 2,
        isCursedReview: true,
      });
      expect(step2.cursedWords[0].stacks).toBe(2);
      expect(step2.curseResult.backlash).toBe(10); // 2 stacks * 5 = 10

      // Mistake 3 -> stack 3 (capped)
      const step3 = applyCurseWrongAnswer(step2.cursedWords, {
        wordId: 'w1',
        word: 'abandon',
        turn: 3,
        isCursedReview: true,
      });
      expect(step3.cursedWords[0].stacks).toBe(3);
      expect(step3.curseResult.backlash).toBe(15); // 3 stacks * 5 = 15

      // Mistake 4 -> remains stack 3
      const step4 = applyCurseWrongAnswer(step3.cursedWords, {
        wordId: 'w1',
        word: 'abandon',
        turn: 4,
        isCursedReview: true,
      });
      expect(step4.cursedWords[0].stacks).toBe(3);
      expect(step4.cursedWords[0].mistakeCount).toBe(4);
      expect(step4.curseResult.backlash).toBe(15); // Capped at 15
    });
  });

  describe('2. Curse Purification Mechanics', () => {
    test('correct answer on cursed review with 1 stack completely removes and purifies curse', () => {
      const cursedWords = [createCursedWordEntry({ wordId: 'w1', word: 'apple', stacks: 1 })];
      const res = applyCurseCorrectAnswer(cursedWords, { wordId: 'w1', word: 'apple', turn: 3 });

      expect(res.cursedWords.length).toBe(0);
      expect(res.curseResult.type).toBe(CURSE_TRANSITION_TYPES.CURSE_PURIFIED);
      expect(res.curseResult.stacks).toBe(0);
    });

    test('correct answer on cursed review with 3 stacks reduces to 2 stacks', () => {
      const cursedWords = [createCursedWordEntry({ wordId: 'w1', word: 'apple', stacks: 3 })];
      const res = applyCurseCorrectAnswer(cursedWords, { wordId: 'w1', word: 'apple', turn: 3 });

      expect(res.cursedWords.length).toBe(1);
      expect(res.cursedWords[0].stacks).toBe(2);
      expect(res.curseResult.type).toBe(CURSE_TRANSITION_TYPES.CURSE_WEAKENED);
    });

    test('repeated correct reviews can fully purify a 3-stack curse down to 0', () => {
      let words = [createCursedWordEntry({ wordId: 'w1', word: 'apple', stacks: 3 })];

      words = applyCurseCorrectAnswer(words, { wordId: 'w1', turn: 1 }).cursedWords;
      expect(words[0].stacks).toBe(2);

      words = applyCurseCorrectAnswer(words, { wordId: 'w1', turn: 2 }).cursedWords;
      expect(words[0].stacks).toBe(1);

      const finalRes = applyCurseCorrectAnswer(words, { wordId: 'w1', turn: 3 });
      expect(finalRes.cursedWords.length).toBe(0);
      expect(finalRes.curseResult.type).toBe(CURSE_TRANSITION_TYPES.CURSE_PURIFIED);
    });

    test('lethal correct hit still purifies curse even when encounter ends in VICTORY', () => {
      const cursedWord = createCursedWordEntry({ wordId: 'w_kill', word: 'lethalWord', stacks: 1 });
      const initial = createEncounter({
        nodeId: 'node-1-0',
        cursedWords: [cursedWord],
        customQuestion: {
          questionId: 'q_curse_kill',
          wordId: 'w_kill',
          word: 'lethalWord',
          token: 'tok_curse_kill',
          choices: [{ id: 'c1', text: '正解' }],
          correctChoiceId: 'c1',
          isCursed: true,
          curseStacks: 1,
        },
      });

      // Enemy has 25 HP, player deals 25 with ATTACK -> lethal
      initial.enemy.hp = 25;

      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const result = resolveEncounterTurn(armed, {
        choiceId: 'c1',
        token: 'tok_curse_kill',
      });

      expect(result.resolved).toBe(true);
      expect(result.encounter.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(result.encounter.enemy.hp).toBe(0);
      // Curse was successfully purified despite combat ending immediately!
      expect(result.encounter.cursedWords.length).toBe(0);
      expect(result.resolution.curseResult.type).toBe(CURSE_TRANSITION_TYPES.CURSE_PURIFIED);
    });
  });

  describe('3. Curse Backlash & Defeat Safety', () => {
    test('wrong answer on cursed review applies backlash based on resulting stacks (stacks * 5)', () => {
      const cursedWords = [createCursedWordEntry({ wordId: 'w1', word: 'apple', stacks: 2 })];
      const cursedQ = {
        questionId: 'q_cursed_review',
        wordId: 'w1',
        word: 'apple',
        token: 'tok_curse_review',
        choices: [{ id: 'c1', text: '蘋果' }, { id: 'c2', text: '錯' }],
        correctChoiceId: 'c1',
        isCursed: true,
        curseStacks: 2,
      };

      const enc = createEncounter({
        nodeId: 'node-1-0',
        playerHp: 100,
        cursedWords,
        customQuestion: cursedQ,
      });

      const armed = selectActionInEncounter(enc, PLAYER_ACTION_IDS.ATTACK);
      const res = resolveEncounterTurn(armed, {
        choiceId: 'c2', // wrong
        token: 'tok_curse_review',
      });

      expect(res.resolved).toBe(true);
      // Stack becomes 3 -> Backlash = 3 * 5 = 15 damage
      expect(res.resolution.backlashDamage).toBe(15);
      expect(res.resolution.enemyDamage).toBe(8); // Scout standard attack in R9 is 8
      // Total HP lost: 15 (backlash) + 8 (enemy) = 23 -> 100 - 23 = 77
      expect(res.encounter.player.hp).toBe(77);
      expect(res.encounter.stats.curseBacklashTaken).toBe(15);
    });

    test('curse backlash death skips enemy intent and terminates combat with DEFEAT', () => {
      const cursedWords = [createCursedWordEntry({ wordId: 'w1', word: 'apple', stacks: 2 })];
      const cursedQ = {
        questionId: 'q_backlash_lethal',
        wordId: 'w1',
        word: 'apple',
        token: 'tok_backlash_lethal',
        choices: [{ id: 'c1', text: '蘋果' }, { id: 'c2', text: '錯' }],
        correctChoiceId: 'c1',
        isCursed: true,
        curseStacks: 2,
      };

      // Player has only 10 HP. Resulting stacks = 3 -> 15 backlash damage kills player!
      const enc = createEncounter({
        nodeId: 'node-1-0',
        playerHp: 10,
        cursedWords,
        customQuestion: cursedQ,
      });

      const armed = selectActionInEncounter(enc, PLAYER_ACTION_IDS.ATTACK);
      const res = resolveEncounterTurn(armed, {
        choiceId: 'c2',
        token: 'tok_backlash_lethal',
      });

      expect(res.resolved).toBe(true);
      expect(res.encounter.status).toBe(ENCOUNTER_STATUS.DEFEAT);
      expect(res.encounter.player.hp).toBe(0);
      // Enemy intent did NOT execute after backlash killed player!
      expect(res.resolution.enemyDamage).toBe(0);
      expect(res.resolution.backlashDamage).toBe(15);
    });
  });

  describe('4. Deterministic Review Scheduling & Selection', () => {
    test('isCursedReviewSlot adheres to CURSED_REVIEW_INTERVAL (3)', () => {
      expect(isCursedReviewSlot(1)).toBe(false);
      expect(isCursedReviewSlot(2)).toBe(false);
      expect(isCursedReviewSlot(3)).toBe(true);
      expect(isCursedReviewSlot(4)).toBe(false);
      expect(isCursedReviewSlot(5)).toBe(false);
      expect(isCursedReviewSlot(6)).toBe(true);
    });

    test('selectCursedWordForReview prioritizes highest stacks', () => {
      const words = [
        createCursedWordEntry({ wordId: 'w_low', word: 'low', stacks: 1, firstCursedAt: 1 }),
        createCursedWordEntry({ wordId: 'w_high', word: 'high', stacks: 3, firstCursedAt: 2 }),
        createCursedWordEntry({ wordId: 'w_mid', word: 'mid', stacks: 2, firstCursedAt: 1 }),
      ];

      const selected = selectCursedWordForReview(words);
      expect(selected.wordId).toBe('w_high');
    });

    test('selectCursedWordForReview tie-breaks by oldest unresolved curse first', () => {
      const words = [
        createCursedWordEntry({ wordId: 'w_recent', word: 'recent', stacks: 2, firstCursedAt: 5 }),
        createCursedWordEntry({ wordId: 'w_oldest', word: 'oldest', stacks: 2, firstCursedAt: 1 }),
      ];

      const selected = selectCursedWordForReview(words);
      expect(selected.wordId).toBe('w_oldest');
    });

    test('selectCursedWordForReview tie-breaks identical stacks and age by wordId', () => {
      const words = [
        createCursedWordEntry({ wordId: 'zebra', word: 'zebra', stacks: 2, firstCursedAt: 1 }),
        createCursedWordEntry({ wordId: 'apple', word: 'apple', stacks: 2, firstCursedAt: 1 }),
      ];

      const selected = selectCursedWordForReview(words);
      expect(selected.wordId).toBe('apple');
    });

    test('selecting a cursed word does NOT mutate input state', () => {
      const original = [createCursedWordEntry({ wordId: 'w1', word: 'w1', stacks: 2 })];
      const snapshot = JSON.stringify(original);

      const candidate = selectCursedWordForReview(original);
      candidate.stacks = 99; // Attempt mutation

      expect(JSON.stringify(original)).toBe(snapshot);
      expect(original[0].stacks).toBe(2);
    });
  });

  describe('5. Question Provider & Targeted Generation', () => {
    test('generates valid targeted question for existing cursed word', () => {
      // 'ability-2' is a real level 1 word in assets
      const cursedWords = [createCursedWordEntry({ wordId: 'ability-2', word: 'ability', level: 1 })];

      const question = getRogueQuestion({
        level: 1,
        encounterId: 'enc_test',
        turn: 3, // Turn 3 is a cursed review slot
        cursedWords,
      });

      expect(question.isCursed).toBe(true);
      expect(question.curseStacks).toBe(1);
      expect(question.word).toBe('ability');
      expect(question.choices.length).toBe(4);
      // isCorrect is stripped
      for (const c of question.choices) {
        expect(c.isCorrect).toBeUndefined();
      }
    });

    test('stale/non-existent cursed word falls back safely to normal question without crashing', () => {
      const staleCursedWords = [
        createCursedWordEntry({ wordId: 'STALE_DELETED_WORD_9999', word: 'ghostWord', level: 1 }),
      ];

      const question = getRogueQuestion({
        level: 1,
        encounterId: 'enc_stale',
        turn: 3, // Cursed review slot
        cursedWords: staleCursedWords,
      });

      // Does not crash, cleanly generates normal question
      expect(question).toBeDefined();
      expect(question.word).toBeDefined();
      expect(question.choices.length).toBe(4);
    });
  });

  describe('6. Idempotency & Duplicate Submission Safety', () => {
    test('duplicate question submission does not create or modify curses twice', () => {
      const initial = createEncounter({
        nodeId: 'node-idemp',
        customQuestion: mockQuestionA,
      });

      // Turn 1 wrong
      const armed = selectActionInEncounter(initial, PLAYER_ACTION_IDS.ATTACK);
      const res1 = resolveEncounterTurn(armed, { choiceId: 'c2', token: 'tok_apple_1' });
      expect(res1.resolved).toBe(true);
      expect(res1.encounter.cursedWords.length).toBe(1);
      expect(res1.encounter.cursedWords[0].stacks).toBe(1);

      // Resubmit duplicate
      const dup = resolveEncounterTurn(res1.encounter, { choiceId: 'c2', token: 'tok_apple_1' });
      expect(dup.resolved).toBe(false);
      expect(dup.reason).toBe('TOKEN_MISMATCH');
      expect(dup.encounter.cursedWords.length).toBe(1);
      expect(dup.encounter.cursedWords[0].stacks).toBe(1);
      expect(dup.encounter.player.hp).toBe(res1.encounter.player.hp);
    });
  });

  describe('7. Run Lifecycle & Cross-Encounter Persistence', () => {
    test('cursed words persist across battle victory and into next combat node', async () => {
      await createNewRun({ seed: 777 });
      const battleNode1 = (await getActiveSelectableNodes())[0];
      await advanceToNode(battleNode1, {
        customQuestion: {
          questionId: 'q_p1',
          wordId: 'w_persist',
          word: 'persistWord',
          token: 'tok_p1',
          choices: [{ id: 'c1', text: '對' }, { id: 'c2', text: '錯' }],
          correctChoiceId: 'c1',
        },
      });

      // Answer wrong -> curses "persistWord"
      let enc = (await loadActiveRun()).encounter;
      await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
      const resWrong = await submitCombatAnswer({
        choiceId: 'c2',
        token: enc.question.token,
      });
      expect(resWrong.encounter.cursedWords.length).toBe(1);
      expect(resWrong.encounter.cursedWords[0].wordId).toBe('w_persist');

      // Now defeat the enemy with correct answers with bounded loop safeguard
      enc = resWrong.encounter;
      let turns = 0;
      const MAX_TURNS = 30;

      while (enc.status === ENCOUNTER_STATUS.ACTIVE && turns++ < MAX_TURNS) {
        await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
        const killRes = await submitCombatAnswer({
          choiceId: enc.question.correctChoiceId,
          token: enc.question.token,
        });
        enc = killRes.encounter;
      }

      if (enc.status === ENCOUNTER_STATUS.ACTIVE) {
        throw new Error(`Combat failed to resolve within ${MAX_TURNS} turns`);
      }

      expect(enc.status).toBe(ENCOUNTER_STATUS.VICTORY);

      // Run must have preserved cursedWords across combat victory!
      const victoryRun = await loadActiveRun();
      expect(victoryRun.cursedWords.length).toBe(1);
      expect(victoryRun.cursedWords[0].wordId).toBe('w_persist');

      // Advance to next combat node -> new encounter carries the cursed word!
      const nextSelectables = await getActiveSelectableNodes();
      const nextBattle = nextSelectables[0];
      await advanceToNode(nextBattle);

      const nextRun = await loadActiveRun();
      expect(nextRun.encounter).toBeDefined();
      expect(nextRun.encounter.cursedWords.length).toBe(1);
      expect(nextRun.encounter.cursedWords[0].wordId).toBe('w_persist');
    });

    test('app restart mid-battle on cursed question restores exact question, curse status, and HP', async () => {
      await createNewRun({ seed: 888 });
      const node = (await getActiveSelectableNodes())[0];
      await advanceToNode(node, {
        customQuestion: {
          questionId: 'q_cursed_restore',
          wordId: 'w_res',
          word: 'restoreWord',
          token: 'tok_res_1',
          choices: [{ id: 'c1', text: '1' }, { id: 'c2', text: '2' }],
          correctChoiceId: 'c1',
          isCursed: true,
          curseStacks: 2,
        },
      });

      const beforeRun = await loadActiveRun();
      expect(beforeRun.encounter.question.isCursed).toBe(true);
      expect(beforeRun.encounter.question.curseStacks).toBe(2);
      const token = beforeRun.encounter.question.token;

      // Simulate App Restart (read fresh from storage)
      const afterRun = await loadActiveRun();
      expect(afterRun.encounter.question.token).toBe(token);
      expect(afterRun.encounter.question.isCursed).toBe(true);
      expect(afterRun.encounter.question.curseStacks).toBe(2);
      expect(afterRun.encounter.player.hp).toBe(beforeRun.encounter.player.hp);
    });

    test('new run starts clean with 0 cursed words and does not leak from previous runs', async () => {
      const run1 = createRogueRun({ seed: 101 });
      run1.cursedWords = [createCursedWordEntry({ wordId: 'w_old', word: 'old', stacks: 3 })];

      const run2 = createRogueRun({ seed: 102 });
      expect(run2.cursedWords).toEqual([]);
    });

    test('guest and authenticated accounts have strictly isolated cursed words', async () => {
      // Guest creates curse
      await setActiveIdentity('guest');
      await createNewRun({ seed: 1 });
      const guestInitRun = await loadActiveRun();
      const nodeG = (await getActiveSelectableNodes()).find(
        (id) => guestInitRun.route.nodes[id].type === 'BATTLE'
      );
      await advanceToNode(nodeG, {
        customQuestion: {
          questionId: 'q_g',
          wordId: 'w_guest',
          word: 'guestWord',
          token: 'tok_g',
          choices: [{ id: 'c1' }, { id: 'c2' }],
          correctChoiceId: 'c1',
        },
      });
      await selectCombatAction({ actionId: PLAYER_ACTION_IDS.ATTACK });
      await submitCombatAnswer({ choiceId: 'c2', token: 'tok_g' });
      const guestRun = await loadActiveRun();
      expect(guestRun.cursedWords.length).toBe(1);

      // Account Alpha
      await setActiveIdentity('uid:alpha');
      expect(await loadActiveRun()).toBeNull();
      await createNewRun({ seed: 2 });
      const alphaRun = await loadActiveRun();
      expect(alphaRun.cursedWords).toEqual([]);
    });
  });
});
