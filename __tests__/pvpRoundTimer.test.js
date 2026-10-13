import {
  ROUND_TIME_LIMIT_MS,
  ROUND_PRE_BATTLE_MS,
  getRoundDeadline,
  getRoundAnsweringStart,
  startRoundTimer,
  submitAnswer,
  submitTimeout,
  resolveRound,
  advanceRound,
  useBattleItem,
  calculateRoundDamage,
  calculateSpeedOutcome,
} from '../src/services/pvp/pvpBattleService';
import { ref, runTransaction } from 'firebase/database';
import { createPvpQuestions } from '../src/domain/pvp/pvpQuestions';
import { getServerNow } from '../src/services/firebase/serverTimeService';

jest.mock('firebase/database', () => ({
  ref: jest.fn((db, path) => path),
  runTransaction: jest.fn(),
  onValue: jest.fn(),
  serverTimestamp: jest.fn(() => 1000),
}));
jest.mock('../src/services/firebase/firebaseDatabase', () => ({ db: {} }));
jest.mock('../src/services/firebase/serverTimeService', () => ({
  getServerNow: jest.fn(() => 5000),
  initServerTimeOffset: jest.fn(),
  getServerTimeOffset: jest.fn(() => 0),
}));

describe('Phase 11C: Round Time Limit & Timeout Settlement', () => {
  let room;
  const player = () => ({
    hp: 100, score: 0, correct: 0, wrong: 0,
    items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } },
    itemUses: {},
  });
  const makeRoom = () => ({
    meta: { hostUid: 'host1', status: 'IN_BATTLE' },
    players: { host1: {}, guest1: {} },
    match: { battleSeed: '12345', level: 1, questionCount: 10 },
    matchState: {
      roundIndex: 0, phase: 'ANSWERING', roundStartedAt: 1000,
      players: { host1: player(), guest1: player() },
      rounds: {},
    },
  });

  const [question] = createPvpQuestions(makeRoom().match);
  const correctChoice = question.correctChoiceId;
  const wrongChoice = question.choices.find(c => c.id !== correctChoice).id;

  beforeEach(() => {
    jest.clearAllMocks();
    room = makeRoom();
    runTransaction.mockImplementation(async (path, update) => {
      const current = path.endsWith('/matchState') ? room.matchState : room;
      const next = update(JSON.parse(JSON.stringify(current)));
      if (next !== undefined) {
        if (path.endsWith('/matchState')) room.matchState = next;
        else room = next;
      }
      return { committed: next !== undefined };
    });
  });

  // 1. answer before timeout accepted
  it('1. answer before timeout accepted', async () => {
    // Round 0 deadline: roundStartedAt(1000) + ROUND_PRE_BATTLE_MS(4000) + ROUND_TIME_LIMIT_MS(6000) = 11000
    getServerNow.mockReturnValueOnce(5000); // 5000 <= 11000

    const res = await submitAnswer('room1', 'guest1', 0, correctChoice);
    expect(res.committed).toBe(true);
    expect(room.matchState.rounds[0].answers.guest1.selectedChoiceId).toBe(correctChoice);
  });

  // 2. answer after deadline rejected
  it('2. answer after deadline rejected', async () => {
    getServerNow.mockReturnValueOnce(11001); // 11001 > 11000 (expired)

    const res = await submitAnswer('room1', 'guest1', 0, correctChoice);
    expect(res.committed).toBe(false);
    expect(room.matchState.rounds?.[0]?.answers?.guest1).toBeUndefined();
  });

  // 3. one correct + opponent timeout -> 20 / 0
  it('3. one correct + opponent timeout -> 20 / 0', async () => {
    getServerNow.mockReturnValue(11000); // deadline reached

    // Host answered correctly in time; Guest timed out without answering
    room.matchState.rounds[0] = {
      answers: {
        host1: { selectedChoiceId: correctChoice, submittedAt: 2000 },
      },
    };

    const res = await resolveRound('room1', 'host1', 'guest1', 0);
    expect(res.committed).toBe(true);

    const resolution = room.matchState.rounds[0].resolution;
    expect(resolution.hostCorrect).toBe(true);
    expect(resolution.guestCorrect).toBe(false);
    expect(resolution.guestTimedOut).toBe(true);
    expect(resolution.hostTimedOut).toBe(false);
    expect(resolution.damageToGuest).toBe(20);
    expect(resolution.damageToHost).toBe(0);
    expect(room.matchState.players.host1.hp).toBe(100);
    expect(room.matchState.players.guest1.hp).toBe(80);
  });

  // 4. one wrong + opponent timeout -> 0 / 0
  it('4. one wrong + opponent timeout -> 0 / 0', async () => {
    getServerNow.mockReturnValue(11000);

    room.matchState.rounds[0] = {
      answers: {
        host1: { selectedChoiceId: wrongChoice, submittedAt: 2000 },
      },
    };

    const res = await resolveRound('room1', 'host1', 'guest1', 0);
    expect(res.committed).toBe(true);

    const resolution = room.matchState.rounds[0].resolution;
    expect(resolution.hostCorrect).toBe(false);
    expect(resolution.guestCorrect).toBe(false);
    expect(resolution.damageToGuest).toBe(0);
    expect(resolution.damageToHost).toBe(0);
    expect(room.matchState.players.host1.hp).toBe(100);
    expect(room.matchState.players.guest1.hp).toBe(100);
  });

  // 5. both timeout -> 0 / 0
  it('5. both timeout -> 0 / 0', async () => {
    getServerNow.mockReturnValue(11000);

    // Neither player answered before deadline
    const res = await resolveRound('room1', 'host1', 'guest1', 0);
    expect(res.committed).toBe(true);

    const resolution = room.matchState.rounds[0].resolution;
    expect(resolution.hostTimedOut).toBe(true);
    expect(resolution.guestTimedOut).toBe(true);
    expect(resolution.hostCorrect).toBe(false);
    expect(resolution.guestCorrect).toBe(false);
    expect(resolution.damageToGuest).toBe(0);
    expect(resolution.damageToHost).toBe(0);
    expect(room.matchState.rounds[0].answers.host1.timedOut).toBe(true);
    expect(room.matchState.rounds[0].answers.guest1.timedOut).toBe(true);
  });

  // 6. timeout + POWER -> outgoing remains 0
  it('6. timeout + POWER -> outgoing remains 0', async () => {
    getServerNow.mockReturnValue(11000);

    // Host committed POWER but timed out
    room.matchState.players.host1.items.POWER.remaining = 0;
    room.matchState.players.host1.itemUses[0] = { itemId: 'POWER', actionId: 'p1', usedAt: 1000 };

    // Guest answered correctly in time
    room.matchState.rounds[0] = {
      answers: {
        guest1: { selectedChoiceId: correctChoice, submittedAt: 2000 },
      },
    };

    const res = await resolveRound('room1', 'host1', 'guest1', 0);
    expect(res.committed).toBe(true);

    const resolution = room.matchState.rounds[0].resolution;
    expect(resolution.hostTimedOut).toBe(true);
    expect(resolution.hostBaseDamage).toBe(0);
    expect(resolution.hostPowerBonus).toBe(0);
    expect(resolution.damageToGuest).toBe(0);
    expect(resolution.damageToHost).toBe(20);
    expect(room.matchState.players.host1.hp).toBe(80);
    expect(room.matchState.players.guest1.hp).toBe(100);
  });

  // 7. timeout vs SHIELD -> incoming 0 blocked safely
  it('7. timeout vs SHIELD -> incoming 0 blocked safely', async () => {
    getServerNow.mockReturnValue(11000);

    // Host has SHIELD active, Guest times out
    room.matchState.players.host1.items.SHIELD.remaining = 0;
    room.matchState.players.host1.itemUses[0] = { itemId: 'SHIELD', actionId: 's1', usedAt: 1000 };

    // Host answered correctly
    room.matchState.rounds[0] = {
      answers: {
        host1: { selectedChoiceId: correctChoice, submittedAt: 2000 },
      },
    };

    const res = await resolveRound('room1', 'host1', 'guest1', 0);
    expect(res.committed).toBe(true);

    const resolution = room.matchState.rounds[0].resolution;
    expect(resolution.guestTimedOut).toBe(true);
    expect(resolution.damageToGuest).toBe(20);
    expect(resolution.damageToHost).toBe(0);
    expect(resolution.hostShieldBlocked).toBe(0);
  });

  // 8. faster correct + timeout -> 20 / 0
  it('8. faster correct + timeout -> 20 / 0', async () => {
    getServerNow.mockReturnValue(11000);

    // Guest answered right at 2000ms, Host timed out
    room.matchState.rounds[0] = {
      answers: {
        guest1: { selectedChoiceId: correctChoice, submittedAt: 2000 },
      },
    };

    const res = await resolveRound('room1', 'host1', 'guest1', 0);
    expect(res.committed).toBe(true);

    const resolution = room.matchState.rounds[0].resolution;
    expect(resolution.hostTimedOut).toBe(true);
    expect(resolution.guestTimedOut).toBe(false);
    expect(resolution.damageToHost).toBe(20);
    expect(resolution.damageToGuest).toBe(0);
  });

  // 9. both correct within limit -> speed priority intact
  it('9. both correct within limit -> speed priority intact', async () => {
    room.matchState.rounds[0] = {
      answers: {
        host1: { selectedChoiceId: correctChoice, submittedAt: 2000 },
        guest1: { selectedChoiceId: correctChoice, submittedAt: 2400 },
      },
    };

    const res = await resolveRound('room1', 'host1', 'guest1', 0);
    expect(res.committed).toBe(true);

    const resolution = room.matchState.rounds[0].resolution;
    expect(resolution.speedOutcome).toBe('HOST_FASTER');
    expect(resolution.speedDiffMs).toBe(400);
    expect(resolution.damageToGuest).toBe(20);
    expect(resolution.damageToHost).toBe(0);
  });

  // 10. Canonical deadline derivation
  it('10. Canonical deadline derivation for Round 0 and Round 1+', () => {
    // Round 0 includes 4000ms pre-battle countdown + 6000ms time limit
    expect(getRoundDeadline(10000, 0)).toBe(10000 + 4000 + 6000);
    expect(getRoundAnsweringStart(10000, 0)).toBe(10000 + 4000);

    // Round 1+ starts answering immediately for 6000ms
    expect(getRoundDeadline(20000, 1)).toBe(20000 + 6000);
    expect(getRoundAnsweringStart(20000, 1)).toBe(20000);
  });

  // 11. later rounds receive fresh roundStartedAt without client arithmetic
  it('11. later rounds receive fresh roundStartedAt without client arithmetic', async () => {
    room.matchState.phase = 'ROUND_RESULT';
    room.matchState.roundIndex = 0;
    room.matchState.roundStartedAt = 10000;

    const { serverTimestamp } = require('firebase/database');
    serverTimestamp.mockReturnValueOnce(20000);

    const res = await advanceRound('room1', 0);
    expect(res.committed).toBe(true);
    expect(room.matchState.roundIndex).toBe(1);
    expect(room.matchState.phase).toBe('ANSWERING');
    expect(room.matchState.roundStartedAt).toBe(20000);
    expect(room.matchState.roundDeadlineAt).toBeUndefined(); // no redundant deadline field
  });

  // 12. no stale timeout/deadline carries between rounds
  it('12. no stale timeout/deadline carries between rounds', async () => {
    room.matchState.rounds[0] = {
      answers: {
        host1: { timedOut: true, submittedAt: 16000 },
        guest1: { timedOut: true, submittedAt: 16000 },
      },
      resolution: { hostTimedOut: true, guestTimedOut: true },
    };
    room.matchState.phase = 'ROUND_RESULT';
    room.matchState.roundIndex = 0;

    const { serverTimestamp } = require('firebase/database');
    serverTimestamp.mockReturnValue(30000);

    await advanceRound('room1', 0);
    expect(room.matchState.roundIndex).toBe(1);
    expect(room.matchState.rounds[1]).toBeUndefined(); // fresh round

    // Round 1 deadline: roundStartedAt(30000) + 6000 = 36000
    getServerNow.mockReturnValueOnce(31000);
    const ansRes = await submitAnswer('room1', 'guest1', 1, correctChoice);
    expect(ansRes.committed).toBe(true);
    expect(room.matchState.rounds[1].answers.guest1.selectedChoiceId).toBe(correctChoice);
  });

  // 13. both devices resolve same authoritative timeout state
  it('13. both devices resolve same authoritative timeout state', async () => {
    room.matchState.roundIndex = 1;
    room.matchState.roundStartedAt = 1000; // Round 1 deadline: 1000 + 6000 = 7000

    // Guest submits explicit timeout after deadline
    getServerNow.mockReturnValue(7005);
    const { serverTimestamp } = require('firebase/database');
    serverTimestamp.mockReturnValue(7005);
    await submitTimeout('room1', 'guest1', 1);

    expect(room.matchState.rounds[1].answers.guest1).toEqual({
      timedOut: true,
      submittedAt: 7005,
    });

    // Host answered before deadline at 3000ms
    const round1Questions = createPvpQuestions(makeRoom().match);
    const round1CorrectChoice = round1Questions[1].correctChoiceId;
    room.matchState.rounds[1].answers.host1 = {
      selectedChoiceId: round1CorrectChoice,
      submittedAt: 3000,
    };

    await resolveRound('room1', 'host1', 'guest1', 1);
    const res = room.matchState.rounds[1].resolution;

    expect(res.guestTimedOut).toBe(true);
    expect(res.hostTimedOut).toBe(false);
    expect(res.hostCorrect).toBe(true);
    expect(res.guestCorrect).toBe(false);
    expect(res.damageToGuest).toBe(20);
    expect(res.damageToHost).toBe(0);
  });
});
