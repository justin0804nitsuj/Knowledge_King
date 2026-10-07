import { submitAnswer, finalizeMatch } from '../src/services/pvp/pvpBattleService';
import { runTransaction } from 'firebase/database';
import { RoomStatus } from '../src/domain/pvp/roomConstants';

jest.mock('firebase/database', () => ({
  ref: jest.fn(),
  runTransaction: jest.fn(),
  serverTimestamp: jest.fn(() => 123456789)
}));

jest.mock('../src/firebase/firebaseDatabase', () => ({
  db: {}
}));

describe('pvpBattleService logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('3. duplicate answer event does not double score', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      // Simulate state where question 0 was already processed
      const currentState = { currentQuestionIndex: 1, score: 10, correct: 1, wrong: 0, completed: false };
      const nextState = fn(currentState);
      expect(nextState).toBeUndefined(); // Transaction aborts
      return { committed: false };
    });

    await submitAnswer('12345', 'user1', 'match1', 0, true, 10, false);
    expect(runTransaction).toHaveBeenCalled();
  });

  test('4. correct answer increases score', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = null; // First question
      const nextState = fn(currentState);
      expect(nextState.score).toBe(10);
      expect(nextState.correct).toBe(1);
      expect(nextState.currentQuestionIndex).toBe(1);
      return { committed: true };
    });

    await submitAnswer('12345', 'user1', 'match1', 0, true, 10, false);
  });

  test('5. wrong answer does not increase score', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = null; 
      const nextState = fn(currentState);
      expect(nextState.score).toBe(0);
      expect(nextState.wrong).toBe(1);
      expect(nextState.currentQuestionIndex).toBe(1);
      return { committed: true };
    });

    await submitAnswer('12345', 'user1', 'match1', 0, false, 10, false);
  });

  test('10. completion after exact questionCount', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const currentState = { currentQuestionIndex: 9, score: 90, correct: 9, wrong: 0, completed: false }; 
      const nextState = fn(currentState);
      expect(nextState.completed).toBe(true);
      expect(nextState.finishedAt).toBeDefined();
      return { committed: true };
    });

    await submitAnswer('12345', 'user1', 'match1', 9, true, 10, true);
  });

  test('12. one player completed does not finish entire match', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const roomData = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { completed: true, score: 100 },
            guest1: { completed: false, score: 50 }
          }
        }
      };
      const result = fn(roomData);
      expect(result).toBeUndefined(); // Should abort
      return { committed: false };
    });

    await finalizeMatch('12345', 'host1', 'guest1');
  });

  test('13. both completed triggers finalization, 14. higher score wins', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const roomData = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { completed: true, score: 100 },
            guest1: { completed: true, score: 80 }
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

  test('15. equal score draws', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const roomData = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { completed: true, score: 100 },
            guest1: { completed: true, score: 100 }
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
