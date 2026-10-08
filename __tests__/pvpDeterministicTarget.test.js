import { createInitialState, nextQuestion } from '../src/domain/game/battleEngine';
import { getWordsByLevel } from '../src/domain/vocabulary/vocabularyRepository';

describe('pvp deterministic target', () => {
  test('generates exactly identical targets for same seed', () => {
    const seed = 123456789;
    const level = 1;
    const words = getWordsByLevel(level);
    const config = { playerHp: 3, enemyHp: 3, timePerQuestionMs: 10000 };
    
    // Client A
    let stateA = createInitialState(seed, level, words, config);
    stateA = nextQuestion(stateA);
    const a1 = stateA.currentQuestion.targetId;
    stateA = { ...stateA, status: 'QUESTION_RESOLVED' };
    stateA = nextQuestion(stateA);
    const a2 = stateA.currentQuestion.targetId;
    stateA = { ...stateA, status: 'QUESTION_RESOLVED' };
    stateA = nextQuestion(stateA);
    const a3 = stateA.currentQuestion.targetId;
    
    // Client B
    let stateB = createInitialState(seed, level, words, config);
    stateB = nextQuestion(stateB);
    const b1 = stateB.currentQuestion.targetId;
    stateB = { ...stateB, status: 'QUESTION_RESOLVED' };
    stateB = nextQuestion(stateB);
    const b2 = stateB.currentQuestion.targetId;
    stateB = { ...stateB, status: 'QUESTION_RESOLVED' };
    stateB = nextQuestion(stateB);
    const b3 = stateB.currentQuestion.targetId;
    
    console.log("ACTUAL TARGETS:", a1, a2, a3);
    
    expect(a1).toBe(b1);
    expect(a2).toBe(b2);
    expect(a3).toBe(b3);
    
    // Ensure they don't repeat
    expect(a1).not.toBe(a2);
    expect(a2).not.toBe(a3);
    expect(a1).not.toBe(a3);
  });
});
