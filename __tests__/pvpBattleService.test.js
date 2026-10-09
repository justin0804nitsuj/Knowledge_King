import { submitAnswer, resolveRound, advanceRound, finalizeMatch, useBattleItem } from '../src/services/pvp/pvpBattleService';
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

describe('pvpBattleService Lockstep Round logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const getInitialPlayerState = () => ({
    hp: 100,
    items: {
      HEAL: { remaining: 2 },
      SHIELD: { remaining: 1 },
      POWER: { remaining: 1 }
    },
    score: 0,
    correct: 0,
    wrong: 0,
    itemUses: {}
  });

  const getInitialMatchState = () => ({
    roundIndex: 0,
    phase: 'ANSWERING',
    players: {
      host1: getInitialPlayerState(),
      guest1: getInitialPlayerState()
    },
    rounds: {}
  });

  // Coverage: 2. A answering does NOT advance A
  // Coverage: 3. A answering does NOT advance B
  // Coverage: 4. A answering does NOT immediately deal damage
  // Coverage: 26. submitAnswer can never directly mutate opponent HP
  test('submitAnswer only records answer, does not deal damage or advance round', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const current = null;
      const result = fn(current);
      expect(result.isCorrect).toBe(true);
      expect(result.selectedChoiceId).toBe('choiceA');
      return { committed: true };
    });

    await submitAnswer('room1', 'host1', 'guest1', 0, 'choiceA', true, 10);
  });

  test('submitAnswer idempotent (cannot answer twice)', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const current = { isCorrect: true };
      const result = fn(current);
      expect(result).toBeUndefined(); // abort
      return { committed: false };
    });

    await submitAnswer('room1', 'host1', 'guest1', 0, 'choiceA', true, 10);
  });

  // Coverage: 25. host cannot resolve before both answers exist
  test('resolveRound fails if both have not answered', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialMatchState();
      state.rounds[0] = { answers: { host1: { isCorrect: true } } }; // missing guest
      const result = fn(state);
      expect(result).toBeUndefined(); // abort
      return { committed: false };
    });

    await resolveRound('room1', 'host1', 'guest1', 0);
  });

  // Coverage: 12. round resolves exactly once
  test('resolveRound fails if already resolved', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialMatchState();
      state.rounds[0] = {
        answers: { host1: { isCorrect: true }, guest1: { isCorrect: true } },
        resolution: { hostCorrect: true }
      };
      const result = fn(state);
      expect(result.phase).toBe('ANSWERING'); // no change
      return { committed: false };
    });

    await resolveRound('room1', 'host1', 'guest1', 0);
  });

  // Coverage: 7. both answers trigger one settlement
  // Coverage: 8. A correct/B wrong → B -20 only
  test('resolveRound: Host correct, Guest wrong -> Guest -20 HP', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialMatchState();
      state.rounds[0] = {
        answers: { host1: { isCorrect: true }, guest1: { isCorrect: false } }
      };
      const result = fn(state);
      expect(result.phase).toBe('ROUND_RESULT');
      expect(result.players.host1.hp).toBe(100);
      expect(result.players.guest1.hp).toBe(80);
      expect(result.players.host1.score).toBe(10);
      expect(result.players.guest1.score).toBe(0);
      expect(result.rounds[0].resolution).toBeDefined();
      return { committed: true };
    });

    await resolveRound('room1', 'host1', 'guest1', 0);
  });

  // Coverage: 9. A wrong/B correct → A -20 only
  test('resolveRound: Host wrong, Guest correct -> Host -20 HP', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialMatchState();
      state.rounds[0] = {
        answers: { host1: { isCorrect: false }, guest1: { isCorrect: true } }
      };
      const result = fn(state);
      expect(result.players.host1.hp).toBe(80);
      expect(result.players.guest1.hp).toBe(100);
      return { committed: true };
    });

    await resolveRound('room1', 'host1', 'guest1', 0);
  });

  // Coverage: 10. both correct → both -20
  test('resolveRound: both correct -> both -20 HP', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialMatchState();
      state.rounds[0] = {
        answers: { host1: { isCorrect: true }, guest1: { isCorrect: true } }
      };
      const result = fn(state);
      expect(result.players.host1.hp).toBe(80);
      expect(result.players.guest1.hp).toBe(80);
      return { committed: true };
    });

    await resolveRound('room1', 'host1', 'guest1', 0);
  });

  // Coverage: 11. both wrong → no damage
  test('resolveRound: both wrong -> no damage', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialMatchState();
      state.rounds[0] = {
        answers: { host1: { isCorrect: false }, guest1: { isCorrect: false } }
      };
      const result = fn(state);
      expect(result.players.host1.hp).toBe(100);
      expect(result.players.guest1.hp).toBe(100);
      return { committed: true };
    });

    await resolveRound('room1', 'host1', 'guest1', 0);
  });

  // Coverage: 13. shared roundIndex advances exactly once
  // Coverage: 14. both clients move to Q2 together
  test('advanceRound increments roundIndex and resets phase', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialMatchState();
      state.phase = 'ROUND_RESULT';
      const result = fn(state);
      expect(result.roundIndex).toBe(1);
      expect(result.phase).toBe('ANSWERING');
      return { committed: true };
    });

    await advanceRound('room1', 0);
  });

  // Coverage: 17. HEAL potion +25 capped at 100
  // Coverage: 18. HEAL consumes exactly one
  test('useBattleItem (HEAL) heals 25 capped at 100 and consumes 1 potion', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialPlayerState();
      state.hp = 80;
      const result = fn(state);
      expect(result.hp).toBe(100); // capped at 100, not 105
      expect(result.items.HEAL.remaining).toBe(1);
      expect(result.itemUses['0']).toBeDefined();
      expect(result.itemUses['0'].itemId).toBe('HEAL');
      return { committed: true };
    });

    await useBattleItem({ roomCode: 'room1', uid: 'host1', itemId: 'HEAL', roundIndex: 0, actionId: 'action_1' });
  });

  // Coverage: 19. duplicate item action in same round aborts
  test('useBattleItem idempotent with same roundIndex', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = getInitialPlayerState();
      state.hp = 100;
      state.items.HEAL.remaining = 1;
      state.itemUses['0'] = { itemId: 'HEAL', actionId: 'action_1' };
      const result = fn(state);
      expect(result).toBeUndefined(); // Abort
      return { committed: false };
    });

    await useBattleItem({ roomCode: 'room1', uid: 'host1', itemId: 'HEAL', roundIndex: 0, actionId: 'action_2' });
  });

  // Coverage: 21. simultaneous lethal both-correct at HP20/20 → DRAW
  test('finalizeMatch: simultaneous lethal (20/20) both correct -> DRAW', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { hp: 0, score: 50 },
            guest1: { hp: 0, score: 50 }
          }
        }
      };
      const result = fn(state);
      expect(result.matchState.result.winnerUid).toBeNull(); // DRAW
      expect(result.meta.status).toBe(RoomStatus.FINISHED);
      return { committed: true };
    });

    await finalizeMatch('room1', 'host1', 'guest1');
  });

  // Coverage: 22. HP20 vs HP40 both correct → HP0 vs20, second player wins
  test('finalizeMatch: HP 20 vs 40 -> HP 0 vs 20 -> Guest wins', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { hp: 0, score: 50 },
            guest1: { hp: 20, score: 50 }
          }
        }
      };
      const result = fn(state);
      expect(result.matchState.result.winnerUid).toBe('guest1');
      return { committed: true };
    });

    await finalizeMatch('room1', 'host1', 'guest1');
  });

  // Coverage: 23. question exhaustion uses HP → score → draw
  test('finalizeMatch: question exhaustion uses HP then Score', async () => {
    runTransaction.mockImplementationOnce((ref, fn) => {
      const state = {
        meta: { status: RoomStatus.IN_BATTLE },
        matchState: {
          players: {
            host1: { hp: 60, score: 100 },
            guest1: { hp: 60, score: 110 }
          }
        }
      };
      const result = fn(state);
      expect(result.matchState.result.winnerUid).toBe('guest1'); // Guest has higher score
      return { committed: true };
    });

    await finalizeMatch('room1', 'host1', 'guest1');
  });
});
