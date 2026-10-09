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
import { Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import PvpHealthBar from '../src/components/pvp/PvpHealthBar';
import PvpItemBar from '../src/components/pvp/PvpItemBar';
import { subscribeToMatchState } from '../src/services/pvp/pvpBattleService';

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
      roundIndex: 0,
      phase: 'ANSWERING',
      players: {
        host1: {
          hp: 100,
           score: 0,
          items: {
            HEAL: { remaining: 2 },
            SHIELD: { remaining: 1 },
            POWER: { remaining: 1 }
          }
        },
        guest1: {
          hp: 100, score: 0,
          items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } }
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
jest.mock('../src/services/pvp/pvpBattleService', () => ({
  subscribeToMatchState: jest.fn(),
  resolveRound: jest.fn(), advanceRound: jest.fn(), finalizeMatch: jest.fn(),
  submitAnswer: jest.fn(), useBattleItem: jest.fn(),
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
  let component;
  let subscriber;
  const stopListener = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    subscribeToMatchState.mockImplementation((id, callback) => {
      subscriber = callback;
      callback(mockContextValue.room.matchState);
      return stopListener;
    });
  });

  afterEach(() => {
    if (component) act(() => { component.unmount(); });
    component = null;
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('Countdown sequence hides question content via opacity but keeps layout', () => {
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
    expect(texts).toContain('×2'); // HEAL
    expect(texts).toContain('×1'); // SHIELD
    expect(subscribeToMatchState).toHaveBeenCalledTimes(1);
    const questionContainer = root.findByType(ScrollView);
    expect(StyleSheet.flatten(questionContainer.props.style).opacity).toBe(0);
    expect(questionContainer.props.pointerEvents).toBe('none');
    root.findAllByType(TouchableOpacity).forEach(button => expect(button.props.disabled).toBe(true));
    
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
    expect(root.findByType(ScrollView)).toBe(questionContainer);
    expect(StyleSheet.flatten(questionContainer.props.style).opacity).not.toBe(0);
    expect(subscribeToMatchState).toHaveBeenCalledTimes(1);
    act(() => { component.unmount(); });
    component = null;
    expect(stopListener).toHaveBeenCalledTimes(1);
  });

  test('delayed live matchState prepares without fake HP or inventory, then starts countdown', () => {
    subscribeToMatchState.mockImplementation((id, callback) => {
      subscriber = callback;
      return stopListener;
    });
    act(() => { component = renderer.create(<PvpBattleScreen navigation={{}} />); });
    expect(subscribeToMatchState).toHaveBeenCalledWith('room1', expect.any(Function));
    expect(component.root.findAllByType(PvpHealthBar)).toHaveLength(0);
    expect(component.root.findAllByType(PvpItemBar)).toHaveLength(0);
    act(() => { jest.advanceTimersByTime(5000); });
    expect(component.root.findAllByType(ScrollView)).toHaveLength(0);
    const live = JSON.parse(JSON.stringify(mockContextValue.room.matchState));
    live.players.host1.hp = 55;
    live.players.host1.items.HEAL.remaining = 1;
    act(() => { subscriber(live); });
    expect(component.root.findAllByType(PvpHealthBar)[0].props.hp).toBe(55);
    expect(component.root.findByType(PvpItemBar).props.items.HEAL.remaining).toBe(1);
    expect(StyleSheet.flatten(component.root.findByType(ScrollView).props.style).opacity).toBe(0);
    expect(component.root.findAllByType(Text).some(node => node.props.children === 3)).toBe(true);
    const updated = JSON.parse(JSON.stringify(live));
    updated.players.host1.hp = 80;
    act(() => { subscriber(updated); });
    expect(component.root.findAllByType(PvpHealthBar)[0].props.hp).toBe(80);
  });
});
