import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadPlayerProgress,
  savePlayerProgress,
  createDefaultPlayerProgress
} from '../src/storage/playerProgressStorage';
import {
  loadCampaignProgress,
  saveCampaignProgress
} from '../src/storage/campaignStorage';
import {
  loadMistakes,
  saveMistakes,
  createDefaultMistakes
} from '../src/storage/mistakeStorage';
import {
  loadBattleHistory,
  saveBattleHistory,
  createDefaultHistory
} from '../src/storage/battleHistoryStorage';
import {
  getActiveIdentity,
  setActiveIdentity,
  getScopedKey,
  getDeviceId,
  DEVICE_ID_KEY,
  ACTIVE_IDENTITY_KEY,
  GUEST_IDENTITY
} from '../src/storage/storageIdentity';
import {
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY
} from '../src/storage/settingsStorage';
import {
  getSavedPvpLoadout,
  savePvpLoadout,
  STORAGE_KEY_PVP_LOADOUT,
  getDefaultPvpLoadout
} from '../src/domain/pvp/pvpLoadout';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AuthProvider, useAuth, AuthState } from '../src/context/AuthContext';

let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => mockStore[key] !== undefined ? mockStore[key] : null),
  setItem: jest.fn(async (key, value) => {
    mockStore[key] = String(value);
  }),
  multiSet: jest.fn(async (pairs) => {
    for (const [k, v] of pairs) {
      mockStore[k] = String(v);
    }
  }),
  removeItem: jest.fn(async (key) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  })
}));

let authCallback = null;
const mockUnsubscribe = jest.fn();

jest.mock('../src/services/firebase/firebaseAuth', () => ({
  auth: {},
  onAuthStateChanged: jest.fn((authInstance, callback) => {
    authCallback = callback;
    return mockUnsubscribe;
  })
}));

jest.mock('../src/services/auth/googleSignIn', () => ({
  signInWithGoogle: jest.fn(),
  signOut: jest.fn()
}));

const mockCoordinateAccountProgress = jest.fn();
jest.mock('../src/services/sync/accountProgressCoordinator', () => ({
  coordinateAccountProgress: (...args) => mockCoordinateAccountProgress(...args)
}));

jest.mock('../src/services/sync/liveProgressSync', () => ({
  flushLiveProgress: jest.fn().mockResolvedValue({ status: 'synced' }),
  getSyncStatus: jest.fn(() => 'idle'),
  subscribeSyncStatus: jest.fn(() => () => {})
}));

function TestConsumer({ onContext }) {
  const ctx = useAuth();
  onContext(ctx);
  return null;
}

describe('Phase 5B — Storage Cutover & Account Progress Readiness', () => {
  beforeEach(async () => {
    mockStore = {};
    authCallback = null;
    jest.clearAllMocks();
    await setActiveIdentity('guest');
  });

  describe('1. Scoped Storage Namespace Cutover & Isolation', () => {
    test('Account A playerProgress is strictly isolated from Account B', async () => {
      // 1. Switch to Account A
      await setActiveIdentity('uid:AccountA');
      const progA = { ...createDefaultPlayerProgress(), totalXp: 1500 };
      await savePlayerProgress(progA);

      // Verify physical storage key
      const keyA = getScopedKey('playerProgress', 'uid:AccountA');
      expect(mockStore[keyA]).toBeDefined();
      expect(JSON.parse(mockStore[keyA]).totalXp).toBe(1500);

      // 2. Switch to Account B
      await setActiveIdentity('uid:AccountB');
      const progB = await loadPlayerProgress();
      // Should see empty/default progress, NEVER Account A's 1500 XP
      expect(progB.totalXp).toBe(0);

      // Save Account B progress
      const progBUpdated = { ...progB, totalXp: 400 };
      await savePlayerProgress(progBUpdated);

      const keyB = getScopedKey('playerProgress', 'uid:AccountB');
      expect(mockStore[keyB]).toBeDefined();
      expect(JSON.parse(mockStore[keyB]).totalXp).toBe(400);

      // 3. Switch back to Account A
      await setActiveIdentity('uid:AccountA');
      const reloadedA = await loadPlayerProgress();
      expect(reloadedA.totalXp).toBe(1500);
    });

    test('Guest storage is isolated from authenticated accounts', async () => {
      await setActiveIdentity('guest');
      const guestProgress = { ...createDefaultPlayerProgress(), totalXp: 250 };
      await savePlayerProgress(guestProgress);

      const guestKey = getScopedKey('playerProgress', 'guest');
      expect(mockStore[guestKey]).toBeDefined();

      // Switch to Account A
      await setActiveIdentity('uid:AccountA');
      const accountAProgress = await loadPlayerProgress();
      expect(accountAProgress.totalXp).toBe(0);

      // Guest remains untouched
      expect(JSON.parse(mockStore[guestKey]).totalXp).toBe(250);
    });

    test('Mistakes, Campaign, and BattleHistory are properly scoped per identity', async () => {
      // Identity 1
      await setActiveIdentity('uid:User1');
      const m1 = { ...createDefaultMistakes(), records: { 'word-apple': { wrongCount: 3 } } };
      await saveMistakes(m1);

      const c1 = { schemaVersion: 1, clearedStages: ['L1-S1'], stageStars: { 'L1-S1': 3 }, stageScores: { 'L1-S1': 100 }, bestCombo: 5 };
      await saveCampaignProgress(c1);

      const h1 = { schemaVersion: 1, records: [{ id: 'b1', stageId: 'L1-S1', score: 100 }] };
      await saveBattleHistory(h1);

      // Identity 2
      await setActiveIdentity('uid:User2');
      const loadedM2 = await loadMistakes();
      const loadedC2 = await loadCampaignProgress();
      const loadedH2 = await loadBattleHistory();

      expect(loadedM2.records['word-apple']).toBeUndefined();
      expect(loadedC2.clearedStages).toEqual([]);
      expect(loadedH2.records).toEqual([]);

      // Switch back
      await setActiveIdentity('uid:User1');
      const reloadedM1 = await loadMistakes();
      const reloadedC1 = await loadCampaignProgress();
      const reloadedH1 = await loadBattleHistory();

      expect(reloadedM1.records['word-apple'].wrongCount).toBe(3);
      expect(reloadedC1.clearedStages).toContain('L1-S1');
      expect(reloadedH1.records.length).toBe(1);
    });

    test('Settings, PvP loadout, and Device ID remain strictly device-wide', async () => {
      await setActiveIdentity('uid:UserA');
      await saveSettings({ language: 'zh-TW', soundEffects: false, haptics: true });
      const customLoadout = getDefaultPvpLoadout();
      await savePvpLoadout(customLoadout);
      const devIdA = await getDeviceId();

      // Switch to User B
      await setActiveIdentity('uid:UserB');
      const settingsB = await loadSettings();
      const pvpB = await getSavedPvpLoadout();
      const devIdB = await getDeviceId();

      // Device-wide data MUST match across accounts
      expect(settingsB.language).toBe('zh-TW');
      expect(settingsB.soundEffects).toBe(false);
      expect(pvpB).toEqual(customLoadout);
      expect(devIdB).toBe(devIdA);

      // Keys must not be scoped by identity
      expect(mockStore['gsat_settings']).toBeDefined();
      expect(mockStore[STORAGE_KEY_PVP_LOADOUT]).toBeDefined();
      expect(mockStore[DEVICE_ID_KEY]).toBeDefined();
    });
  });

  describe('2. Account Progress Ready State Lifecycle', () => {
    test('authReady before coordinator completes does NOT imply progressReady', async () => {
      let capturedContext = null;
      let resolveCoordinator;
      const coordinatorPromise = new Promise((resolve) => {
        resolveCoordinator = resolve;
      });
      mockCoordinateAccountProgress.mockReturnValueOnce(coordinatorPromise);

      act(() => {
        renderer.create(
          <AuthProvider>
            <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
          </AuthProvider>
        );
      });

      // Firebase Auth resolves
      await act(async () => {
        authCallback({
          uid: 'User123',
          displayName: 'Test User'
        });
      });

      // Auth is ready, but coordinator has not finished!
      expect(capturedContext.authReady).toBe(true);
      expect(capturedContext.progressReady).toBe(false);

      // Finish coordinator
      await act(async () => {
        resolveCoordinator({ identity: 'uid:User123', status: 'cloud_restored' });
      });

      // Now progressReady is true
      expect(capturedContext.progressReady).toBe(true);
    });

    test('coordinator network failure does not block offline gameplay; sets progressReady = true', async () => {
      let capturedContext = null;
      mockCoordinateAccountProgress.mockRejectedValueOnce(new Error('Firebase network unavailable'));

      act(() => {
        renderer.create(
          <AuthProvider>
            <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
          </AuthProvider>
        );
      });

      await act(async () => {
        authCallback({
          uid: 'OfflineUser',
          displayName: 'Offline Player'
        });
      });

      // Network failed during coordinator, but progressReady MUST still become true for local offline play
      expect(capturedContext.authReady).toBe(true);
      expect(capturedContext.progressReady).toBe(true);
    });

    test('signed-out guest initialization properly marks progressReady', async () => {
      let capturedContext = null;
      mockCoordinateAccountProgress.mockResolvedValueOnce({ identity: 'guest', status: 'guest_ready' });

      act(() => {
        renderer.create(
          <AuthProvider>
            <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
          </AuthProvider>
        );
      });

      await act(async () => {
        authCallback(null);
      });

      expect(capturedContext.authReady).toBe(true);
      expect(capturedContext.identity).toBe('guest');
      expect(capturedContext.progressReady).toBe(true);
    });
  });
});
