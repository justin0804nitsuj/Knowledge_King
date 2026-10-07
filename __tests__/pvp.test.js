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
      
      const { runTransaction, get, set, remove } = require('firebase/database');
      
      // Mock createRoom successful transaction
      runTransaction.mockImplementationOnce((ref, updateFn) => {
        const newData = updateFn(null);
        return Promise.resolve({ committed: true, snapshot: { val: () => newData } });
      });

      try {
        await createRoom({ uid: 'host123', displayName: 'Host' });
      } catch (e) {}
      
      // Mock joinRoom successful get and runTransaction
      get.mockResolvedValueOnce({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: '1.0.0', vocabularyVersion: '1', vocabularySchemaVersion: 1 },
          players: { host123: {} }
        })
      });
      runTransaction.mockImplementationOnce((ref, updateFn) => {
        const newPlayers = updateFn({ host123: {} });
        return Promise.resolve({ committed: true, snapshot: { val: () => newPlayers } });
      });

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

  describe('Concurrency and Join Edge Cases', () => {
    it('should correctly block a third player when two guests join concurrently via transaction', async () => {
      const { runTransaction, get } = require('firebase/database');
      
      // Mock get to pass initial validation
      get.mockResolvedValue({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: '1.0.0', vocabularyVersion: '1', vocabularySchemaVersion: 1 },
          players: { host123: {} }
        })
      });

      let transactionCallback;
      runTransaction.mockImplementationOnce((ref, updateFn) => {
        transactionCallback = updateFn;
        // Simulate room already full by the time the transaction runs
        const stateWhenTransactionRuns = { host123: {}, guestA: {} };
        const newState = updateFn(stateWhenTransactionRuns);
        
        // The updateFn should return undefined if full
        if (newState === undefined) {
          return Promise.resolve({ committed: true, snapshot: { val: () => stateWhenTransactionRuns } });
        }
        return Promise.resolve({ committed: true, snapshot: { val: () => newState } });
      });

      await expect(joinRoom('12345', { uid: 'guestB', displayName: 'Guest B' })).rejects.toThrow('Room is full');
    });

    it('should treat same UID re-entry as successful idempotent join', async () => {
      const { runTransaction, get } = require('firebase/database');
      
      get.mockResolvedValue({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: '1.0.0', vocabularyVersion: '1', vocabularySchemaVersion: 1 },
          players: { host123: {}, guestA: {} }
        })
      });

      runTransaction.mockImplementationOnce((ref, updateFn) => {
        const stateWhenTransactionRuns = { host123: {}, guestA: {} };
        const newState = updateFn(stateWhenTransactionRuns);
        
        // updateFn returns the unchanged object for re-entry
        return Promise.resolve({ committed: true, snapshot: { val: () => newState } });
      });

      const result = await joinRoom('12345', { uid: 'guestA', displayName: 'Guest A' });
      expect(result).toBe('12345');
    });
    
    it('should correctly handle leaving a closed room cleanly', async () => {
      const { get, remove, set } = require('firebase/database');
      
      get.mockResolvedValueOnce({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123' },
          players: { host123: {} }
        })
      });
      
      await leaveRoom('12345', { uid: 'host123' });
      expect(set).toHaveBeenCalledWith(undefined, 'CANCELLED');
      expect(remove).toHaveBeenCalled();
    });
  });
});
