import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Text, Animated } from 'react-native';
import { calculateSpeedOutcome, NEAR_TIE_THRESHOLD_MS } from '../src/services/pvp/pvpBattleService';
import PvpBattleScreen from '../src/screens/PvpBattleScreen';
import * as PvpRoomContext from '../src/context/PvpRoomContext';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-audio', () => ({ setAudioModeAsync: jest.fn(), createAudioPlayer: jest.fn() }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {}
}));
jest.mock('../src/services/feedback/gameFeedback', () => ({
  gameFeedback: {
    init: jest.fn(),
    cleanup: jest.fn(),
    playDamage: jest.fn(),
    playHeal: jest.fn(),
    playOpponentHit: jest.fn(),
    playCountdownGo: jest.fn(),
    playCountdownTick: jest.fn(),
    playDraw: jest.fn(),
    playAnswerCorrect: jest.fn(),
    playAnswerWrong: jest.fn(),
    playVictory: jest.fn(),
    playDefeat: jest.fn(),
    updateSettings: jest.fn()
  }
}));

jest.mock('firebase/database', () => ({
  getDatabase: jest.fn(),
  ref: jest.fn((db, path) => path),
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
jest.mock('../src/services/firebase/firebaseDatabase', () => ({ db: {} }));

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
  GoogleOneTapSignIn: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn(),
    signOut: jest.fn()
  },
  isSuccessResponse: jest.fn()
}));

jest.mock('../src/context/PvpRoomContext');

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, optionsOrDefault) => {
      if (key === 'pvp.speedFaster') {
        const sec = optionsOrDefault?.seconds ?? '';
        return `你比對手快 ${sec} 秒`;
      }
      if (key === 'pvp.speedSlower') {
        const sec = optionsOrDefault?.seconds ?? '';
        return `你比對手慢 ${sec} 秒`;
      }
      if (key === 'pvp.speedTie') return '你們幾乎同時作答';
      if (key === 'pvp.you') return '你';
      if (key === 'pvp.opponent') return '對手';
      if (key === 'pvp.roundResult') return '回合結果';
      return typeof optionsOrDefault === 'string' ? optionsOrDefault : key;
    }
  })
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

describe('Phase 11A Speed Comparison', () => {
  describe('Deterministic Resolution Timing Logic (1-9)', () => {
    it('1. Both correct, Host 100000, Guest 100420 -> HOST_FASTER, diff 420', () => {
      const result = calculateSpeedOutcome(100000, 100420, true, true);
      expect(result).toEqual({
        speedOutcome: 'HOST_FASTER',
        speedDiffMs: 420
      });
    });

    it('2. Both correct, Host 100180, Guest 100000 -> GUEST_FASTER, diff 180', () => {
      const result = calculateSpeedOutcome(100180, 100000, true, true);
      expect(result).toEqual({
        speedOutcome: 'GUEST_FASTER',
        speedDiffMs: 180
      });
    });

    it('3. Both correct, difference 80 -> TIE', () => {
      const result = calculateSpeedOutcome(100000, 100080, true, true);
      expect(result).toEqual({
        speedOutcome: 'TIE',
        speedDiffMs: 80
      });
    });

    it('4. difference exactly 150 -> TIE', () => {
      expect(NEAR_TIE_THRESHOLD_MS).toBe(150);
      const result = calculateSpeedOutcome(100000, 100150, true, true);
      expect(result).toEqual({
        speedOutcome: 'TIE',
        speedDiffMs: 150
      });
    });

    it('5. difference 151 -> faster player decided', () => {
      const resultHost = calculateSpeedOutcome(100000, 100151, true, true);
      expect(resultHost).toEqual({
        speedOutcome: 'HOST_FASTER',
        speedDiffMs: 151
      });

      const resultGuest = calculateSpeedOutcome(100151, 100000, true, true);
      expect(resultGuest).toEqual({
        speedOutcome: 'GUEST_FASTER',
        speedDiffMs: 151
      });
    });

    it('6. Host correct / Guest wrong -> NONE', () => {
      const result = calculateSpeedOutcome(100000, 100420, true, false);
      expect(result).toEqual({
        speedOutcome: 'NONE',
        speedDiffMs: 0
      });
    });

    it('7. Host wrong / Guest correct -> NONE', () => {
      const result = calculateSpeedOutcome(100000, 100420, false, true);
      expect(result).toEqual({
        speedOutcome: 'NONE',
        speedDiffMs: 0
      });
    });

    it('8. Both wrong -> NONE', () => {
      const result = calculateSpeedOutcome(100000, 100420, false, false);
      expect(result).toEqual({
        speedOutcome: 'NONE',
        speedDiffMs: 0
      });
    });

    it('9. missing/invalid submittedAt -> NONE -> no resolution crash', () => {
      expect(calculateSpeedOutcome(null, 100420, true, true)).toEqual({
        speedOutcome: 'NONE',
        speedDiffMs: 0
      });
      expect(calculateSpeedOutcome(100000, undefined, true, true)).toEqual({
        speedOutcome: 'NONE',
        speedDiffMs: 0
      });
      expect(calculateSpeedOutcome('invalid', 100420, true, true)).toEqual({
        speedOutcome: 'NONE',
        speedDiffMs: 0
      });
      expect(calculateSpeedOutcome(NaN, 100420, true, true)).toEqual({
        speedOutcome: 'NONE',
        speedDiffMs: 0
      });
    });
  });

  describe('UI Local Perspective Tests (10-14)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(Animated, 'timing').mockReturnValue({ start: jest.fn(), stop: jest.fn() });
    });

    const createMatchRoom = ({ myUid, isHost, speedOutcome, speedDiffMs }) => ({
      roomId: 'room1',
      room: {
        meta: { hostUid: 'host123', status: 'IN_BATTLE' },
        players: {
          host123: { displayName: 'Host' },
          guest456: { displayName: 'Guest' }
        },
        match: {
          matchId: 'm1',
          battleSeed: '12345',
          rulesetVersion: '1',
          vocabularyVersion: '1',
          questionCount: 10,
          level: 1
        }
      },
      user: { uid: myUid },
      isHost
    });

    const createMatchState = ({ speedOutcome, speedDiffMs }) => ({
      roundIndex: 0,
      phase: 'ROUND_RESULT',
      players: {
        host123: { hp: 100, score: 10, items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } } },
        guest456: { hp: 100, score: 10, items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } } }
      },
      rounds: {
        0: {
          resolution: {
            hostCorrect: true,
            guestCorrect: true,
            damageToHost: 0,
            damageToGuest: 0,
            hostBaseDamage: 20,
            guestBaseDamage: 20,
            hostPowerBonus: 0,
            guestPowerBonus: 0,
            hostShieldBlocked: 0,
            guestShieldBlocked: 0,
            hostHpBefore: 100,
            guestHpBefore: 100,
            hostHpAfter: 100,
            guestHpAfter: 100,
            speedOutcome,
            speedDiffMs
          }
        }
      }
    });

    it('10. local Host + HOST_FASTER + 420 -> 你比對手快 0.42 秒', () => {
      const { onValue } = require('firebase/database');
      const roomContext = createMatchRoom({ myUid: 'host123', isHost: true });
      PvpRoomContext.usePvpRoom.mockReturnValue(roomContext);

      onValue.mockImplementation((ref, callback) => {
        callback({ val: () => createMatchState({ speedOutcome: 'HOST_FASTER', speedDiffMs: 420 }) });
        return jest.fn();
      });

      let tree;
      act(() => {
        tree = renderer.create(<PvpBattleScreen navigation={{ replace: jest.fn() }} />);
      });

      const pill = tree.root.findByProps({ testID: 'pvpSpeedPill' });
      expect(pill).toBeTruthy();
      const text = pill.findByType(Text);
      expect(text.props.children).toBe('你比對手快 0.42 秒');
      act(() => { tree.unmount(); });
    });

    it('11. local Guest + HOST_FASTER + 420 -> 你比對手慢 0.42 秒', () => {
      const { onValue } = require('firebase/database');
      const roomContext = createMatchRoom({ myUid: 'guest456', isHost: false });
      PvpRoomContext.usePvpRoom.mockReturnValue(roomContext);

      onValue.mockImplementation((ref, callback) => {
        callback({ val: () => createMatchState({ speedOutcome: 'HOST_FASTER', speedDiffMs: 420 }) });
        return jest.fn();
      });

      let tree;
      act(() => {
        tree = renderer.create(<PvpBattleScreen navigation={{ replace: jest.fn() }} />);
      });

      const pill = tree.root.findByProps({ testID: 'pvpSpeedPill' });
      expect(pill).toBeTruthy();
      const text = pill.findByType(Text);
      expect(text.props.children).toBe('你比對手慢 0.42 秒');
      act(() => { tree.unmount(); });
    });

    it('12. local Guest + GUEST_FASTER + 180 -> 你比對手快 0.18 秒', () => {
      const { onValue } = require('firebase/database');
      const roomContext = createMatchRoom({ myUid: 'guest456', isHost: false });
      PvpRoomContext.usePvpRoom.mockReturnValue(roomContext);

      onValue.mockImplementation((ref, callback) => {
        callback({ val: () => createMatchState({ speedOutcome: 'GUEST_FASTER', speedDiffMs: 180 }) });
        return jest.fn();
      });

      let tree;
      act(() => {
        tree = renderer.create(<PvpBattleScreen navigation={{ replace: jest.fn() }} />);
      });

      const pill = tree.root.findByProps({ testID: 'pvpSpeedPill' });
      expect(pill).toBeTruthy();
      const text = pill.findByType(Text);
      expect(text.props.children).toBe('你比對手快 0.18 秒');
      act(() => { tree.unmount(); });
    });

    it('13. TIE -> 你們幾乎同時作答', () => {
      const { onValue } = require('firebase/database');
      const roomContext = createMatchRoom({ myUid: 'host123', isHost: true });
      PvpRoomContext.usePvpRoom.mockReturnValue(roomContext);

      onValue.mockImplementation((ref, callback) => {
        callback({ val: () => createMatchState({ speedOutcome: 'TIE', speedDiffMs: 80 }) });
        return jest.fn();
      });

      let tree;
      act(() => {
        tree = renderer.create(<PvpBattleScreen navigation={{ replace: jest.fn() }} />);
      });

      const pill = tree.root.findByProps({ testID: 'pvpSpeedPill' });
      expect(pill).toBeTruthy();
      const text = pill.findByType(Text);
      expect(text.props.children).toBe('你們幾乎同時作答');
      act(() => { tree.unmount(); });
    });

    it('14. NONE -> no speed pill', () => {
      const { onValue } = require('firebase/database');
      const roomContext = createMatchRoom({ myUid: 'host123', isHost: true });
      PvpRoomContext.usePvpRoom.mockReturnValue(roomContext);

      onValue.mockImplementation((ref, callback) => {
        callback({ val: () => createMatchState({ speedOutcome: 'NONE', speedDiffMs: 0 }) });
        return jest.fn();
      });

      let tree;
      act(() => {
        tree = renderer.create(<PvpBattleScreen navigation={{ replace: jest.fn() }} />);
      });

      const pills = tree.root.findAllByProps({ testID: 'pvpSpeedPill' });
      expect(pills.length).toBe(0);
      act(() => { tree.unmount(); });
    });
  });
});
