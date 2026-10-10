import {
  calculateSpeedOutcome,
  calculateRoundDamage,
  resolveRound,
  useBattleItem,
  submitAnswer,
  finalizeMatch,
} from '../src/services/pvp/pvpBattleService';
import { ref, runTransaction } from 'firebase/database';
import { createPvpQuestions } from '../src/domain/pvp/pvpQuestions';

jest.mock('firebase/database', () => ({
  ref: jest.fn((db, path) => path),
  runTransaction: jest.fn(),
  onValue: jest.fn(),
  serverTimestamp: jest.fn(() => 123456789),
}));
jest.mock('../src/services/firebase/firebaseDatabase', () => ({ db: {} }));

describe('Phase 11B: Speed-Priority Damage Matrix & Items', () => {
  describe('Pure calculateRoundDamage unit tests', () => {
    // Section 10 Deterministic Cases
    it('Case A: Both correct, Host faster by 420ms -> Host 20, Guest 0', () => {
      const speed = calculateSpeedOutcome(1000, 1420, true, true);
      expect(speed.speedOutcome).toBe('HOST_FASTER');
      expect(speed.speedDiffMs).toBe(420);

      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: speed.speedOutcome,
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });

      expect(dmg.hostBaseDamage).toBe(20);
      expect(dmg.guestBaseDamage).toBe(0);
      expect(dmg.rawHostOutgoingDamage).toBe(20);
      expect(dmg.rawGuestOutgoingDamage).toBe(0);
      expect(dmg.damageToGuest).toBe(20);
      expect(dmg.damageToHost).toBe(0);
    });

    it('Case B: Both correct, Guest faster by 180ms -> Host 0, Guest 20', () => {
      const speed = calculateSpeedOutcome(1180, 1000, true, true);
      expect(speed.speedOutcome).toBe('GUEST_FASTER');
      expect(speed.speedDiffMs).toBe(180);

      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: speed.speedOutcome,
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });

      expect(dmg.hostBaseDamage).toBe(0);
      expect(dmg.guestBaseDamage).toBe(20);
      expect(dmg.rawHostOutgoingDamage).toBe(0);
      expect(dmg.rawGuestOutgoingDamage).toBe(20);
      expect(dmg.damageToGuest).toBe(0);
      expect(dmg.damageToHost).toBe(20);
    });

    it('Case C: Both correct, difference <= 150ms (TIE) -> Host 10, Guest 10', () => {
      const speed = calculateSpeedOutcome(1000, 1120, true, true);
      expect(speed.speedOutcome).toBe('TIE');
      expect(speed.speedDiffMs).toBe(120);

      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: speed.speedOutcome,
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });

      expect(dmg.hostBaseDamage).toBe(10);
      expect(dmg.guestBaseDamage).toBe(10);
      expect(dmg.rawHostOutgoingDamage).toBe(10);
      expect(dmg.rawGuestOutgoingDamage).toBe(10);
      expect(dmg.damageToGuest).toBe(10);
      expect(dmg.damageToHost).toBe(10);
    });

    it('Case D: Host correct, Guest wrong -> Host 20, Guest 0 (speed irrelevant)', () => {
      const speed = calculateSpeedOutcome(2000, 1000, true, false);
      expect(speed.speedOutcome).toBe('NONE');

      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: false,
        speedOutcome: speed.speedOutcome,
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });

      expect(dmg.hostBaseDamage).toBe(20);
      expect(dmg.guestBaseDamage).toBe(0);
      expect(dmg.damageToGuest).toBe(20);
      expect(dmg.damageToHost).toBe(0);
    });

    it('Case E: Host wrong, Guest correct -> Host 0, Guest 20 (speed irrelevant)', () => {
      const speed = calculateSpeedOutcome(1000, 2000, false, true);
      expect(speed.speedOutcome).toBe('NONE');

      const dmg = calculateRoundDamage({
        hostCorrect: false,
        guestCorrect: true,
        speedOutcome: speed.speedOutcome,
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });

      expect(dmg.hostBaseDamage).toBe(0);
      expect(dmg.guestBaseDamage).toBe(20);
      expect(dmg.damageToGuest).toBe(0);
      expect(dmg.damageToHost).toBe(20);
    });

    it('Case F: Both wrong -> 0 / 0', () => {
      const speed = calculateSpeedOutcome(1000, 2000, false, false);
      expect(speed.speedOutcome).toBe('NONE');

      const dmg = calculateRoundDamage({
        hostCorrect: false,
        guestCorrect: false,
        speedOutcome: speed.speedOutcome,
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });

      expect(dmg.hostBaseDamage).toBe(0);
      expect(dmg.guestBaseDamage).toBe(0);
      expect(dmg.damageToGuest).toBe(0);
      expect(dmg.damageToHost).toBe(0);
    });

    // Section 11 Item Combination Tests
    it('1. Faster Host + no items -> 20 / 0', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'HOST_FASTER',
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.damageToGuest).toBe(20);
      expect(dmg.damageToHost).toBe(0);
    });

    it('2. Faster Host + Host POWER -> 30 / 0', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'HOST_FASTER',
        hostPowerActive: true,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.hostBaseDamage).toBe(20);
      expect(dmg.hostPowerBonus).toBe(10);
      expect(dmg.rawHostOutgoingDamage).toBe(30);
      expect(dmg.damageToGuest).toBe(30);
      expect(dmg.damageToHost).toBe(0);
    });

    it('3. Faster Host + Guest SHIELD -> damage to Guest = 0', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'HOST_FASTER',
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: true,
      });
      expect(dmg.rawHostOutgoingDamage).toBe(20);
      expect(dmg.guestShieldBlocked).toBe(20);
      expect(dmg.damageToGuest).toBe(0);
      expect(dmg.damageToHost).toBe(0);
    });

    it('4. Faster Host + Host POWER + Guest SHIELD -> 30 - 20 = 10', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'HOST_FASTER',
        hostPowerActive: true,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: true,
      });
      expect(dmg.rawHostOutgoingDamage).toBe(30);
      expect(dmg.guestShieldBlocked).toBe(20);
      expect(dmg.damageToGuest).toBe(10);
      expect(dmg.damageToHost).toBe(0);
    });

    it('5. Slower Host + Host POWER -> Host outgoing remains 0 (no bonus without base damage)', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'GUEST_FASTER',
        hostPowerActive: true,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.hostBaseDamage).toBe(0);
      expect(dmg.hostPowerBonus).toBe(0); // Power gives 0 bonus when base is 0
      expect(dmg.rawHostOutgoingDamage).toBe(0);
      expect(dmg.damageToGuest).toBe(0);
      expect(dmg.damageToHost).toBe(20);
    });

    it('6. Near tie -> 10 / 10', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'TIE',
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.hostBaseDamage).toBe(10);
      expect(dmg.guestBaseDamage).toBe(10);
      expect(dmg.damageToGuest).toBe(10);
      expect(dmg.damageToHost).toBe(10);
    });

    it('7. Near tie + Host POWER -> Host 20 / Guest 10 before Shields', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'TIE',
        hostPowerActive: true,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.hostBaseDamage).toBe(10);
      expect(dmg.hostPowerBonus).toBe(10);
      expect(dmg.rawHostOutgoingDamage).toBe(20);
      expect(dmg.guestBaseDamage).toBe(10);
      expect(dmg.guestPowerBonus).toBe(0);
      expect(dmg.rawGuestOutgoingDamage).toBe(10);
      expect(dmg.damageToGuest).toBe(20);
      expect(dmg.damageToHost).toBe(10);
    });

    it('8. Near tie + both POWER -> 20 / 20', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'TIE',
        hostPowerActive: true,
        guestPowerActive: true,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.hostBaseDamage).toBe(10);
      expect(dmg.guestBaseDamage).toBe(10);
      expect(dmg.hostPowerBonus).toBe(10);
      expect(dmg.guestPowerBonus).toBe(10);
      expect(dmg.rawHostOutgoingDamage).toBe(20);
      expect(dmg.rawGuestOutgoingDamage).toBe(20);
      expect(dmg.damageToGuest).toBe(20);
      expect(dmg.damageToHost).toBe(20);
    });

    it('9. Near tie + Shield -> Shield fully blocks 10 incoming damage', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: true,
        speedOutcome: 'TIE',
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: true,
        guestShieldActive: false,
      });
      expect(dmg.rawGuestOutgoingDamage).toBe(10);
      expect(dmg.hostShieldBlocked).toBe(10); // Blocked up to incoming 10
      expect(dmg.damageToHost).toBe(0);
      expect(dmg.damageToGuest).toBe(10);
    });

    it('10. One correct / one wrong + Power -> correct player gets 20 + 10 = 30', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: false,
        speedOutcome: 'NONE',
        hostPowerActive: true,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.hostBaseDamage).toBe(20);
      expect(dmg.hostPowerBonus).toBe(10);
      expect(dmg.damageToGuest).toBe(30);
      expect(dmg.damageToHost).toBe(0);
    });

    it('11. Both wrong + Power -> still 0 / 0', () => {
      const dmg = calculateRoundDamage({
        hostCorrect: false,
        guestCorrect: false,
        speedOutcome: 'NONE',
        hostPowerActive: true,
        guestPowerActive: true,
        hostShieldActive: false,
        guestShieldActive: false,
      });
      expect(dmg.hostBaseDamage).toBe(0);
      expect(dmg.guestBaseDamage).toBe(0);
      expect(dmg.hostPowerBonus).toBe(0);
      expect(dmg.guestPowerBonus).toBe(0);
      expect(dmg.damageToGuest).toBe(0);
      expect(dmg.damageToHost).toBe(0);
    });
  });

  describe('Full round resolution integration tests', () => {
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
        roundIndex: 0, phase: 'ANSWERING',
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

    const seedAnswers = (hostChoice, guestChoice, hostTime, guestTime) => {
      room.matchState.rounds[0] = {
        answers: {
          host1: { selectedChoiceId: hostChoice, submittedAt: hostTime },
          guest1: { selectedChoiceId: guestChoice, submittedAt: guestTime },
        },
      };
    };

    it('Faster Host deals 20 damage, slower Guest deals 0 damage', async () => {
      seedAnswers(correctChoice, correctChoice, 1000, 1500); // Host faster by 500ms
      await resolveRound('room1', 'host1', 'guest1', 0);

      const res = room.matchState.rounds[0].resolution;
      expect(res.speedOutcome).toBe('HOST_FASTER');
      expect(res.speedDiffMs).toBe(500);
      expect(res.hostBaseDamage).toBe(20);
      expect(res.guestBaseDamage).toBe(0);
      expect(res.damageToGuest).toBe(20);
      expect(res.damageToHost).toBe(0);
      expect(room.matchState.players.host1.hp).toBe(100);
      expect(room.matchState.players.guest1.hp).toBe(80);
    });

    it('Slower Host using POWER still deals 0 damage, but item is consumed', async () => {
      room.matchState.players.host1.items.POWER.remaining = 0;
      room.matchState.players.host1.itemUses[0] = { itemId: 'POWER', actionId: 'act1', usedAt: 500 };

      seedAnswers(correctChoice, correctChoice, 1600, 1000); // Guest faster by 600ms
      await resolveRound('room1', 'host1', 'guest1', 0);

      const res = room.matchState.rounds[0].resolution;
      expect(res.speedOutcome).toBe('GUEST_FASTER');
      expect(res.hostBaseDamage).toBe(0);
      expect(res.hostPowerBonus).toBe(0);
      expect(res.damageToGuest).toBe(0);
      expect(res.damageToHost).toBe(20);
      expect(room.matchState.players.host1.hp).toBe(80);
      expect(room.matchState.players.guest1.hp).toBe(100);
      expect(room.matchState.players.host1.items.POWER.remaining).toBe(0);
    });

    it('HEAL regression: heals 25 HP up to MAX_HP 100 before round settlement', async () => {
      room.matchState.players.host1.hp = 60;
      await useBattleItem({
        roomCode: 'room1',
        uid: 'host1',
        roundIndex: 0,
        itemId: 'HEAL',
        actionId: 'heal-act',
      });
      expect(room.matchState.players.host1.hp).toBe(85);
      expect(room.matchState.players.host1.items.HEAL.remaining).toBe(1);

      // Now resolve a round where host is faster
      seedAnswers(correctChoice, correctChoice, 1000, 1300);
      await resolveRound('room1', 'host1', 'guest1', 0);

      expect(room.matchState.players.host1.hp).toBe(85); // took 0 damage
      expect(room.matchState.players.guest1.hp).toBe(80); // took 20 damage
    });

    it('HP floor: damage cannot drop HP below 0', async () => {
      room.matchState.players.guest1.hp = 10;
      seedAnswers(correctChoice, correctChoice, 1000, 1500); // Host faster -> 20 damage
      await resolveRound('room1', 'host1', 'guest1', 0);

      expect(room.matchState.players.guest1.hp).toBe(0);
    });

    it('Simultaneous lethal DRAW semantics preserved in near-tie (10/10 damage)', async () => {
      room.matchState.players.host1.hp = 10;
      room.matchState.players.guest1.hp = 10;
      room.matchState.players.host1.score = 30;
      room.matchState.players.guest1.score = 10;

      seedAnswers(correctChoice, correctChoice, 1000, 1050); // 50ms diff -> TIE
      await resolveRound('room1', 'host1', 'guest1', 0);

      expect(room.matchState.rounds[0].resolution.speedOutcome).toBe('TIE');
      expect(room.matchState.players.host1.hp).toBe(0);
      expect(room.matchState.players.guest1.hp).toBe(0);

      await finalizeMatch('room1', 'host1', 'guest1');
      expect(room.matchState.result).toMatchObject({
        winnerUid: null,
        loserUid: null,
        finalHp: { host1: 0, guest1: 0 },
      });
      expect(room.meta.status).toBe('FINISHED');
      expect(room.matchState.phase).toBe('FINISHED');
    });
  });
});
