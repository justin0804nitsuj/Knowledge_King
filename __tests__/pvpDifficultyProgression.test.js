jest.mock('firebase/database', () => ({
  ref: jest.fn(), onValue: jest.fn(), off: jest.fn(), get: jest.fn(), set: jest.fn(),
  update: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn(), remove: jest.fn(), onDisconnect: jest.fn(),
  getDatabase: jest.fn()
}));
jest.mock('../src/services/firebase/firebaseApp', () => ({}));
jest.mock('../src/services/firebase/firebaseDatabase', () => ({
  db: {}
}));

import { getPvpLevelForRound, createPvpQuestions } from '../src/domain/pvp/pvpQuestions';
import { getWordsByLevel } from '../src/domain/vocabulary/vocabularyRepository';
import { createInitialState, nextQuestion, BATTLE_STATES } from '../src/domain/game/battleEngine';
import { calculateRoundDamage, calculateSpeedOutcome } from '../src/services/pvp/pvpBattleService';

describe('Phase 11D - PvP Difficulty Progression (Level 4 -> 5 -> 6)', () => {
  describe('Helper getPvpLevelForRound', () => {
    test('A. roundIndex 0 -> Level 4', () => {
      expect(getPvpLevelForRound(0)).toBe(4);
    });

    test('B. roundIndex 1 -> Level 4', () => {
      expect(getPvpLevelForRound(1)).toBe(4);
    });

    test('C. roundIndex 2 -> Level 4', () => {
      expect(getPvpLevelForRound(2)).toBe(4);
    });

    test('D. roundIndex 3 -> Level 5', () => {
      expect(getPvpLevelForRound(3)).toBe(5);
    });

    test('E. roundIndex 6 -> Level 5', () => {
      expect(getPvpLevelForRound(6)).toBe(5);
    });

    test('F. roundIndex 7 -> Level 6', () => {
      expect(getPvpLevelForRound(7)).toBe(6);
    });

    test('G. roundIndex 9 -> Level 6', () => {
      expect(getPvpLevelForRound(9)).toBe(6);
    });

    test('H. roundIndex > 9 -> Level 6', () => {
      expect(getPvpLevelForRound(10)).toBe(6);
      expect(getPvpLevelForRound(15)).toBe(6);
      expect(getPvpLevelForRound(99)).toBe(6);
    });
  });

  describe('createPvpQuestions Progression & Integrity', () => {
    const matchConfig = {
      battleSeed: '789456',
      level: 1, // Legacy match config field preserved without polluting question level
      questionCount: 10
    };

    test('I. No PvP question uses Level 1-3 (all questions are Level 4, 5, or 6)', () => {
      // Test across multiple seeds to guarantee comprehensive coverage
      const seeds = ['100', '200', '300', '400', '500', '12345', '999999'];
      for (const seed of seeds) {
        const questions = createPvpQuestions({ battleSeed: seed, questionCount: 10 });
        expect(questions).toHaveLength(10);
        questions.forEach((q) => {
          expect(q.level).not.toBe(1);
          expect(q.level).not.toBe(2);
          expect(q.level).not.toBe(3);
          expect([4, 5, 6]).toContain(q.level);

          // All 4 choices must come from the target level pool
          const validPoolWords = getWordsByLevel(q.level);
          const poolIds = new Set(validPoolWords.map(w => w.id));
          q.choices.forEach(choice => {
            expect(poolIds.has(choice.id)).toBe(true);
          });
        });
      }
    });

    test('J. Host and Guest receive same question for same round', () => {
      const hostQuestions = createPvpQuestions(matchConfig);
      const guestQuestions = createPvpQuestions(matchConfig);

      expect(hostQuestions).toHaveLength(10);
      expect(guestQuestions).toHaveLength(10);
      for (let r = 0; r < 10; r++) {
        expect(hostQuestions[r]).toEqual(guestQuestions[r]);
        expect(hostQuestions[r].targetId).toBe(guestQuestions[r].targetId);
        expect(hostQuestions[r].correctChoiceId).toBe(guestQuestions[r].correctChoiceId);
        expect(hostQuestions[r].choices).toEqual(guestQuestions[r].choices);
      }
    });

    test('K. same seed + same roundIndex -> same question', () => {
      const runA = createPvpQuestions({ battleSeed: '424242', questionCount: 10 });
      const runB = createPvpQuestions({ battleSeed: '424242', questionCount: 10 });

      for (let r = 0; r < 10; r++) {
        expect(runA[r]).toEqual(runB[r]);
      }
    });

    test('L. different round progression correctly changes source Level', () => {
      const questions = createPvpQuestions(matchConfig);
      expect(questions).toHaveLength(10);

      // Rounds 0, 1, 2 must be Level 4
      expect(questions[0].level).toBe(4);
      expect(questions[1].level).toBe(4);
      expect(questions[2].level).toBe(4);

      // Rounds 3, 4, 5, 6 must be Level 5
      expect(questions[3].level).toBe(5);
      expect(questions[4].level).toBe(5);
      expect(questions[5].level).toBe(5);
      expect(questions[6].level).toBe(5);

      // Rounds 7, 8, 9 must be Level 6
      expect(questions[7].level).toBe(6);
      expect(questions[8].level).toBe(6);
      expect(questions[9].level).toBe(6);

      // Words in match must be unique (no repeated target words)
      const targetIds = questions.map(q => q.targetId);
      expect(new Set(targetIds).size).toBe(10);
    });

    test('M. Adventure question generation remains unchanged', () => {
      // Adventure mode uses battleEngine directly with specific level words
      const adventureLevel = 2;
      const words = getWordsByLevel(adventureLevel);
      let state = createInitialState(12345, adventureLevel, words, { playerHp: 100, enemyHp: 100 });
      state = nextQuestion(state);

      expect(state.status).toBe(BATTLE_STATES.QUESTION_ACTIVE);
      expect(state.currentQuestion).toBeDefined();
      expect(state.currentQuestion.level).toBe(2);
      expect(state._level).toBe(2);
    });

    test('N. timer / speed damage regression still passes', () => {
      // 1. Both correct, host faster (>150ms) -> Host 20, Guest 0
      const hostFaster = calculateSpeedOutcome(1000, 1500, true, true);
      expect(hostFaster.speedOutcome).toBe('HOST_FASTER');
      const dmgHostFaster = calculateRoundDamage({
        hostCorrect: true, guestCorrect: true,
        speedOutcome: hostFaster.speedOutcome
      });
      expect(dmgHostFaster.damageToGuest).toBe(20);
      expect(dmgHostFaster.damageToHost).toBe(0);

      // 2. Both correct, <=150ms tie threshold -> 10 / 10
      const tieOutcome = calculateSpeedOutcome(1000, 1100, true, true);
      expect(tieOutcome.speedOutcome).toBe('TIE');
      const dmgTie = calculateRoundDamage({
        hostCorrect: true, guestCorrect: true,
        speedOutcome: tieOutcome.speedOutcome
      });
      expect(dmgTie.damageToGuest).toBe(10);
      expect(dmgTie.damageToHost).toBe(10);

      // 3. One correct -> 20 / 0
      const oneCorrect = calculateRoundDamage({
        hostCorrect: true, guestCorrect: false,
        speedOutcome: 'NONE'
      });
      expect(oneCorrect.damageToGuest).toBe(20);
      expect(oneCorrect.damageToHost).toBe(0);

      // 4. Timeout treated as incorrect -> 0 damage dealt
      const bothTimeout = calculateRoundDamage({
        hostCorrect: false, guestCorrect: false,
        speedOutcome: 'NONE'
      });
      expect(bothTimeout.damageToGuest).toBe(0);
      expect(bothTimeout.damageToHost).toBe(0);
    });
  });
});
