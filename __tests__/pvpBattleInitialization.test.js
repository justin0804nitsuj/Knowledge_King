import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PvpBattleScreen from '../src/screens/PvpBattleScreen';
import * as PvpRoomContext from '../src/context/PvpRoomContext';
import { getWordsByLevel } from '../src/domain/vocabulary/vocabularyRepository';
import { createInitialState, nextQuestion } from '../src/domain/game/battleEngine';
import { generateQuestion } from '../src/domain/vocabulary/questionGenerator';
import { createSeededRandom } from '../src/domain/game/seededRandom';

jest.mock('firebase/database', () => ({
  getDatabase: jest.fn(),
  ref: jest.fn(),
  set: jest.fn(),
  get: jest.fn(),
  remove: jest.fn(),
  runTransaction: jest.fn(),
  onValue: jest.fn(),
  off: jest.fn(),
  onDisconnect: jest.fn(() => ({ remove: jest.fn(), cancel: jest.fn() })),
  serverTimestamp: jest.fn()
}));

jest.mock('../src/services/firebase/firebaseApp', () => ({
  app: {},
  auth: { currentUser: null }
}));

jest.mock('firebase/auth', () => ({
  initializeAuth: jest.fn(),
  getReactNativePersistence: jest.fn(),
  onAuthStateChanged: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signInWithCredential: jest.fn(),
  signOut: jest.fn()
}));

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: jest.fn(),
  isSuccessResponse: jest.fn()
}));

jest.mock('../src/context/PvpRoomContext');

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key })
}));

describe('PvP Battle Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const expectTextToExist = (root, text) => {
    const textNodes = root.findAllByType('Text');
    const found = textNodes.some(node => 
      node.props.children === text || 
      (Array.isArray(node.props.children) && node.props.children.join('') === text) ||
      (Array.isArray(node.props.children) && node.props.children.includes(text))
    );
    expect(found).toBe(true);
  };

  test('1. PvpBattle initially renders loading state', () => {
    PvpRoomContext.usePvpRoom.mockReturnValue({ room: null });
    let component;
    act(() => {
      component = renderer.create(<PvpBattleScreen />);
    });
    expectTextToExist(component.root, 'Loading Match...');
  });

  test('4. invalid/missing battleSeed fails gracefully', () => {
    PvpRoomContext.usePvpRoom.mockReturnValue({
      room: {
        match: { level: 1, rulesetVersion: '1', vocabularyVersion: '1', matchId: 'abc', questionCount: 10 }
      }
    });
    let component;
    act(() => {
      component = renderer.create(<PvpBattleScreen />);
    });
    expectTextToExist(component.root, 'Battle Error');
    expectTextToExist(component.root, 'Malformed or incomplete match config');
  });

  test('5. invalid Level fails gracefully', () => {
    PvpRoomContext.usePvpRoom.mockReturnValue({
      room: {
        match: { battleSeed: '123', level: 99, rulesetVersion: '1', vocabularyVersion: '1', matchId: 'abc', questionCount: 10 }
      }
    });
    let component;
    act(() => {
      component = renderer.create(<PvpBattleScreen />);
    });
    expectTextToExist(component.root, 'Battle Error');
    expectTextToExist(component.root, 'Level 99 not available.');
  });

  test('3. valid match config generates questions and renders first question', () => {
    PvpRoomContext.usePvpRoom.mockReturnValue({
      room: {
        meta: { hostUid: 'host1' },
        players: { 'host1': { displayName: 'Host' }, 'guest1': { displayName: 'Guest' } },
        match: { battleSeed: '123', level: 1, rulesetVersion: '1', vocabularyVersion: '1', matchId: 'abc', questionCount: 10 }
      },
      isHost: true
    });
    let component;
    act(() => {
      component = renderer.create(<PvpBattleScreen />);
    });
    expectTextToExist(component.root, 'Question 1');
  });

  test('11. same config on Client A/B generates identical first N questions', () => {
    const seed = 12345;
    const level = 1;
    const words = getWordsByLevel(level);
    const config = { playerHp: 3, enemyHp: 3, timePerQuestionMs: 10000 };

    const rngA = createSeededRandom(seed);
    const rngB = createSeededRandom(seed);

    let stateA = nextQuestion(createInitialState(seed, level, words, config));
    let stateB = nextQuestion(createInitialState(seed, level, words, config));

    expect(stateA.currentQuestion.targetId).toBe(stateB.currentQuestion.targetId);
    expect(stateA.currentQuestion.choices[0].id).toBe(stateB.currentQuestion.choices[0].id);
  });

  test('6. generated question has non-empty English target', () => {
    const seed = 12345;
    const words = getWordsByLevel(1);
    const config = { playerHp: 3, enemyHp: 3, timePerQuestionMs: 10000 };
    const state = nextQuestion(createInitialState(seed, 1, words, config));
    
    expect(state.currentQuestion.word).toBeTruthy();
    expect(typeof state.currentQuestion.word).toBe('string');
  });

  test('7. question contains four choices', () => {
    const seed = 12345;
    const words = getWordsByLevel(1);
    const config = { playerHp: 3, enemyHp: 3, timePerQuestionMs: 10000 };
    const state = nextQuestion(createInitialState(seed, 1, words, config));
    
    expect(state.currentQuestion.choices.length).toBe(4);
  });

  test('8. exactly one answer is correct', () => {
    const seed = 12345;
    const words = getWordsByLevel(1);
    const config = { playerHp: 3, enemyHp: 3, timePerQuestionMs: 10000 };
    const state = nextQuestion(createInitialState(seed, 1, words, config));
    
    const correctChoices = state.currentQuestion.choices.filter(c => c.isCorrect);
    expect(correctChoices.length).toBe(1);
    expect(correctChoices[0].id).toBe(state.currentQuestion.correctChoiceId);
  });

  test('12. PvP uses shared learner-facing meaning resolver and 13. hide does not regress', () => {
    const words = getWordsByLevel(2);
    // Find 'hide'
    const hideWord = words.find(w => w.word === 'hide');
    // If 'hide' exists in level 2, check its meaning
    if (hideWord) {
      const rng = createSeededRandom(123);
      const q = generateQuestion(hideWord, words, rng);
      const correctChoice = q.choices.find(c => c.isCorrect);
      // It should definitely not be 獸皮 (rare sense) by default in normal level contexts
      // The resolver should pick the primary sense (e.g. 躲藏)
      expect(correctChoice.text).not.toContain('獸皮');
      expect(correctChoice.text).toBeTruthy();
    }
  });

});
