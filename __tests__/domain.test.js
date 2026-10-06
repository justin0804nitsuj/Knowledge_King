import { getAvailableLevels, getWordsByLevel, getWordById } from '../src/domain/vocabulary/vocabularyRepository';
import { generateQuestion } from '../src/domain/vocabulary/questionGenerator';
import { createSeededRandom } from '../src/domain/game/seededRandom';
import { createInitialState, nextQuestion, answerQuestion, BATTLE_STATES } from '../src/domain/game/battleEngine';
import { BATTLE_CONSTANTS } from '../src/domain/game/battleRules';
import { getSemanticFingerprint, getDisplayMeaning } from '../src/domain/vocabulary/meaningResolver';

describe('Vocabulary Domain', () => {
  test('six levels are available', () => {
    const levels = getAvailableLevels();
    expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('each level exposes 1002 entries', () => {
    for (let i = 1; i <= 6; i++) {
      const words = getWordsByLevel(i);
      expect(words.length).toBe(1002);
    }
  });

  test('known word can be retrieved by ID', () => {
    // We know 'plane' is in level 1 from earlier checks, let's just grab the first word
    const words = getWordsByLevel(1);
    const knownWord = words[0];
    const retrieved = getWordById(1, knownWord.id);
    expect(retrieved).toBeDefined();
    expect(retrieved.id).toBe(knownWord.id);
  });
});

describe('Question Generator', () => {
  test('generated question has exactly 4 unique choices, exactly one is correct', () => {
    const levelWords = getWordsByLevel(1);
    const targetWord = levelWords[0];
    const rng = createSeededRandom(12345);
    
    const question = generateQuestion(targetWord, levelWords, rng);
    expect(question.choices.length).toBe(4);
    
    const correctChoices = question.choices.filter(c => c.isCorrect);
    expect(correctChoices.length).toBe(1);
    expect(correctChoices[0].id).toBe(targetWord.id);

    // Verify unique choices (by fingerprint and ID)
    const fingerprints = new Set();
    const ids = new Set();
    for (const c of question.choices) {
      const fp = getSemanticFingerprint(c.text);
      expect(fingerprints.has(fp)).toBe(false);
      fingerprints.add(fp);
      
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });
});

describe('RNG and Determinism', () => {
  test('same seed produces identical sequence of target and choices', () => {
    const levelWords = getWordsByLevel(1);
    
    // Battle A
    let stateA = createInitialState(42, 1, levelWords);
    stateA = nextQuestion(stateA);
    const qA1 = stateA.currentQuestion;
    
    // Battle B
    let stateB = createInitialState(42, 1, levelWords);
    stateB = nextQuestion(stateB);
    const qB1 = stateB.currentQuestion;
    
    expect(qA1.targetId).toBe(qB1.targetId);
    expect(qA1.choices.map(c => c.id)).toEqual(qB1.choices.map(c => c.id));
  });

  test('different seed produces different sequence', () => {
    const levelWords = getWordsByLevel(1);
    let stateA = createInitialState(42, 1, levelWords);
    stateA = nextQuestion(stateA);
    
    let stateB = createInitialState(43, 1, levelWords);
    stateB = nextQuestion(stateB);
    
    expect(stateA.currentQuestion.targetId).not.toBe(stateB.currentQuestion.targetId);
  });
});

describe('Battle Engine', () => {
  test('Initial 100 HP vs 100 HP', () => {
    const state = createInitialState(1, 1, getWordsByLevel(1));
    expect(state.playerHp).toBe(100);
    expect(state.opponentHp).toBe(100);
    expect(state.status).toBe(BATTLE_STATES.READY);
  });

  test('Five correct: victory', () => {
    let state = createInitialState(1, 1, getWordsByLevel(1));
    
    for (let i = 0; i < 5; i++) {
      state = nextQuestion(state);
      state = answerQuestion(state, state.currentQuestion.correctChoiceId, 5000);
    }
    
    expect(state.opponentHp).toBe(0);
    expect(state.status).toBe(BATTLE_STATES.VICTORY);
    expect(state.correctCount).toBe(5);
  });

  test('Five wrong: defeat', () => {
    let state = createInitialState(1, 1, getWordsByLevel(1));
    
    for (let i = 0; i < 5; i++) {
      state = nextQuestion(state);
      const wrongChoice = state.currentQuestion.choices.find(c => !c.isCorrect);
      state = answerQuestion(state, wrongChoice.id, 5000);
    }
    
    expect(state.playerHp).toBe(0);
    expect(state.status).toBe(BATTLE_STATES.DEFEAT);
    expect(state.wrongCount).toBe(5);
  });

  test('Timeout: exactly one player damage event', () => {
    let state = createInitialState(1, 1, getWordsByLevel(1));
    state = nextQuestion(state);
    state = answerQuestion(state, null, 0); // null means timeout
    
    expect(state.playerHp).toBe(100 - BATTLE_CONSTANTS.DAMAGE_PER_TIMEOUT);
    expect(state.opponentHp).toBe(100);
    expect(state.timeoutCount).toBe(1);
    expect(state.combo).toBe(0);
  });

  test('Double answer: must not apply score/damage twice', () => {
    let state = createInitialState(1, 1, getWordsByLevel(1));
    state = nextQuestion(state);
    state = answerQuestion(state, state.currentQuestion.correctChoiceId, 5000);
    const stateAfterFirst = state;
    
    // Attempt second answer
    state = answerQuestion(state, state.currentQuestion.correctChoiceId, 5000);
    expect(state).toBe(stateAfterFirst); // Should return same object if not active
  });

  test('same battle does not repeat target IDs', () => {
    let state = createInitialState(1, 1, getWordsByLevel(1));
    
    // Simulate a battle up to 9 questions
    const targets = new Set();
    for (let i = 0; i < 9; i++) {
      state = nextQuestion(state);
      if (state.status === BATTLE_STATES.VICTORY || state.status === BATTLE_STATES.DEFEAT) break;
      
      const targetId = state.currentQuestion.targetId;
      expect(targets.has(targetId)).toBe(false);
      targets.add(targetId);
      
      // Answer alternately right and wrong to stretch out the battle
      if (i % 2 === 0) {
        state = answerQuestion(state, state.currentQuestion.correctChoiceId, 5000);
      } else {
        state = answerQuestion(state, null, 0);
      }
    }
  });
});
