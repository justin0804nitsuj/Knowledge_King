import { submitAnswer, resolveRound, advanceRound, finalizeMatch, useBattleItem, subscribeToMatchState } from '../src/services/pvp/pvpBattleService';
import { ref, runTransaction, onValue } from 'firebase/database';
import { createPvpQuestions } from '../src/domain/pvp/pvpQuestions';

jest.mock('firebase/database', () => ({
  ref: jest.fn((db, path) => path),
  runTransaction: jest.fn(),
  onValue: jest.fn(),
  serverTimestamp: jest.fn(() => 123456789),
}));
jest.mock('../src/services/firebase/firebaseDatabase', () => ({ db: {} }));

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
    roundIndex: 0, phase: 'ANSWERING',
    players: { host1: player(), guest1: player() },
    rounds: {},
  },
});
const [question] = createPvpQuestions(makeRoom().match);
const correctChoice = question.correctChoiceId;
const wrongChoice = question.choices.find(choice => choice.id !== correctChoice).id;

describe('PvP integrity and lockstep settlement', () => {
  let room;
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

  const answer = (uid, choice = correctChoice) => submitAnswer('room1', uid, 0, choice);
  const item = (itemId = 'POWER', roundIndex = 0) => useBattleItem({
    roomCode: 'room1', uid: 'guest1', roundIndex, itemId, actionId: 'action1',
  });
  const settle = () => resolveRound('room1', 'host1', 'guest1', 0);
  const seedAnswers = (hostCorrect = true, guestCorrect = true, hostSubmittedAt = 1000, guestSubmittedAt = 1000) => {
    room.matchState.rounds[0] = { answers: {
      host1: { selectedChoiceId: hostCorrect ? correctChoice : wrongChoice, submittedAt: hostSubmittedAt },
      guest1: { selectedChoiceId: guestCorrect ? correctChoice : wrongChoice, submittedAt: guestSubmittedAt },
    } };
  };

  test('answer records only the action without dealing damage or advancing', async () => {
    expect((await answer('guest1')).committed).toBe(true);
    expect(room.matchState.rounds[0].answers.guest1).toEqual({
      selectedChoiceId: correctChoice, submittedAt: 123456789,
    });
    expect(room.matchState.players.host1.hp).toBe(100);
    expect(room.matchState.players.guest1.hp).toBe(100);
    expect(room.matchState.roundIndex).toBe(0);
    expect(room.matchState.phase).toBe('ANSWERING');
    expect(ref).toHaveBeenCalledWith({}, 'rooms/room1');
    expect(runTransaction.mock.calls[0][2]).toEqual({ applyLocally: false });
  });

  test.each(['RESOLVING', 'ROUND_RESULT', 'FINISHED'])('answer rejected during %s', async phase => {
    room.matchState.phase = phase;
    expect((await answer('guest1')).committed).toBe(false);
  });
  test.each([-1, 1])('answer rejected for wrong round %s', async roundIndex => {
    expect((await submitAnswer('room1', 'guest1', roundIndex, correctChoice)).committed).toBe(false);
  });
  test('past nonnegative round rejected after shared advancement', async () => {
    room.matchState.roundIndex = 1;
    expect((await answer('guest1')).committed).toBe(false);
  });
  test.each(['WAITING', 'FINISHED', 'CANCELLED'])('answer rejected in %s room', async status => {
    room.meta.status = status;
    expect((await answer('guest1')).committed).toBe(false);
  });
  test('dead player cannot answer', async () => {
    room.matchState.players.guest1.hp = 0;
    expect((await answer('guest1')).committed).toBe(false);
  });
  test('nonmember cannot answer', async () => {
    delete room.players.guest1;
    expect((await answer('guest1')).committed).toBe(false);
  });
  test('duplicate answer aborts without replacing the first choice', async () => {
    await answer('guest1');
    expect((await answer('guest1', wrongChoice)).committed).toBe(false);
    expect(room.matchState.rounds[0].answers.guest1.selectedChoiceId).toBe(correctChoice);
  });
  test('retry rechecks phase after a concurrent settlement', async () => {
    runTransaction.mockImplementationOnce(async (path, update) => {
      expect(update(JSON.parse(JSON.stringify(room)))).toBeDefined();
      room.matchState.phase = 'ROUND_RESULT';
      expect(update(JSON.parse(JSON.stringify(room)))).toBeUndefined();
      return { committed: false };
    });
    expect((await answer('guest1')).committed).toBe(false);
  });

  test.each([
    ['HEAL', 60, 85],
    ['HEAL', 80, 100],
    ['SHIELD', 100, 100],
    ['POWER', 100, 100],
  ])('%s before answer is accepted at HP %s -> %s', async (itemId, hp, expectedHp) => {
    room.matchState.players.guest1.hp = hp;
    const before = room.matchState.players.guest1.items[itemId].remaining;
    expect((await item(itemId)).committed).toBe(true);
    const state = room.matchState.players.guest1;
    expect(state.hp).toBe(expectedHp);
    expect(state.items[itemId].remaining).toBe(before - 1);
    expect(state.itemUses[0]).toEqual({ itemId, actionId: 'action1', usedAt: 123456789 });
    expect(ref).toHaveBeenCalledWith({}, 'rooms/room1');
  });
  test.each(['HEAL', 'SHIELD', 'POWER'])('%s after own answer rejected', async itemId => {
    room.matchState.players.guest1.hp = 60;
    await answer('guest1');
    expect((await item(itemId)).committed).toBe(false);
  });
  test.each(['RESOLVING', 'ROUND_RESULT', 'FINISHED'])('item rejected during %s', async phase => {
    room.matchState.phase = phase;
    expect((await item()).committed).toBe(false);
  });
  test.each([-1, 1])('item rejected for wrong round %s', async roundIndex => {
    expect((await item('POWER', roundIndex)).committed).toBe(false);
  });
  test('past nonnegative item round rejected', async () => {
    room.matchState.roundIndex = 1;
    expect((await item()).committed).toBe(false);
  });
  test.each(['WAITING', 'FINISHED', 'CANCELLED'])('item rejected in %s room', async status => {
    room.meta.status = status;
    expect((await item()).committed).toBe(false);
  });
  test('HEAL at full HP rejected without consumption', async () => {
    expect((await item('HEAL')).committed).toBe(false);
    expect(room.matchState.players.guest1.items.HEAL.remaining).toBe(2);
  });
  test('second item in the same round rejected', async () => {
    await item('SHIELD');
    expect((await item('POWER')).committed).toBe(false);
    expect(room.matchState.players.guest1.items.POWER.remaining).toBe(1);
  });
  test('exhausted inventory rejected', async () => {
    room.matchState.players.guest1.items.POWER.remaining = 0;
    expect((await item()).committed).toBe(false);
  });
  test('dead player cannot use an item', async () => {
    room.matchState.players.guest1.hp = 0;
    expect((await item()).committed).toBe(false);
  });
  test('nonmember cannot use an item', async () => {
    delete room.players.guest1;
    expect((await item()).committed).toBe(false);
  });
  test.each(['INVALID', '__proto__'])('invalid item %s rejected', async itemId => {
    expect((await item(itemId)).committed).toBe(false);
  });
  test('item retry rechecks a concurrently submitted answer', async () => {
    runTransaction.mockImplementationOnce(async (path, update) => {
      expect(update(JSON.parse(JSON.stringify(room)))).toBeDefined();
      seedAnswers();
      expect(update(JSON.parse(JSON.stringify(room)))).toBeUndefined();
      return { committed: false };
    });
    expect((await item()).committed).toBe(false);
  });
  test('next round permits another item with reduced inventory', async () => {
    await item('SHIELD');
    room.matchState.phase = 'ROUND_RESULT';
    await advanceRound('room1', 0);
    expect((await item('POWER', 1)).committed).toBe(true);
    expect(room.matchState.players.guest1.items.SHIELD.remaining).toBe(0);
    expect(room.matchState.players.guest1.itemUses[0].itemId).toBe('SHIELD');
  });

  test('Host waits for both answers', async () => {
    await answer('host1');
    expect((await settle()).committed).toBe(false);
    expect(room.matchState.players.guest1.hp).toBe(100);
  });
  test('forged true on a wrong choice cannot deal damage', async () => {
    seedAnswers(false, false);
    room.matchState.rounds[0].answers.guest1.isCorrect = true;
    await settle();
    expect(room.matchState.rounds[0].resolution.guestCorrect).toBe(false);
    expect(room.matchState.players.host1.hp).toBe(100);
    expect(room.matchState.players.guest1.score).toBe(0);
  });
  test('forged false on a correct choice cannot prevent correct damage', async () => {
    seedAnswers(false, true);
    room.matchState.rounds[0].answers.guest1.isCorrect = false;
    await settle();
    expect(room.matchState.rounds[0].resolution.guestCorrect).toBe(true);
    expect(room.matchState.players.host1.hp).toBe(80);
    expect(room.matchState.players.guest1.score).toBe(10);
  });
  test.each([
    ['normal correct', true, false, null, null, 0, 20],
    ['guest correct', false, true, null, null, 20, 0],
    ['both correct (TIE)', true, true, null, null, 10, 10],
    ['both wrong', false, false, null, null, 0, 0],
    ['POWER correct', true, false, 'POWER', null, 0, 30],
    ['SHIELD vs normal', true, false, null, 'SHIELD', 0, 0],
    ['POWER vs SHIELD', true, false, 'POWER', 'SHIELD', 0, 10],
    ['both POWER (TIE)', true, true, 'POWER', 'POWER', 20, 20],
    ['both SHIELD (TIE)', true, true, 'SHIELD', 'SHIELD', 0, 0],
    ['POWER wrong', false, true, 'POWER', null, 20, 0],
  ])('%s settlement', async (name, hostCorrect, guestCorrect, hostItem, guestItem, toHost, toGuest) => {
    seedAnswers(hostCorrect, guestCorrect);
    if (hostItem) room.matchState.players.host1.itemUses[0] = { itemId: hostItem };
    if (guestItem) room.matchState.players.guest1.itemUses[0] = { itemId: guestItem };
    await settle();
    expect(room.matchState.phase).toBe('ROUND_RESULT');
    expect(room.matchState.players.host1.hp).toBe(100 - toHost);
    expect(room.matchState.players.guest1.hp).toBe(100 - toGuest);
    expect(room.matchState.rounds[0].resolution).toMatchObject({
      hostHpBefore: 100, guestHpBefore: 100, damageToHost: toHost, damageToGuest: toGuest,
    });
  });
  test('round settles only once and advances only once', async () => {
    seedAnswers();
    await settle();
    expect((await settle()).committed).toBe(false);
    expect(room.matchState.players.host1.score).toBe(10);
    expect((await advanceRound('room1', 0)).committed).toBe(true);
    expect((await advanceRound('room1', 0)).committed).toBe(false);
    expect(room.matchState.roundIndex).toBe(1);
  });
  test('10/10 simultaneous lethal damage is DRAW even with unequal scores', async () => {
    seedAnswers();
    room.matchState.players.host1.hp = 10;
    room.matchState.players.guest1.hp = 10;
    room.matchState.players.host1.score = 50;
    room.matchState.players.guest1.score = 20;
    await settle();
    await finalizeMatch('room1', 'host1', 'guest1');
    expect(room.matchState.result).toMatchObject({
      winnerUid: null, loserUid: null, finalHp: { host1: 0, guest1: 0 },
      scores: { host1: 60, guest1: 30 },
    });
    expect(room.meta.status).toBe('FINISHED');
    expect(room.matchState.phase).toBe('FINISHED');
  });
  test('one KO awards the surviving player the win', async () => {
    room.matchState.phase = 'ROUND_RESULT';
    room.matchState.players.host1.hp = 0;
    room.matchState.players.guest1.hp = 20;
    await finalizeMatch('room1', 'host1', 'guest1');
    expect(room.matchState.result.winnerUid).toBe('guest1');
  });
  test('question exhaustion uses HP then score', async () => {
    room.matchState.phase = 'ROUND_RESULT';
    room.matchState.roundIndex = 9;
    room.matchState.players.host1.score = 10;
    room.matchState.players.guest1.score = 20;
    await finalizeMatch('room1', 'host1', 'guest1');
    expect(room.matchState.result.winnerUid).toBe('guest1');
  });
  test('non-KO match cannot be finalized before exhaustion', async () => {
    room.matchState.phase = 'ROUND_RESULT';
    expect((await finalizeMatch('room1', 'host1', 'guest1')).committed).toBe(false);
  });
  test('subscription returns only the unsubscribe for its own listener', () => {
    const first = jest.fn();
    const second = jest.fn();
    onValue.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const callback = jest.fn();
    const stopFirst = subscribeToMatchState('room1', callback);
    const stopSecond = subscribeToMatchState('room1', jest.fn());
    onValue.mock.calls[0][1]({ val: () => null });
    expect(callback).toHaveBeenCalledWith(null);
    stopFirst();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    stopSecond();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
