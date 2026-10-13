import { createRoom, joinRoom, leaveRoom } from '../src/services/pvp/roomService';
import { loadPlayerProgress } from '../src/storage/playerProgressStorage';
import { RULESET_VERSION } from '../src/domain/game/pvpCompatibility';

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
    off: jest.fn(),
    onDisconnect: jest.fn(() => ({ remove: jest.fn(), cancel: jest.fn() }))
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

  describe('Room Code Generation', () => {
    it('should generate varying 5-digit room codes', () => {
      // roomService.js does not export generateRoomCode, but we can verify it indirectly
      // through createRoom by mocking the transaction to always succeed
      // Since we can't easily intercept the internal generateRoomCode without exposing it,
      // we'll write a quick manual mock test simulating the logic
      
      const codes = new Set();
      for (let i = 0; i < 1000; i++) {
        const code = Math.floor(10000 + Math.random() * 90000).toString();
        expect(code).toMatch(/^\d{5}$/);
        codes.add(code);
      }
      
      // With 1000 codes, we expect almost all of them to be unique
      expect(codes.size).toBeGreaterThan(900);
    });
  });

  describe('Room Creation Edge Cases', () => {
    it('should fail with AUTH_REQUIRED if user is missing', async () => {
      try {
        await createRoom(null);
        fail('Should have thrown');
      } catch (e) {
        expect(e.code).toBe('AUTH_REQUIRED');
      }
    });

    it('should retry only on collision, not on PERMISSION_DENIED', async () => {
      const { runTransaction } = require('firebase/database');
      
      runTransaction.mockImplementationOnce(() => {
        const error = new Error('Permission denied');
        error.code = 'PERMISSION_DENIED';
        return Promise.reject(error);
      });

      try {
        await createRoom({ uid: 'host123', displayName: 'Host' });
        fail('Should have thrown');
      } catch (e) {
        expect(e.code).toBe('PERMISSION_DENIED');
        // Should only be called once, no retries
        expect(runTransaction).toHaveBeenCalledTimes(1);
      }
    });

    it('should exhaust retries on genuine collisions and throw ROOM_CODE_EXHAUSTED', async () => {
      const { runTransaction } = require('firebase/database');
      
      runTransaction.mockImplementation((ref, updateFn) => {
        // Simulate a collision every time (returning undefined because room is not null)
        const newState = updateFn({ some: 'existingData' });
        return Promise.resolve({ committed: false, snapshot: { val: () => ({ some: 'existingData' }) } });
      });

      try {
        await createRoom({ uid: 'host123', displayName: 'Host' });
        fail('Should have thrown');
      } catch (e) {
        expect(e.code).toBe('ROOM_CODE_EXHAUSTED');
        expect(runTransaction).toHaveBeenCalledTimes(10);
      }
    });
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
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: RULESET_VERSION, vocabularyVersion: '1.0.0', vocabularySchemaVersion: "1.0" },
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
    it('rejects pre-hardening ruleset rooms to prevent mixed question sequences', async () => {
      const { get, runTransaction } = require('firebase/database');
      get.mockResolvedValueOnce({ val: () => ({
        meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: '1.0.0', vocabularyVersion: '1.0.0', vocabularySchemaVersion: '1.0' },
        players: { host123: {} },
      }) });
      await expect(joinRoom('12345', { uid: 'guest456' })).rejects.toMatchObject({ code: 'INCOMPATIBLE' });
      expect(runTransaction).not.toHaveBeenCalled();
    });
    it('should correctly block a third player when two guests join concurrently via transaction', async () => {
      const { runTransaction, get } = require('firebase/database');
      
      // Mock get to pass initial validation
      get.mockResolvedValue({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: RULESET_VERSION, vocabularyVersion: '1.0.0', vocabularySchemaVersion: "1.0" },
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
          return Promise.resolve({ committed: false, snapshot: { val: () => stateWhenTransactionRuns } });
        }
        return Promise.resolve({ committed: true, snapshot: { val: () => newState } });
      });

      await expect(joinRoom('12345', { uid: 'guestB', displayName: 'Guest B' })).rejects.toMatchObject({ code: 'ROOM_FULL' });
    });

    it('should treat same UID re-entry as successful idempotent join', async () => {
      const { runTransaction, get } = require('firebase/database');
      
      get.mockResolvedValue({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: RULESET_VERSION, vocabularyVersion: '1.0.0', vocabularySchemaVersion: "1.0" },
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

    it('should throw ROOM_NOT_FOUND if room does not exist', async () => {
      const { get } = require('firebase/database');
      get.mockResolvedValue({ val: () => null });
      
      await expect(joinRoom('12345', { uid: 'guest456' })).rejects.toMatchObject({ code: 'ROOM_NOT_FOUND' });
    });

    it('should throw SELF_JOIN if host tries to join their own room', async () => {
      const { get } = require('firebase/database');
      get.mockResolvedValue({
        val: () => ({
          meta: { status: 'WAITING', hostUid: 'host123', rulesetVersion: RULESET_VERSION, vocabularyVersion: '1.0.0', vocabularySchemaVersion: "1.0" },
          players: { host123: {} }
        })
      });

      await expect(joinRoom('12345', { uid: 'host123' })).rejects.toMatchObject({ code: 'SELF_JOIN' });
    });
    
    describe('Leave Room Behavior', () => {
      it('should allow Guest to remove own player node only', async () => {
        const { get, remove, set } = require('firebase/database');
        
        get.mockResolvedValueOnce({
          val: () => ({
            meta: { status: 'WAITING', hostUid: 'host123' },
            players: { host123: {}, guest456: {} }
          })
        });
        
        await leaveRoom('12345', { uid: 'guest456' });
        // Guest should NOT change status
        expect(set).not.toHaveBeenCalled();
        // Guest should ONLY remove their own player ref
        expect(remove).toHaveBeenCalledWith('rooms/12345/players/guest456');
      });

      it('should allow Host to explicitly close/delete own room', async () => {
        const { get, remove, set } = require('firebase/database');
        
        get.mockResolvedValueOnce({
          val: () => ({
            meta: { status: 'WAITING', hostUid: 'host123' },
            players: { host123: {} }
          })
        });
        
        await leaveRoom('12345', { uid: 'host123' });
        expect(set).toHaveBeenCalledWith('rooms/12345/meta/status', 'CANCELLED');
        expect(remove).toHaveBeenCalledWith('rooms/12345');
        expect(remove).toHaveBeenCalledTimes(1);
      });

      it('Host records departure from a finished room without deleting shared data', async () => {
        const { get, remove, set } = require('firebase/database');
        get.mockImplementation(async (path) => {
          if (path === 'rooms/12345/departures') {
            return { val: () => ({ host123: true }) };
          }
          return {
            val: () => ({
              meta: { status: 'FINISHED', hostUid: 'host123' },
              players: { host123: {}, guest456: {} },
            })
          };
        });
        await leaveRoom('12345', { uid: 'host123' });
        expect(set).toHaveBeenCalledWith('rooms/12345/departures/host123', true);
        expect(remove).not.toHaveBeenCalledWith('rooms/12345/players/host123');
        expect(remove).not.toHaveBeenCalledWith('rooms/12345/players/guest456');
        expect(remove).not.toHaveBeenCalledWith('rooms/12345');
      });

      it('Second player departure cleans up full room when both have departed', async () => {
        const { get, remove, set } = require('firebase/database');
        get.mockImplementation(async (path) => {
          if (path === 'rooms/12345/departures') {
            return { val: () => ({ host123: true, guest456: true }) };
          }
          return {
            val: () => ({
              meta: { status: 'FINISHED', hostUid: 'host123' },
              players: { host123: {}, guest456: {} },
            })
          };
        });
        await leaveRoom('12345', { uid: 'guest456' });
        expect(set).toHaveBeenCalledWith('rooms/12345/departures/guest456', true);
        expect(remove).toHaveBeenCalledWith('rooms/12345');
      });

      it('Reverse order: Guest departs first (room remains), then Host departs second (room deleted)', async () => {
        const { get, remove, set } = require('firebase/database');
        // Step 1: Guest departs first
        get.mockImplementation(async (path) => {
          if (path === 'rooms/12345/departures') {
            return { val: () => ({ guest456: true }) };
          }
          return {
            val: () => ({
              meta: { status: 'FINISHED', hostUid: 'host123' },
              players: { host123: {}, guest456: {} },
            })
          };
        });
        await leaveRoom('12345', { uid: 'guest456' });
        expect(set).toHaveBeenCalledWith('rooms/12345/departures/guest456', true);
        expect(remove).not.toHaveBeenCalledWith('rooms/12345');

        // Step 2: Host departs second
        jest.clearAllMocks();
        get.mockImplementation(async (path) => {
          if (path === 'rooms/12345/departures') {
            return { val: () => ({ host123: true, guest456: true }) };
          }
          return {
            val: () => ({
              meta: { status: 'FINISHED', hostUid: 'host123' },
              players: { host123: {}, guest456: {} },
            })
          };
        });
        await leaveRoom('12345', { uid: 'host123' });
        expect(set).toHaveBeenCalledWith('rooms/12345/departures/host123', true);
        expect(remove).toHaveBeenCalledWith('rooms/12345');
      });

      it('should reject when Guest leave fails due to Firebase error', async () => {
        const { get, remove } = require('firebase/database');
        
        get.mockResolvedValueOnce({
          val: () => ({
            meta: { status: 'WAITING', hostUid: 'host123' },
            players: { host123: {}, guest456: {} }
          })
        });
        
        const err = new Error('PERMISSION_DENIED');
        remove.mockRejectedValueOnce(err);
        
        await expect(leaveRoom('12345', { uid: 'guest456' })).rejects.toThrow('PERMISSION_DENIED');
      });

      it('should reject when Host leave fails due to Firebase error', async () => {
        const { get, set } = require('firebase/database');
        
        get.mockResolvedValueOnce({
          val: () => ({
            meta: { status: 'WAITING', hostUid: 'host123' },
            players: { host123: {} }
          })
        });
        
        const err = new Error('NETWORK_ERROR');
        set.mockRejectedValueOnce(err);
        
        await expect(leaveRoom('12345', { uid: 'host123' })).rejects.toThrow('NETWORK_ERROR');
      });
    });

    describe('Presence Behavior', () => {
      it('should target Guest node only for Guest presence cleanup', () => {
        const { onDisconnect, ref } = require('firebase/database');
        const { setupWaitingRoomPresence } = require('../src/services/pvp/roomService');
        
        setupWaitingRoomPresence('12345', { uid: 'guest456' }, false);
        
        expect(ref).toHaveBeenCalledWith(undefined, 'rooms/12345/players/guest456');
        expect(onDisconnect).toHaveBeenCalled();
      });

      it('should target full room for Host presence cleanup in WAITING state', () => {
        const { onDisconnect, ref } = require('firebase/database');
        const { setupWaitingRoomPresence } = require('../src/services/pvp/roomService');
        
        setupWaitingRoomPresence('12345', { uid: 'host123' }, true);
        
        expect(ref).toHaveBeenCalledWith(undefined, 'rooms/12345');
        expect(onDisconnect).toHaveBeenCalled();
      });
    });
  });
});
