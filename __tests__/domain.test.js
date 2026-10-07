import { getAvailableLevels, getWordsByLevel, getWordById } from '../src/domain/vocabulary/vocabularyRepository';
import { generateQuestion } from '../src/domain/vocabulary/questionGenerator';
import { createSeededRandom } from '../src/domain/game/seededRandom';
import { createInitialState, nextQuestion, answerQuestion, BATTLE_STATES } from '../src/domain/game/battleEngine';
import { getSemanticFingerprint, getAllSemanticFingerprints, getDisplayMeaning } from '../src/domain/vocabulary/meaningResolver';
import { getCampaignStages, STAGE_TYPES, getStageById } from '../src/domain/adventure/campaignConfig';
import { isStageUnlocked, getNextStage } from '../src/domain/adventure/campaignProgress';
import { calculateStars } from '../src/domain/adventure/starRating';

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
    
    // Check Review target word is non-empty
    expect(question.word).toBeDefined();
    expect(question.word.length).toBeGreaterThan(0);
    
    const correctChoices = question.choices.filter(c => c.isCorrect);
    expect(correctChoices.length).toBe(1);
    expect(correctChoices[0].id).toBe(targetWord.id);

    const fingerprints = new Set();
    const ids = new Set();
    for (const c of question.choices) {
      // Find the word object to get ALL its learner meanings
      const wordObj = getWordById(1, c.id);
      const wFps = getAllSemanticFingerprints(wordObj);
      for (const fp of wFps) {
        expect(fingerprints.has(fp)).toBe(false);
        fingerprints.add(fp);
      }
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
    }
  });
});

describe('Meaning Resolver', () => {
  test('hide does not resolve to the obscure 獸皮 learner-facing display meaning', () => {
    const words = getWordsByLevel(1);
    const hideWord = words.find(w => w.word.toLowerCase() === 'hide');
    expect(hideWord).toBeDefined();
    
    const displayMeaning = getDisplayMeaning(hideWord);
    expect(displayMeaning).not.toContain('獸皮');
    expect(displayMeaning).toContain('隱藏'); // fallback meaning is '躲藏／隱藏'
  });

  test('semantic collision filtering still considers all senses', () => {
    const words = getWordsByLevel(1);
    const hideWord = words.find(w => w.word.toLowerCase() === 'hide');
    
    const fps = getAllSemanticFingerprints(hideWord);
    // Even if display meaning is not '獸皮', the collision filter should still know about it from secondary/primary definitions.
    const hasSkinMeaning = Array.from(fps).some(fp => fp.includes('獸皮') || fp.includes('獸皮(n)'));
    expect(hasSkinMeaning).toBe(true);
  });
});

describe('RNG and Determinism', () => {
  test('same seed + same ruleset + same dataset produces identical deterministic sequence', () => {
    const levelWords = getWordsByLevel(1);
    const config = getStageById('L1-S1');
    
    let stateA = createInitialState(42, 1, levelWords, config);
    stateA = nextQuestion(stateA);
    const qA1 = stateA.currentQuestion;
    
    let stateB = createInitialState(42, 1, levelWords, config);
    stateB = nextQuestion(stateB);
    const qB1 = stateB.currentQuestion;
    
    expect(qA1.targetId).toBe(qB1.targetId);
    expect(qA1.choices.map(c => c.id)).toEqual(qB1.choices.map(c => c.id));
  });

  test('different seed produces different sequence in normal cases', () => {
    const levelWords = getWordsByLevel(1);
    const config = getStageById('L1-S1');

    let stateA = createInitialState(42, 1, levelWords, config);
    stateA = nextQuestion(stateA);
    
    let stateB = createInitialState(43, 1, levelWords, config);
    stateB = nextQuestion(stateB);
    
    expect(stateA.currentQuestion.targetId).not.toBe(stateB.currentQuestion.targetId);
  });
});

describe('Battle Engine with Config', () => {
  test('Normal config applies correctly (80 enemy HP, requires 4 correct)', () => {
    const config = getStageById('L1-S1');
    expect(config.enemyHp).toBe(80);
    
    let state = createInitialState(1, 1, getWordsByLevel(1), config);
    for (let i = 0; i < 4; i++) {
      state = nextQuestion(state);
      state = answerQuestion(state, state.currentQuestion.correctChoiceId, 5000);
    }
    expect(state.opponentHp).toBe(0);
    expect(state.status).toBe(BATTLE_STATES.VICTORY);
  });

  test('Elite config applies correctly (100 enemy HP, requires 5 correct)', () => {
    const config = getStageById('L1-E1');
    expect(config.enemyHp).toBe(100);
    
    let state = createInitialState(1, 1, getWordsByLevel(1), config);
    for (let i = 0; i < 5; i++) {
      state = nextQuestion(state);
      state = answerQuestion(state, state.currentQuestion.correctChoiceId, 5000);
    }
    expect(state.opponentHp).toBe(0);
    expect(state.status).toBe(BATTLE_STATES.VICTORY);
  });

  test('Boss config applies correctly (120 enemy HP, requires 6 correct)', () => {
    const config = getStageById('L1-BOSS');
    expect(config.enemyHp).toBe(120);
    
    let state = createInitialState(1, 1, getWordsByLevel(1), config);
    for (let i = 0; i < 6; i++) {
      state = nextQuestion(state);
      state = answerQuestion(state, state.currentQuestion.correctChoiceId, 5000);
    }
    expect(state.opponentHp).toBe(0);
    expect(state.status).toBe(BATTLE_STATES.VICTORY);
  });
});

describe('Campaign Config', () => {
  test('exactly 6 worlds, 5 stages per world, 30 unique IDs', () => {
    const stages = getCampaignStages();
    expect(stages.length).toBe(30);
    
    const uniqueIds = new Set(stages.map(s => s.id));
    expect(uniqueIds.size).toBe(30);
    
    const bossCount = stages.filter(s => s.type === STAGE_TYPES.BOSS).length;
    expect(bossCount).toBe(6);

    const eliteCount = stages.filter(s => s.type === STAGE_TYPES.ELITE).length;
    expect(eliteCount).toBe(6);
  });
});

describe('Unlock progression', () => {
  test('fresh install only L1-S1 unlocked', () => {
    const emptyProgress = { clearedStages: [] };
    expect(isStageUnlocked(emptyProgress, 'L1-S1')).toBe(true);
    expect(isStageUnlocked(emptyProgress, 'L1-S2')).toBe(false);
  });

  test('L1-S1 victory unlocks L1-S2', () => {
    const progress = { clearedStages: ['L1-S1'] };
    expect(isStageUnlocked(progress, 'L1-S2')).toBe(true);
  });

  test('Boss victory unlocks next world Stage 1', () => {
    const progress = { clearedStages: ['L1-BOSS'] };
    expect(isStageUnlocked(progress, 'L2-S1')).toBe(true);
  });

  test('getNextStage helper returns correct next stage', () => {
    expect(getNextStage('L1-S1')).toBe('L1-S2');
    expect(getNextStage('L1-E1')).toBe('L1-BOSS');
    expect(getNextStage('L1-BOSS')).toBe('L2-S1');
    expect(getNextStage('L6-BOSS')).toBe(null);
  });
});

describe('Star Rating', () => {
  test('Defeat: 0 stars', () => {
    expect(calculateStars(false, 4, 1, 0)).toBe(0);
  });

  test('Perfect victory: 3 stars', () => {
    expect(calculateStars(true, 4, 0, 0)).toBe(3);
  });

  test('Victory >= 80% accuracy: 2 stars', () => {
    // 4 correct, 1 wrong = 4/5 = 80%
    expect(calculateStars(true, 4, 1, 0)).toBe(2);
  });

  test('Victory < 80% accuracy: 1 star', () => {
    // 4 correct, 2 wrong = 4/6 = 66%
    expect(calculateStars(true, 4, 2, 0)).toBe(1);
  });
});
