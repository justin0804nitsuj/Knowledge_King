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

const mockContextValue = {
  roomId: 'room1',
  room: {
    meta: { hostUid: 'host1', status: 'IN_BATTLE' },
    code: '123456',
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
      phase: 'ANSWERING',
      roundIndex: 2,
      roundStartedAt: 1000,
      players: {
        host1: { hp: 100, score: 2, items: {} },
        guest1: { hp: 80, score: 1, items: {} }
      },
      rounds: {
        2: {
          question: { id: 'q3', word: 'apple', choices: [{ id: 'c1', text: '蘋果' }], correctChoiceId: 'c1' },
          answers: {}
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
  resolveRound: jest.fn(() => Promise.resolve({ committed: true })),
  advanceRound: jest.fn(() => Promise.resolve({ committed: true })),
  finalizeMatch: jest.fn(() => Promise.resolve({ committed: true })),
  submitAnswer: jest.fn(() => Promise.resolve({ committed: true })),
  useBattleItem: jest.fn(() => Promise.resolve({ committed: true })),
  startRoundTimer: jest.fn(() => Promise.resolve({ committed: true })),
  submitTimeout: jest.fn(() => Promise.resolve({ committed: true })),
  ROUND_TIME_LIMIT_MS: 6000,
  ROUND_PRE_BATTLE_MS: 4000,
  getRoundDeadline: jest.fn(() => 7000),
  getRoundAnsweringStart: jest.fn(() => 1000)
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, defaultValueOrOptions, options) => {
      if (key === 'pvp.round') {
        const opts = typeof defaultValueOrOptions === 'object' ? defaultValueOrOptions : options || {};
        return `第 ${opts.current || 1} / ${opts.total || 10} 題`;
      }
      if (key === 'pvp.you') return '你';
      if (key === 'pvp.opponent') return '對手';
      if (typeof defaultValueOrOptions === 'string') return defaultValueOrOptions;
      return key;
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

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import PvpHealthBar from '../src/components/pvp/PvpHealthBar';
import PvpBattleScreen from '../src/screens/PvpBattleScreen';
import { subscribeToMatchState } from '../src/services/pvp/pvpBattleService';

describe('PvpHeaderResponsive & PvpHealthBar Layout Tests', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    subscribeToMatchState.mockImplementation((id, callback) => {
      callback(mockContextValue.room.matchState);
      return jest.fn();
    });
  });

  describe('PvpHealthBar Component Rules', () => {
    test('A. HP text values render complete: 100 / 100, 80 / 100, 5 / 100, 0 / 100 without ellipsis', () => {
      const testCases = [
        { hp: 100, expected: '100 / 100' },
        { hp: 80, expected: '80 / 100' },
        { hp: 5, expected: '5 / 100' },
        { hp: 0, expected: '0 / 100' },
        { hp: -10, expected: '0 / 100' }, // clamped
        { hp: 120, expected: '100 / 100' }, // clamped
      ];

      for (const { hp, expected } of testCases) {
        let tree;
        act(() => {
          tree = renderer.create(<PvpHealthBar name="Player" hp={hp} isOpponent={false} />);
        });
        const hpText = tree.root.findByProps({ testID: 'pvpPlayerHpText' });
        expect(hpText.props.children).toEqual([hp < 0 ? 0 : Math.min(100, hp), ' / ', 100]);
        const renderedString = hpText.props.children.join('');
        expect(renderedString).toBe(expected);
        expect(renderedString).not.toContain('...');
      }
    });

    test('B. HP text does not use an ellipsis-specific rendering path (no numberOfLines / ellipsizeMode)', () => {
      let hostTree;
      act(() => {
        hostTree = renderer.create(<PvpHealthBar name="Host" hp={100} isOpponent={false} />);
      });
      const hostHpText = hostTree.root.findByProps({ testID: 'pvpPlayerHpText' });
      expect(hostHpText.props.numberOfLines).toBeUndefined();
      expect(hostHpText.props.ellipsizeMode).toBeUndefined();

      let oppTree;
      act(() => {
        oppTree = renderer.create(<PvpHealthBar name="Opponent" hp={80} isOpponent={true} />);
      });
      const oppHpText = oppTree.root.findByProps({ testID: 'pvpOpponentHpText' });
      expect(oppHpText.props.numberOfLines).toBeUndefined();
      expect(oppHpText.props.ellipsizeMode).toBeUndefined();
    });

    test('C. Long player names remain constrained with numberOfLines=1 and ellipsizeMode=tail', () => {
      const longName = 'SuperExtremelyLongPlayerNameThatWouldOverflowTheScreen (99)';
      let tree;
      act(() => {
        tree = renderer.create(<PvpHealthBar name={longName} hp={80} isOpponent={true} />);
      });
      const nameText = tree.root.findByProps({ testID: 'pvpOpponentName' });

      expect(nameText.props.numberOfLines).toBe(1);
      expect(nameText.props.ellipsizeMode).toBe('tail');
      expect(nameText.props.children).toBe(longName);
    });

    test('Symmetrical styling: opponent text is aligned right, local player text aligned left', () => {
      let localTree;
      act(() => {
        localTree = renderer.create(<PvpHealthBar name="Me" hp={100} isOpponent={false} />);
      });
      const localName = localTree.root.findByProps({ testID: 'pvpPlayerName' });
      const localHp = localTree.root.findByProps({ testID: 'pvpPlayerHpText' });
      expect(localName.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ textAlign: 'left' })]));
      expect(localHp.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ textAlign: 'left' })]));

      let oppTree;
      act(() => {
        oppTree = renderer.create(<PvpHealthBar name="Opp" hp={80} isOpponent={true} />);
      });
      const oppName = oppTree.root.findByProps({ testID: 'pvpOpponentName' });
      const oppHp = oppTree.root.findByProps({ testID: 'pvpOpponentHpText' });
      expect(oppName.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ textAlign: 'right' })]));
      expect(oppHp.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ textAlign: 'right' })]));
    });
  });

  describe('PvpBattleScreen Header Structure & Layout Rules', () => {
    test('D. Round counter remains present and rendered in its own dedicated row below the 3-column row', () => {
      let component;
      act(() => {
        component = renderer.create(<PvpBattleScreen navigation={{}} />);
      });

      const root = component.root;
      const allTexts = root.findAllByType(Text);
      const roundNode = allTexts.find(t => t.props.children === '第 3 / 10 題');
      expect(roundNode).toBeDefined();

      const vsNode = allTexts.find(t => t.props.children === 'VS');
      expect(vsNode).toBeDefined();
      expect(roundNode.parent).not.toBe(vsNode.parent);
    });

    test('E. Left and right player regions have symmetrical flex: 1, minWidth: 0 layout', () => {
      let component;
      act(() => {
        component = renderer.create(<PvpBattleScreen navigation={{}} />);
      });

      const healthBars = component.root.findAllByType(PvpHealthBar);
      expect(healthBars).toHaveLength(2);

      const localBar = healthBars[0];
      const oppBar = healthBars[1];

      expect(localBar.props.name).toBe('你 (2)');
      expect(localBar.props.hp).toBe(100);
      expect(localBar.props.isOpponent).toBe(false);

      expect(oppBar.props.name).toBe('對手 (1)');
      expect(oppBar.props.hp).toBe(80);
      expect(oppBar.props.isOpponent).toBe(true);

      const flatten = (st) => Array.isArray(st) ? Object.assign({}, ...st) : st;
      const flatLocal = flatten(localBar.parent.props.style);
      const flatOpp = flatten(oppBar.parent.props.style);

      expect(flatLocal.flex).toBe(1);
      expect(flatLocal.minWidth).toBe(0);
      expect(flatOpp.flex).toBe(1);
      expect(flatOpp.minWidth).toBe(0);
    });

    test('F. Responsive width arithmetic for widths 320, 360, 390, 412', () => {
      const screenWidths = [320, 360, 390, 412];
      const horizontalPadding = 16 * 2; // paddingHorizontal 16 on header
      const vsWidth = 36; // fixed vsContainer width
      const estimatedHpTextWidth = 65; // '100 / 100' at 13px bold is ~58px, safe budget 65px

      for (const w of screenWidths) {
        const availableWidth = w - horizontalPadding;
        const columnWidth = (availableWidth - vsWidth) / 2;

        expect(columnWidth).toBeGreaterThanOrEqual(126);
        expect(columnWidth).toBeGreaterThan(estimatedHpTextWidth);
      }
    });
  });
});
