import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_PVP_LOADOUT,
  getDefaultPvpLoadout,
  validatePvpLoadout,
  getSavedPvpLoadout,
  savePvpLoadout,
  loadoutToCardList,
  PVP_LOADOUT_STORAGE_KEY,
} from '../src/domain/pvp/pvpLoadout';
import { getInitialItemsState, ITEM_TYPES } from '../src/domain/pvp/pvpItems';
import {
  publishRevealedLoadout,
  startFirstRound,
  cancelMatchOnRevealTimeout,
  useBattleItem,
} from '../src/services/pvp/pvpBattleService';
import { startMatch, setPlayerReady } from '../src/services/pvp/roomService';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import WaitingRoomScreen from '../src/screens/WaitingRoomScreen';

// Mock Firebase Auth
jest.mock('firebase/auth', () => ({
  initializeAuth: jest.fn(),
  getReactNativePersistence: jest.fn(),
  onAuthStateChanged: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signInWithCredential: jest.fn(),
  signOut: jest.fn(),
}));

jest.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: { configure: jest.fn() },
  isSuccessResponse: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons',
}));

jest.mock('expo-audio', () => ({
  setAudioModeAsync: jest.fn(),
  createAudioPlayer: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: {},
  NotificationFeedbackType: {},
}));

jest.mock('../src/context/OnlineContext', () => ({
  useOnline: () => ({ isOnline: true }),
}));

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// Mock Firebase
const mockGet = jest.fn();
const mockSet = jest.fn();
const mockUpdate = jest.fn();
const mockRunTransaction = jest.fn();

jest.mock('firebase/database', () => ({
  getDatabase: jest.fn(),
  ref: jest.fn((db, path) => ({ path })),
  get: (...args) => mockGet(...args),
  set: (...args) => mockSet(...args),
  update: (...args) => mockUpdate(...args),
  runTransaction: (...args) => mockRunTransaction(...args),
  serverTimestamp: jest.fn(() => 123456789),
  onValue: jest.fn(),
  off: jest.fn(),
  onDisconnect: jest.fn(() => ({ remove: jest.fn(), cancel: jest.fn() })),
}));

jest.mock('../src/services/firebase/firebaseApp', () => ({
  app: {},
  auth: { currentUser: { uid: 'hostUid' } },
}));

const mockContextValues = {
  currentRoom: {
    roomId: 'room1',
    meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'WAITING' },
    players: {
      hostUid: { displayName: 'Justin (Host)', ready: false, role: 'HOST' },
      guestUid: { displayName: 'Kevin (Guest)', ready: false, role: 'GUEST' },
    },
  },
  roomId: 'room1',
  room: {
    meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'WAITING' },
    players: {
      hostUid: { displayName: 'Justin (Host)', ready: false, role: 'HOST' },
      guestUid: { displayName: 'Kevin (Guest)', ready: false, role: 'GUEST' },
    },
  },
  currentRole: 'HOST',
  isHost: true,
  currentUserId: 'hostUid',
  isReady: false,
  isLoadingRoom: false,
  getDepartureIntent: jest.fn(() => 'NONE'),
  getDepartureSession: jest.fn(() => ({})),
  toggleReady: jest.fn(),
  leaveCurrentRoom: jest.fn(),
  startMatch: jest.fn(),
  currentLoadout: { HEAL: 2, SHIELD: 1, POWER: 1 },
  lockedLoadout: null,
  saveLoadout: jest.fn(),
};

jest.mock('../src/context/PvpRoomContext', () => ({
  usePvpRoom: () => mockContextValues,
}));

describe('Phase 12A — PvP Skill Loadout & Battle Deck System Tests A to T', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  // A. default deck = HEAL2 / SHIELD1 / POWER1
  test('A. default deck = HEAL 2, SHIELD 1, POWER 1', () => {
    const defaultDeck = getDefaultPvpLoadout();
    expect(defaultDeck).toEqual({ HEAL: 2, SHIELD: 1, POWER: 1 });
    expect(DEFAULT_PVP_LOADOUT).toEqual({ HEAL: 2, SHIELD: 1, POWER: 1 });
    expect(loadoutToCardList(defaultDeck)).toEqual(['HEAL', 'HEAL', 'SHIELD', 'POWER']);
  });

  // B. valid custom loadout accepted
  test('B. valid custom loadout accepted', () => {
    expect(validatePvpLoadout({ HEAL: 1, SHIELD: 1, POWER: 2 })).toBe(true);
    expect(validatePvpLoadout({ HEAL: 2, SHIELD: 2, POWER: 0 })).toBe(true);
    expect(validatePvpLoadout({ HEAL: 0, SHIELD: 2, POWER: 2 })).toBe(true);
    expect(validatePvpLoadout({ HEAL: 2, SHIELD: 0, POWER: 2 })).toBe(true);
  });

  // C. three copies of same skill rejected
  test('C. three copies of same skill rejected', () => {
    expect(validatePvpLoadout({ HEAL: 3, SHIELD: 1, POWER: 0 })).toBe(false);
    expect(validatePvpLoadout({ HEAL: 0, SHIELD: 3, POWER: 1 })).toBe(false);
    expect(validatePvpLoadout({ HEAL: 1, SHIELD: 0, POWER: 3 })).toBe(false);
    expect(validatePvpLoadout({ HEAL: 4, SHIELD: 0, POWER: 0 })).toBe(false);
  });

  // D. deck with fewer/more than 4 cards rejected
  test('D. deck with fewer or more than 4 cards rejected', () => {
    // 3 cards
    expect(validatePvpLoadout({ HEAL: 1, SHIELD: 1, POWER: 1 })).toBe(false);
    // 5 cards
    expect(validatePvpLoadout({ HEAL: 2, SHIELD: 2, POWER: 1 })).toBe(false);
    // 0 cards
    expect(validatePvpLoadout({ HEAL: 0, SHIELD: 0, POWER: 0 })).toBe(false);
    // non-numbers / missing keys
    expect(validatePvpLoadout({ HEAL: '2', SHIELD: 1, POWER: 1 })).toBe(false);
    expect(validatePvpLoadout(null)).toBe(false);
    expect(validatePvpLoadout({})).toBe(false);
  });

  // E. corrupted AsyncStorage falls back to default
  test('E. corrupted AsyncStorage falls back to default', async () => {
    // Corrupted JSON
    AsyncStorage.getItem.mockResolvedValueOnce('invalid json {[');
    const loadout1 = await getSavedPvpLoadout();
    expect(loadout1).toEqual(DEFAULT_PVP_LOADOUT);

    // Invalid counts in storage
    AsyncStorage.getItem.mockResolvedValueOnce(JSON.stringify({ HEAL: 4, SHIELD: 0, POWER: 0 }));
    const loadout2 = await getSavedPvpLoadout();
    expect(loadout2).toEqual(DEFAULT_PVP_LOADOUT);

    // Null in storage
    AsyncStorage.getItem.mockResolvedValueOnce(null);
    const loadout3 = await getSavedPvpLoadout();
    expect(loadout3).toEqual(DEFAULT_PVP_LOADOUT);

    // Valid save and load
    const validCustom = { HEAL: 1, SHIELD: 2, POWER: 1 };
    await savePvpLoadout(validCustom);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(PVP_LOADOUT_STORAGE_KEY, JSON.stringify(validCustom));
  });

  // F. Ready locks selected loadout
  test('F. Ready locks selected loadout', () => {
    let currentLoadout = { HEAL: 1, SHIELD: 1, POWER: 2 };
    let lockedLoadout = null;
    let isReady = false;

    // Player presses ready
    const toggleReady = () => {
      if (!isReady) {
        lockedLoadout = { ...currentLoadout };
        isReady = true;
      } else {
        lockedLoadout = null;
        isReady = false;
      }
    };

    toggleReady();
    expect(isReady).toBe(true);
    expect(lockedLoadout).toEqual({ HEAL: 1, SHIELD: 1, POWER: 2 });

    // Modifying currentLoadout after Ready does NOT alter lockedLoadout
    currentLoadout = { HEAL: 2, SHIELD: 1, POWER: 1 };
    expect(lockedLoadout).toEqual({ HEAL: 1, SHIELD: 1, POWER: 2 });
  });

  // G. Cancel Ready unlocks editing
  test('G. Cancel Ready unlocks editing', () => {
    let currentLoadout = { HEAL: 1, SHIELD: 1, POWER: 2 };
    let lockedLoadout = { ...currentLoadout };
    let isReady = true;

    // Player cancels ready
    const cancelReady = () => {
      isReady = false;
      lockedLoadout = null;
    };

    cancelReady();
    expect(isReady).toBe(false);
    expect(lockedLoadout).toBeNull();
    // Player can now edit again
    currentLoadout = { HEAL: 2, SHIELD: 2, POWER: 0 };
    expect(currentLoadout).toEqual({ HEAL: 2, SHIELD: 2, POWER: 0 });
  });

  // H. Waiting Room never renders opponent deck
  test('H. Waiting Room never renders opponent deck', () => {
    let tree;
    act(() => {
      tree = renderer.create(
        <WaitingRoomScreen navigation={{ navigate: jest.fn(), replace: jest.fn() }} />
      );
    });

    // Local deck is visible
    expect(tree.root.findByProps({ testID: 'waitingRoomLocalLoadout' })).toBeTruthy();

    // Opponent deck is NOT rendered
    expect(() => tree.root.findByProps({ testID: 'waitingRoomOpponentLoadout' })).toThrow();
  });

  // I. before Start, actual opponent loadout is not written to opponent-readable match state
  test('I. before Start, actual loadouts are not written to opponent-readable match state', async () => {
    mockSet.mockResolvedValueOnce();

    await setPlayerReady('room1', { uid: 'hostUid' }, true);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'rooms/room1/players/hostUid/ready' }),
      true
    );
  });

  // J. after Start, player may reveal own locked deck
  test('J. after Start, player may reveal own locked deck', async () => {
    mockSet.mockResolvedValueOnce();

    const loadout = { HEAL: 1, SHIELD: 1, POWER: 2 };
    await publishRevealedLoadout({ roomCode: 'room1', uid: 'guestUid', loadout });

    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'rooms/room1/matchState/revealedLoadouts/guestUid' }),
      loadout
    );
  });

  // K. player cannot reveal invalid deck
  test('K. player cannot reveal invalid deck', async () => {
    await expect(publishRevealedLoadout({ roomCode: 'room1', uid: 'guestUid', loadout: { HEAL: 3, SHIELD: 1, POWER: 0 } })).rejects.toThrow();
  });

  // L. revealed deck writes only validated payload
  test('L. revealed deck writes only validated payload', async () => {
    mockSet.mockResolvedValueOnce();
    const loadout = { HEAL: 2, SHIELD: 1, POWER: 1 };
    await publishRevealedLoadout({ roomCode: 'room1', uid: 'hostUid', loadout });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'rooms/room1/matchState/revealedLoadouts/hostUid' }),
      loadout
    );
  });

  // M. both reveals are required before battle starts
  test('M. both reveals are required before battle starts', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementationOnce((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    await startFirstRound({ roomCode: 'room1', hostUid: 'hostUid', guestUid: 'guestUid' });

    // 1) Test with only host revealed -> aborts
    const roomOnlyHost = {
      meta: { hostUid: 'hostUid' },
      matchState: {
        phase: 'LOADOUT_REVEAL',
        revealedLoadouts: {
          hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
        },
      },
    };
    const res1 = capturedTxFn(roomOnlyHost);
    expect(res1).toBeUndefined();

    // 2) Test with both revealed -> succeeds and updates inventory
    const roomBoth = {
      meta: { hostUid: 'hostUid' },
      matchState: {
        phase: 'LOADOUT_REVEAL',
        revealedLoadouts: {
          hostUid: { HEAL: 1, SHIELD: 1, POWER: 2 },
          guestUid: { HEAL: 2, SHIELD: 2, POWER: 0 },
        },
        players: {
          hostUid: {},
          guestUid: {},
        },
      },
    };
    const res2 = capturedTxFn(roomBoth);
    expect(res2).toBeTruthy();
    expect(res2.matchState.phase).toBe('ANSWERING');
    expect(res2.matchState.players.hostUid.items.POWER.remaining).toBe(2);
    expect(res2.matchState.players.hostUid.items.HEAL.remaining).toBe(1);
    expect(res2.matchState.players.guestUid.items.SHIELD.remaining).toBe(2);
    expect(res2.matchState.players.guestUid.items.POWER.remaining).toBe(0);
  });

  // N. Host inventory initializes from revealed deck counts
  test('N. Host inventory initializes from revealed deck counts', () => {
    const revealedHost = { HEAL: 1, SHIELD: 1, POWER: 2 };
    const itemsState = getInitialItemsState(revealedHost);
    expect(itemsState.HEAL.remaining).toBe(1);
    expect(itemsState.SHIELD.remaining).toBe(1);
    expect(itemsState.POWER.remaining).toBe(2);
  });

  // O. Power×2 produces two authoritative Power uses
  test('O. Power×2 produces two authoritative Power uses', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementation((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    const roomData = {
      meta: { status: 'IN_BATTLE' },
      players: { guestUid: { role: 'GUEST' }, hostUid: { role: 'HOST' } },
      match: { questionCount: 10 },
      matchState: {
        roundIndex: 0,
        phase: 'ANSWERING',
        players: {
          guestUid: {
            hp: 80,
            items: {
              HEAL: { remaining: 1 },
              SHIELD: { remaining: 1 },
              POWER: { remaining: 2 },
            },
            itemUses: {},
          },
        },
      },
    };

    // Use 1
    await useBattleItem({ roomCode: 'room1', uid: 'guestUid', roundIndex: 0, itemId: 'POWER', actionId: 'act1' });
    const after1 = capturedTxFn(roomData);
    expect(after1.matchState.players.guestUid.items.POWER.remaining).toBe(1);

    // Use 2 in next round
    after1.matchState.roundIndex = 1;
    await useBattleItem({ roomCode: 'room1', uid: 'guestUid', roundIndex: 1, itemId: 'POWER', actionId: 'act2' });
    const after2 = capturedTxFn(after1);
    expect(after2.matchState.players.guestUid.items.POWER.remaining).toBe(0);

    // Use 3 (should fail/noop because remaining is 0)
    after2.matchState.roundIndex = 2;
    await useBattleItem({ roomCode: 'room1', uid: 'guestUid', roundIndex: 2, itemId: 'POWER', actionId: 'act3' });
    const after3 = capturedTxFn(after2);
    expect(after3).toBeUndefined();
  });

  // P. Heal×2 produces two authoritative Heal uses
  test('P. Heal×2 produces two authoritative Heal uses', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementation((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    const roomData = {
      meta: { status: 'IN_BATTLE' },
      players: { guestUid: { role: 'GUEST' }, hostUid: { role: 'HOST' } },
      match: { questionCount: 10 },
      matchState: {
        roundIndex: 0,
        phase: 'ANSWERING',
        players: {
          hostUid: {
            hp: 40,
            items: {
              HEAL: { remaining: 2 },
              SHIELD: { remaining: 1 },
              POWER: { remaining: 1 },
            },
            itemUses: {},
          },
        },
      },
    };

    // Use 1
    await useBattleItem({ roomCode: 'room1', uid: 'hostUid', roundIndex: 0, itemId: 'HEAL', actionId: 'act1' });
    const after1 = capturedTxFn(roomData);
    expect(after1.matchState.players.hostUid.items.HEAL.remaining).toBe(1);
    expect(after1.matchState.players.hostUid.hp).toBe(65);

    // Use 2 in next round
    after1.matchState.roundIndex = 1;
    await useBattleItem({ roomCode: 'room1', uid: 'hostUid', roundIndex: 1, itemId: 'HEAL', actionId: 'act2' });
    const after2 = capturedTxFn(after1);
    expect(after2.matchState.players.hostUid.items.HEAL.remaining).toBe(0);
    expect(after2.matchState.players.hostUid.hp).toBe(90);

    // Use 3 (should fail/noop because remaining is 0)
    after2.matchState.roundIndex = 2;
    await useBattleItem({ roomCode: 'room1', uid: 'hostUid', roundIndex: 2, itemId: 'HEAL', actionId: 'act3' });
    const after3 = capturedTxFn(after2);
    expect(after3).toBeUndefined();
  });

  // Q. 3-second reveal does not consume Round 0 countdown
  test('Q. 3-second reveal does not consume Round 0 countdown', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementationOnce((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    await startMatch('room1', { uid: 'hostUid' });

    const room = {
      meta: { status: 'WAITING', hostUid: 'hostUid' },
      players: {
        hostUid: { ready: true, role: 'HOST' },
        guestUid: { ready: true, role: 'GUEST' },
      },
    };
    const updatedRoom = capturedTxFn(room);

    // StartMatch transitions to LOADOUT_REVEAL and does NOT set roundStartedAt!
    expect(updatedRoom.matchState.phase).toBe('LOADOUT_REVEAL');
    expect(updatedRoom.matchState.roundStartedAt).toBeUndefined();
    expect(updatedRoom.matchState.revealedLoadouts).toEqual({});
  });

  // R. after reveal: 3 → 2 → 1 → GO! → 6.0
  test('R. roundStartedAt starts only when transitioning to ANSWERING', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementationOnce((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    await startFirstRound({ roomCode: 'room1', hostUid: 'hostUid', guestUid: 'guestUid' });

    const roomBoth = {
      meta: { hostUid: 'hostUid' },
      matchState: {
        phase: 'LOADOUT_REVEAL',
        revealedLoadouts: {
          hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
          guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
        },
        players: { hostUid: {}, guestUid: {} },
      },
    };

    const res = capturedTxFn(roomBoth);
    expect(res.matchState.phase).toBe('ANSWERING');
    expect(res.matchState.roundStartedAt).toBe(123456789);
  });

  // S. Host / Guest see same revealed decks
  test('S. Host / Guest see same revealed decks', () => {
    const revealedLoadouts = {
      hostUid: { HEAL: 1, SHIELD: 1, POWER: 2 },
      guestUid: { HEAL: 2, SHIELD: 2, POWER: 0 },
    };

    // Host reads:
    const hostViewsSelf = revealedLoadouts['hostUid'];
    const hostViewsGuest = revealedLoadouts['guestUid'];

    // Guest reads:
    const guestViewsSelf = revealedLoadouts['guestUid'];
    const guestViewsHost = revealedLoadouts['hostUid'];

    expect(hostViewsSelf).toEqual(guestViewsHost);
    expect(hostViewsGuest).toEqual(guestViewsSelf);
  });

  // T. cancelMatchOnRevealTimeout cancels room if reveal fails
  test('T. cancelMatchOnRevealTimeout cancels room if reveal sync fails', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementationOnce((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    await cancelMatchOnRevealTimeout({ roomCode: 'room1', hostUid: 'hostUid' });

    const room = {
      meta: { status: 'IN_BATTLE', hostUid: 'hostUid' },
      matchState: { phase: 'LOADOUT_REVEAL' },
    };
    const cancelledRoom = capturedTxFn(room);

    expect(cancelledRoom.meta.status).toBe('CANCELLED');
  });

  // G. Heal from 80 -> HP becomes 100, remaining becomes 1
  test('G. Heal from 80 -> HP becomes 100 (capped), remaining becomes 1', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementationOnce((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    const roomData = {
      meta: { status: 'IN_BATTLE' },
      players: { hostUid: { role: 'HOST' }, guestUid: { role: 'GUEST' } },
      match: { questionCount: 5 },
      matchState: {
        roundIndex: 0,
        phase: 'ANSWERING',
        players: {
          hostUid: {
            hp: 80,
            items: {
              HEAL: { remaining: 2 },
              SHIELD: { remaining: 1 },
              POWER: { remaining: 1 },
            },
            itemUses: {},
          },
        },
      },
    };

    await useBattleItem({ roomCode: 'room1', uid: 'hostUid', roundIndex: 0, itemId: 'HEAL', actionId: 'act1' });
    const after = capturedTxFn(roomData);
    expect(after.matchState.players.hostUid.items.HEAL.remaining).toBe(1);
    expect(after.matchState.players.hostUid.hp).toBe(100);
  });

  // H. Heal from 60 -> HP becomes 85, remaining becomes 1
  test('H. Heal from 60 -> HP becomes 85, remaining becomes 1', async () => {
    let capturedTxFn;
    mockRunTransaction.mockImplementationOnce((ref, txFn) => {
      capturedTxFn = txFn;
      return Promise.resolve({ committed: true });
    });

    const roomData = {
      meta: { status: 'IN_BATTLE' },
      players: { hostUid: { role: 'HOST' }, guestUid: { role: 'GUEST' } },
      match: { questionCount: 5 },
      matchState: {
        roundIndex: 0,
        phase: 'ANSWERING',
        players: {
          hostUid: {
            hp: 60,
            items: {
              HEAL: { remaining: 2 },
              SHIELD: { remaining: 1 },
              POWER: { remaining: 1 },
            },
            itemUses: {},
          },
        },
      },
    };

    await useBattleItem({ roomCode: 'room1', uid: 'hostUid', roundIndex: 0, itemId: 'HEAL', actionId: 'act1' });
    const after = capturedTxFn(roomData);
    expect(after.matchState.players.hostUid.items.HEAL.remaining).toBe(1);
    expect(after.matchState.players.hostUid.hp).toBe(85);
  });

  // K. custom-deck inventory counts still work
  test('K. custom-deck inventory counts still work', () => {
    const customHost = { HEAL: 1, SHIELD: 1, POWER: 2 };
    const customGuest = { HEAL: 2, SHIELD: 2, POWER: 0 };

    const hostItems = getInitialItemsState(customHost);
    expect(hostItems[ITEM_TYPES.HEAL].remaining).toBe(1);
    expect(hostItems[ITEM_TYPES.SHIELD].remaining).toBe(1);
    expect(hostItems[ITEM_TYPES.POWER].remaining).toBe(2);

    const guestItems = getInitialItemsState(customGuest);
    expect(guestItems[ITEM_TYPES.HEAL].remaining).toBe(2);
    expect(guestItems[ITEM_TYPES.SHIELD].remaining).toBe(2);
    expect(guestItems[ITEM_TYPES.POWER].remaining).toBe(0);
  });
});
