import { submitAnswer, finalizeMatch, usePotion } from '../src/services/pvp/pvpBattleService';
import { runTransaction } from 'firebase/database';
import { RoomStatus } from '../src/domain/pvp/roomConstants';

jest.mock('firebase/database', () => ({
  ref: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn(() => 123456789)
}));

jest.mock('../src/services/firebase/firebaseDatabase', () => ({
  db: {}
}));

describe('pvpBattleService HP logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getInitialPlayerState = () => ({
    hp: 100,
    potionsRemaining: 2,
    currentQuestionIndex: 0,
    score: 0,
    correct: 0,
    wrong: 0,
    completed: false
  });

  test('duplicate answer event does not double damage', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = {
        user1: getInitialPlayerState(),
        opponent1: getInitialPlayerState()
      };
      currentState.user1.currentQuestionIndex = 1; // already processed
      
      const nextState = fn(currentState);
      expect(nextState).toBeUndefined(); // Transaction aborts
      return { committed: false };
    });

    await submitAnswer('12345', 'user1', 'opponent1', 'match1', 0, true, 10, false);
    expect(runTransaction).toHaveBeenCalled();
  });

  test('correct answer deals exactly 20 damage and increases score', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = {
        user1: getInitialPlayerState(),
        opponent1: getInitialPlayerState()
      };
      const nextState = fn(currentState);
      expect(nextState.user1.score).toBe(10);
      expect(nextState.user1.correct).toBe(1);
      expect(nextState.user1.currentQuestionIndex).toBe(1);
      expect(nextState.opponent1.hp).toBe(80);
      return { committed: true };
    });

    await submitAnswer('12345', 'user1', 'opponent1', 'match1', 0, true, 10, false);
  });

  test('wrong answer deals 0 damage and does not increase score', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = {
        user1: getInitialPlayerState(),
        opponent1: getInitialPlayerState()
      };
      const nextState = fn(currentState);
      expect(nextState.user1.score).toBe(0);
      expect(nextState.user1.wrong).toBe(1);
      expect(nextState.opponent1.hp).toBe(100);
      return { committed: true };
    });

    await submitAnswer('12345', 'user1', 'opponent1', 'match1', 0, false, 10, false);
  });

  test('HP cannot go below 0 and completes opponent', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = {
        user1: getInitialPlayerState(),
        opponent1: getInitialPlayerState()
      };
      currentState.opponent1.hp = 10;
      
      const nextState = fn(currentState);
      expect(nextState.opponent1.hp).toBe(0);
      expect(nextState.opponent1.completed).toBe(true);
      expect(nextState.user1.completed).toBe(true); // Since opp is dead
      return { committed: true };
    });

    await submitAnswer('12345', 'user1', 'opponent1', 'match1', 0, true, 10, false);
  });

  test('defeated player cannot answer', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = {
        user1: getInitialPlayerState(),
        opponent1: getInitialPlayerState()
      };
      currentState.user1.hp = 0;
      
      const nextState = fn(currentState);
      expect(nextState).toBeUndefined(); // Abort
      return { committed: true };
    });

    await submitAnswer('12345', 'user1', 'opponent1', 'match1', 0, true, 10, false);
  });

  test('potion restores exactly 25 and decrements count', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = getInitialPlayerState();
      currentState.hp = 60;
      
      const nextState = fn(currentState);
      expect(nextState.hp).toBe(85);
      expect(nextState.potionsRemaining).toBe(1);
      return { committed: true };
    });

    await usePotion('12345', 'user1');
  });

  test('potion cannot exceed HP 100', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = getInitialPlayerState();
      currentState.hp = 90;
      
      const nextState = fn(currentState);
      expect(nextState.hp).toBe(100);
      expect(nextState.potionsRemaining).toBe(1);
      return { committed: true };
    });

    await usePotion('12345', 'user1');
  });

  test('potion unavailable at HP 100', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = getInitialPlayerState(); // HP 100
      
      const nextState = fn(currentState);
      expect(nextState).toBeUndefined(); // Abort
      return { committed: true };
    });

    await usePotion('12345', 'user1');
  });

  test('potion unavailable with 0 remaining', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = getInitialPlayerState(); 
      currentState.hp = 50;
      currentState.potionsRemaining = 0;
      
      const nextState = fn(currentState);
      expect(nextState).toBeUndefined(); // Abort
      return { committed: true };
    });

    await usePotion('12345', 'user1');
  });

  test('defeated player cannot heal', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = getInitialPlayerState(); 
      currentState.hp = 0;
      
      const nextState = fn(currentState);
      expect(nextState).toBeUndefined(); // Abort
      return { committed: true };
    });

    await usePotion('12345', 'user1');
  });

  test('winner is opponent of defeated player', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const roomData = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { completed: true, hp: 100, score: 10 },
            guest1: { completed: true, hp: 0, score: 9999 } // High score but dead
          }
        }
      };
      const result = fn(roomData);
      expect(result.meta.status).toBe(RoomStatus.FINISHED);
      expect(result.matchState.result.winnerUid).toBe('host1');
      return { committed: true };
    });

    await finalizeMatch('12345', 'host1', 'guest1');
  });

  test('equal HP draws', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const roomData = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { completed: true, hp: 40 },
            guest1: { completed: true, hp: 40 }
          }
        }
      };
      const result = fn(roomData);
      expect(result.meta.status).toBe(RoomStatus.FINISHED);
      expect(result.matchState.result.winnerUid).toBeNull();
      return { committed: true };
    });

    await finalizeMatch('12345', 'host1', 'guest1');
  });
});
