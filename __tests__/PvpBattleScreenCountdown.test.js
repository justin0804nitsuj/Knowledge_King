jest.mock('firebase/database', () => ({
  ref: jest.fn(), onValue: jest.fn(), off: jest.fn(), get: jest.fn(), set: jest.fn(),
  update: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn(), remove: jest.fn(), onDisconnect: jest.fn(),
  getDatabase: jest.fn()
}));
jest.mock('../src/services/firebase/firebaseApp', () => ({}));
jest.mock('../src/services/firebase/firebaseDatabase', () => ({
  db: {}
}));
jest.mock('firebase/auth', () => ({
  initializeAuth: jest.fn(),
  getReactNativePersistence: jest.fn(),
  onAuthStateChanged: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signInWithCredential: jest.fn(),
  signOut: jest.fn()
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(), getItem: jest.fn(), removeItem: jest.fn()
}));
jest.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: { configure: jest.fn() },
  isSuccessResponse: jest.fn()
}));

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PvpBattleScreen from '../src/screens/PvpBattleScreen';
import { Text } from 'react-native';

const mockContextValue = {
  roomId: 'room1',
  room: {
    meta: { hostUid: 'host1', status: 'IN_BATTLE' },
    players: { host1: { name: 'Host' }, guest1: { name: 'Guest' } },
    match: { 
      battleSeed: '12345', 
      level: 1, 
      matchId: 'match1',
      rulesetVersion: '1.0.0',
      vocabularyVersion: '1.0.0',
      questionCount: 10
    },
    matchState: {
      players: {
        host1: {
          hp: 100,
           score: 0,
          items: {
            HEAL: { remaining: 2 },
            SHIELD: { remaining: 1 },
            POWER: { remaining: 1 }
          }
        }
      }
    }
  },
  isHost: true,
  user: { uid: 'host1' }
};

jest.mock('../src/context/PvpRoomContext', () => ({
  usePvpRoom: () => mockContextValue
}));

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ 
    t: (k, defaultText, options) => {
      if (typeof defaultText === 'object') return k;
      if (typeof defaultText === 'string') return defaultText;
      return k;
    }
  })
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons'
}));
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children }) => <View>{children}</View>,
    SafeAreaProvider: ({ children }) => <View>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 })
  };
});
jest.mock('../src/services/feedback/gameFeedback', () => ({
  gameFeedback: {
    init: jest.fn(), cleanup: jest.fn(), playDamage: jest.fn(),
    playHeal: jest.fn(), playOpponentHit: jest.fn(), playCountdownGo: jest.fn(),
    playCountdownTick: jest.fn(), playDraw: jest.fn(), playAnswerCorrect: jest.fn(),
    playAnswerWrong: jest.fn(), playVictory: jest.fn(), playDefeat: jest.fn()
  }
}));

describe('PvpBattleScreen - Countdown Layout & Visibility', () => {
  const mockRoom = {
    meta: { hostUid: 'host1', status: 'IN_BATTLE' },
    players: { host1: { name: 'Host' }, guest1: { name: 'Guest' } },
    match: {
      seed: 12345,
      level: 1,
      questionCount: 10
    }
  };

  const contextValue = {
    roomId: 'room1',
    room: mockRoom,
    isHost: true,
    user: { uid: 'host1' }
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('Countdown sequence hides question content via opacity but keeps layout', () => {
    let component;
    act(() => {
      component = renderer.create(
        <PvpBattleScreen navigation={{}} />
      );
    });

    const root = component.root;
    
    const getTexts = () => {
      return root.findAllByType(Text).map(t => {
        const children = t.props.children;
        if (children == null) return '';
        if (Array.isArray(children)) {
          return children.map(c => c != null ? String(c) : '').join('');
        }
        return String(children);
      });
    };

    let texts = getTexts();
    
    // Initial countdown starts at 3
    expect(texts).toContain('3');
    
    // HP bars render
    expect(texts).toContain('pvp.you (0)');
    expect(texts).toContain('pvp.opponent (0)');

    // Item bar renders with x counts
    console.log("MOCK USER:", mockContextValue.user.uid);
    console.log("MOCK PLAYERS:", mockContextValue.room.matchState.players);
    console.log(texts);
    expect(texts).toContain('×2'); // HEAL
    expect(texts).toContain('×1'); // SHIELD
    
    act(() => { jest.advanceTimersByTime(1000); });
    texts = getTexts();
    expect(texts).toContain('2');
    
    act(() => { jest.advanceTimersByTime(1000); });
    texts = getTexts();
    expect(texts).toContain('1');
    
    act(() => { jest.advanceTimersByTime(1000); });
    texts = getTexts();
    expect(texts).toContain('pvp.go'); // GO!
    
    act(() => { jest.advanceTimersByTime(1000); });
    texts = getTexts();
    
    // After GO, countdown unmounts, question remains visible
    expect(texts).not.toContain('pvp.go');
    expect(texts).not.toContain('3');
    expect(texts).toContain('Question 1');
  });
});
