import { syncOnlineProfile } from '../src/services/online/onlineProfileService';
import { getCompatibilityInfo } from '../src/domain/game/pvpCompatibility';
import { getDatabase, ref, get, set, serverTimestamp } from 'firebase/database';
import { loadPlayerProgress } from '../src/storage/playerProgressStorage';
import { ConnectionState, subscribeToConnectionState } from '../src/services/online/connectionService';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

// Mock firebase database
jest.mock('firebase/database', () => {
  const mockDb = {};
  return {
    getDatabase: jest.fn(() => mockDb),
    ref: jest.fn((db, path) => path),
    get: jest.fn(),
    set: jest.fn(),
    serverTimestamp: jest.fn(() => 'MOCK_TIMESTAMP'),
    onValue: jest.fn(),
    off: jest.fn()
  };
});

jest.mock('../src/services/firebase/firebaseApp', () => ({
  app: {}
}));

describe('Phase 7 Online Foundation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Online Profile Service', () => {
    it('should create a new profile with safe fields and missing display name fallback', async () => {
      get.mockResolvedValueOnce({ val: () => null }); // doesn't exist
      set.mockResolvedValueOnce();

      const success = await syncOnlineProfile({ uid: 'user123' });
      expect(success).toBe(true);

      // Verify what was written
      expect(set).toHaveBeenCalledTimes(1);
      const writePayload = set.mock.calls[0][1];
      
      expect(writePayload.displayName).toBe('Player'); // fallback applied
      expect(writePayload.photoURL).toBe(null);
      expect(writePayload.createdAt).toBe('MOCK_TIMESTAMP');
      expect(writePayload.updatedAt).toBe('MOCK_TIMESTAMP');
      
      // Ensure NO local progress fields exist
      expect(writePayload.xp).toBeUndefined();
      expect(writePayload.campaign).toBeUndefined();
      expect(writePayload.mistakes).toBeUndefined();
    });

    it('should update an existing profile idempotently without destructive overwrites', async () => {
      get.mockResolvedValueOnce({
        val: () => ({
          displayName: 'OldName',
          photoURL: 'old.png',
          createdAt: 'OLD_TIMESTAMP',
          updatedAt: 'OLD_TIMESTAMP'
        })
      });
      set.mockResolvedValueOnce();

      const success = await syncOnlineProfile({ uid: 'user123', displayName: 'NewName' });
      expect(success).toBe(true);

      expect(set).toHaveBeenCalledTimes(1);
      const writePayload = set.mock.calls[0][1];
      
      expect(writePayload.displayName).toBe('NewName'); // updated
      expect(writePayload.photoURL).toBe('old.png'); // preserved missing field
      expect(writePayload.createdAt).toBe('OLD_TIMESTAMP'); // preserved
      expect(writePayload.updatedAt).toBe('MOCK_TIMESTAMP'); // updated
    });

    it('should fail gracefully on network or permission errors without crashing', async () => {
      get.mockRejectedValueOnce(new Error('Permission Denied'));
      
      const success = await syncOnlineProfile({ uid: 'user123' });
      expect(success).toBe(false); // Graceful failure
    });
  });

  describe('Local Progress Isolation', () => {
    it('should not mutate local player progress when syncing online profile', async () => {
      const pBefore = await loadPlayerProgress();
      
      get.mockResolvedValueOnce({ val: () => null });
      set.mockResolvedValueOnce();
      await syncOnlineProfile({ uid: 'user123', displayName: 'TestUser' });
      
      const pAfter = await loadPlayerProgress();
      
      expect(pBefore.totalXp).toBe(pAfter.totalXp);
      expect(pBefore.stars).toEqual(pAfter.stars);
    });
  });

  describe('Connection Service', () => {
    it('should expose offline by default', () => {
      let currentState;
      const unsubscribe = subscribeToConnectionState((state) => {
        currentState = state;
      });
      
      expect(currentState).toBe(ConnectionState.OFFLINE);
      unsubscribe();
    });
  });

  describe('PvP Compatibility Helper', () => {
    it('should expose ruleset, vocabulary version, and schema', () => {
      const info = getCompatibilityInfo();
      expect(info.rulesetVersion).toBe('1.0.0');
      expect(info.vocabularyVersion).toBeDefined();
      expect(info.vocabularySchemaVersion).toBeDefined();
      expect(info.supportedModes).toContain('STANDARD_4_CHOICE');
    });
  });
});
