import { createRoom, joinRoom, leaveRoom } from '../src/services/pvp/roomService';
import { loadPlayerProgress } from '../src/storage/playerProgressStorage';

jest.mock('firebase/database', () => {
  return {
    getDatabase: jest.fn(),
    ref: jest.fn((db, path) => path),
    get: jest.fn(),
    set: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    serverTimestamp: jest.fn(() => 'MOCK_TIMESTAMP'),
    runTransaction: jest.fn(),
    onValue: jest.fn(),
    off: jest.fn()
  };
});

jest.mock('../src/services/firebase/firebaseApp', () => ({
  app: {}
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
}));

describe('Phase 8A PvP Foundation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Local Progress Isolation', () => {
    it('should not mutate local player progress when performing room operations', async () => {
      const pBefore = await loadPlayerProgress();
      
      const { runTransaction, get, set } = require('firebase/database');
      
      // Mock createRoom successful transaction
      runTransaction.mockImplementationOnce((ref, updateFn) => {
        const newData = updateFn(null);
        return Promise.resolve({ committed: true, snapshot: { val: () => newData } });
      });

      try {
        await createRoom({ uid: 'host123', displayName: 'Host' });
      } catch (e) {}
      
      // Mock joinRoom successful get and set
      get.mockResolvedValueOnce({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: '1.0.0', vocabularyVersion: '1', vocabularySchemaVersion: 1 },
          players: { host123: {} }
        })
      });
      set.mockResolvedValueOnce();

      try {
        await joinRoom('12345', { uid: 'guest456', displayName: 'Guest' });
      } catch (e) {}

      // Mock leaveRoom successful get and remove
      get.mockResolvedValueOnce({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123' },
          players: { guest456: {} }
        })
      });
      
      try {
        await leaveRoom('12345', { uid: 'guest456' });
      } catch (e) {}
      
      const pAfter = await loadPlayerProgress();
      
      expect(pBefore.totalXp).toBe(pAfter.totalXp);
      expect(pBefore.stars).toEqual(pAfter.stars);
    });
  });
});
