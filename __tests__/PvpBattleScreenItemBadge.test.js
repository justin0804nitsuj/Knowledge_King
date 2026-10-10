import React from 'react';
import renderer, { act } from 'react-test-renderer';
import PvpBattleScreen from '../src/screens/PvpBattleScreen';
import PvpActiveEffectBadge from '../src/components/pvp/PvpActiveEffectBadge';
import * as PvpRoomContext from '../src/context/PvpRoomContext';
import { onValue } from 'firebase/database';
import { ITEM_TYPES } from '../src/domain/pvp/pvpItems';

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
    t: (key, fallback) => {
      if (key === 'pvp.shieldBadge') return 'Shield';
      if (key === 'pvp.powerBadge') return 'Power';
      if (key === 'pvp.you') return 'You';
      if (key === 'pvp.opponent') return 'Opponent';
      return typeof fallback === 'string' ? fallback : key;
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

describe('PvpBattleScreen Active Effect Badge Integration', () => {
  let component;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    if (component) {
      act(() => {
        component.unmount();
      });
      component = null;
    }
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const renderBattleScreen = (matchState) => {
    onValue.mockImplementation((ref, callback) => {
      callback({ val: () => matchState });
      return jest.fn();
    });

    PvpRoomContext.usePvpRoom.mockReturnValue({
      roomId: 'room1',
      user: { uid: 'host1' },
      room: {
        meta: { hostUid: 'host1', status: 'IN_BATTLE' },
        players: {
          host1: { displayName: 'Host' },
          guest1: { displayName: 'Guest' }
        },
        match: {
          battleSeed: '12345',
          level: 1,
          rulesetVersion: '1.0.0',
          vocabularyVersion: '1.0.0',
          matchId: 'match1',
          questionCount: 10
        }
      },
      isHost: true
    });

    act(() => {
      component = renderer.create(<PvpBattleScreen />);
    });
  };

  const createBaseMatchState = ({
    phase = 'ANSWERING',
    hostItemUses = {},
    guestItemUses = {},
    roundIndex = 0
  } = {}) => ({
    roundIndex,
    phase,
    players: {
      host1: {
        hp: 100,
        score: 0,
        items: {
          HEAL: { remaining: 2 },
          SHIELD: { remaining: 1 },
          POWER: { remaining: 1 }
        },
        itemUses: hostItemUses
      },
      guest1: {
        hp: 100,
        score: 0,
        items: {
          HEAL: { remaining: 2 },
          SHIELD: { remaining: 1 },
          POWER: { remaining: 1 }
        },
        itemUses: guestItemUses
      }
    },
    rounds: {
      0: {
        answers: {}
      }
    }
  });

  const getBadges = () => component.root.findAllByType(PvpActiveEffectBadge);
  const getShieldBadges = () => getBadges().filter(b => b.props.type === 'SHIELD');
  const getPowerBadges = () => getBadges().filter(b => b.props.type === 'POWER');

  it('renders Shield badge when local player uses Shield in ANSWERING phase', () => {
    const state = createBaseMatchState({
      phase: 'ANSWERING',
      hostItemUses: { 0: { itemId: ITEM_TYPES.SHIELD, actionId: 'act1' } }
    });
    renderBattleScreen(state);

    expect(getShieldBadges().length).toBe(1);
    expect(getPowerBadges().length).toBe(0);
    expect(getShieldBadges()[0].props.label).toBe('Shield');
  });

  it('renders Power badge when local player uses Power in ANSWERING phase', () => {
    const state = createBaseMatchState({
      phase: 'ANSWERING',
      hostItemUses: { 0: { itemId: ITEM_TYPES.POWER, actionId: 'act2' } }
    });
    renderBattleScreen(state);

    expect(getPowerBadges().length).toBe(1);
    expect(getShieldBadges().length).toBe(0);
    expect(getPowerBadges()[0].props.label).toBe('Power');
  });

  it('renders Shield/Power badge during RESOLVING phase', () => {
    const shieldState = createBaseMatchState({
      phase: 'RESOLVING',
      hostItemUses: { 0: { itemId: ITEM_TYPES.SHIELD, actionId: 'act1' } }
    });
    renderBattleScreen(shieldState);
    expect(getShieldBadges().length).toBe(1);

    act(() => {
      component.unmount();
      component = null;
    });

    const powerState = createBaseMatchState({
      phase: 'RESOLVING',
      hostItemUses: { 0: { itemId: ITEM_TYPES.POWER, actionId: 'act2' } }
    });
    renderBattleScreen(powerState);
    expect(getPowerBadges().length).toBe(1);
  });

  it('hides active badges at ROUND_RESULT phase', () => {
    const state = createBaseMatchState({
      phase: 'ROUND_RESULT',
      hostItemUses: { 0: { itemId: ITEM_TYPES.SHIELD, actionId: 'act1' } }
    });
    renderBattleScreen(state);

    expect(getBadges().length).toBe(0);
  });

  it('opponent itemUse is NOT rendered pre-resolution (no opponent privacy leak)', () => {
    // Guest used Shield, but local host has NOT used any item
    const state = createBaseMatchState({
      phase: 'ANSWERING',
      hostItemUses: {},
      guestItemUses: { 0: { itemId: ITEM_TYPES.SHIELD, actionId: 'guest_act' } }
    });
    renderBattleScreen(state);

    // Local badges must NOT be rendered based on opponent state
    expect(getBadges().length).toBe(0);

    // Opponent HUD has no badge
    const opponentBadges = component.root.findAll(el =>
      el.props && (el.props.testID === 'opponentShieldBadge' || el.props.testID === 'opponentPowerBadge')
    );
    expect(opponentBadges.length).toBe(0);
  });
});
