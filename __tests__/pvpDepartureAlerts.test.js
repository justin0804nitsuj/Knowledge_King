import {
  DepartureIntent,
  DepartureAlert,
  createDepartureSession,
  processRoomGone,
  processGuestSnapshot,
  performExplicitDeparture,
} from '../src/domain/pvp/departure';

/**
 * Mirrors the context (current session + intent) and the WaitingRoom effects
 * that call processRoomGone / processGuestSnapshot.
 */
function makeHarness({ roomCode = '11111', wasHost = false, verify } = {}) {
  const h = {
    session: createDepartureSession(roomCode),
    intent: DepartureIntent.NONE,
    alerts: [],
    navigations: 0,
    logs: [],
  };
  h.getSession = () => h.session;
  h.newSession = (code) => {
    h.intent = DepartureIntent.NONE;
    h.session = createDepartureSession(code);
  };
  // Equivalent of the WaitingRoom room-gone effect body for one run.
  h.roomGoneEffect = (session = h.session) =>
    processRoomGone({
      session,
      getCurrentSession: h.getSession,
      departureIntent: h.intent,
      wasHost,
      verify,
      showAlert: (k) => h.alerts.push(k),
      navigateToArena: () => { h.navigations += 1; },
      log: (m) => h.logs.push(m),
    });
  // Equivalent of the Host Guest-tracking effect body for one snapshot.
  h.guestEffect = (currentGuestUid) =>
    processGuestSnapshot({
      session: h.session,
      getCurrentSession: h.getSession,
      departureIntent: h.intent,
      wasHost: true,
      currentGuestUid,
      showAlert: (k) => h.alerts.push(k),
      log: (m) => h.logs.push(m),
    });
  return h;
}

const count = (arr, v) => arr.filter((x) => x === v).length;

describe('PvP departure alert deduplication', () => {
  it('1. one null snapshot -> roomClosed exactly once', () => {
    const h = makeHarness();
    h.roomGoneEffect();
    expect(count(h.alerts, DepartureAlert.ROOM_CLOSED)).toBe(1);
  });

  it('2. two consecutive null snapshots (CANCELLED then delete) -> roomClosed once', () => {
    const h = makeHarness();
    h.roomGoneEffect(); // CANCELLED snapshot
    h.roomGoneEffect(); // null snapshot
    expect(count(h.alerts, DepartureAlert.ROOM_CLOSED)).toBe(1);
    expect(h.logs).toContain('[PVP-ALERT] roomClosed suppressed duplicate');
  });

  it('3. two concurrent close-verification attempts -> roomClosed once, one verification', async () => {
    let resolveVerify;
    const verify = jest.fn(() => new Promise((r) => { resolveVerify = r; }));
    const h = makeHarness({ verify });
    h.roomGoneEffect();
    h.roomGoneEffect();
    await Promise.resolve();
    await Promise.resolve();
    expect(verify).toHaveBeenCalledTimes(1);
    resolveVerify(false);
    await new Promise((r) => setImmediate(r));
    expect(count(h.alerts, DepartureAlert.ROOM_CLOSED)).toBe(1);
  });

  it('4. repeated effect execution -> roomClosed once', () => {
    const h = makeHarness();
    for (let i = 0; i < 5; i++) h.roomGoneEffect();
    expect(h.alerts).toEqual([DepartureAlert.ROOM_CLOSED]);
  });

  it('5. remote Host close -> navigation to Arena exactly once', () => {
    const h = makeHarness();
    h.roomGoneEffect();
    h.roomGoneEffect();
    h.roomGoneEffect();
    expect(h.navigations).toBe(1);
  });

  it('6. local Host close -> Host sees no roomClosed', async () => {
    const h = makeHarness({ wasHost: true });
    let cleared = false;
    await performExplicitDeparture({
      isHost: true,
      setIntent: (i) => { h.intent = i; },
      leave: async () => { h.roomGoneEffect(); }, // listener fires mid-write
      clearActiveRoom: () => { cleared = true; },
    });
    h.roomGoneEffect(); // room cleared locally
    expect(cleared).toBe(true);
    expect(h.alerts).toEqual([]);
    expect(h.navigations).toBe(0); // confirmLeave navigates, not the effect
  });

  it('7. Guest explicit leave -> Guest sees no roomClosed', async () => {
    const h = makeHarness({ wasHost: false });
    await performExplicitDeparture({
      isHost: false,
      setIntent: (i) => { h.intent = i; },
      leave: async () => {},
      clearActiveRoom: () => {},
    });
    h.roomGoneEffect();
    h.roomGoneEffect();
    expect(h.alerts).toEqual([]);
  });

  it('8. Guest disappearance -> Host challengerLeft exactly once', () => {
    const h = makeHarness({ wasHost: true });
    h.guestEffect(null);
    h.guestEffect('guestA');
    h.guestEffect(null);
    expect(h.alerts).toEqual([DepartureAlert.CHALLENGER_LEFT]);
  });

  it('9. repeated Guest-absent snapshots -> challengerLeft not duplicated', () => {
    const h = makeHarness({ wasHost: true });
    h.guestEffect('guestA');
    h.guestEffect(null);
    h.guestEffect(null);
    h.guestEffect(null);
    expect(count(h.alerts, DepartureAlert.CHALLENGER_LEFT)).toBe(1);
  });

  it('10. new room session -> notification guards reset', () => {
    const h = makeHarness({ roomCode: '11111' });
    h.roomGoneEffect();
    h.roomGoneEffect();
    expect(h.alerts).toHaveLength(1);
    h.newSession('22222');
    expect(h.session.isRoomGoneHandled()).toBe(false);
    h.roomGoneEffect();
    expect(h.alerts).toHaveLength(2);
    expect(h.navigations).toBe(2);
  });

  it('11. stale async verification from old room cannot affect new room', async () => {
    let resolveVerify;
    const verify = jest.fn(() => new Promise((r) => { resolveVerify = r; }));
    const h = makeHarness({ roomCode: '11111', verify });
    const oldSession = h.session;
    h.roomGoneEffect();
    await Promise.resolve();
    h.newSession('22222');
    const alertsBefore = h.alerts.length;
    const navBefore = h.navigations;
    resolveVerify(false);
    await new Promise((r) => setImmediate(r));
    expect(h.alerts.length).toBe(alertsBefore);
    expect(h.navigations).toBe(navBefore);
    expect(h.logs).toContain('[PVP-ALERT] verification result ignored (stale session)');
    // A late effect run bound to the old session is also ignored.
    h.roomGoneEffect(oldSession);
    expect(h.alerts.length).toBe(alertsBefore);
    expect(h.session.isRoomGoneHandled()).toBe(false);
  });

  describe('Physical QA scenarios C, D, E (two-player departure and alert behavior)', () => {
    it('C. FINISHED: Challenger leaves second -> room deleted -> Challenger gets NO "Host closed room" alert', async () => {
      const challenger = makeHarness({ wasHost: false });
      // Host has already departed remotely. Now Challenger explicitly leaves:
      await performExplicitDeparture({
        isHost: false,
        setIntent: (i) => { challenger.intent = i; },
        leave: async () => {
          // Destructive write deletes room in Firebase; listener triggers roomGone effect mid-write
          challenger.roomGoneEffect();
        },
        clearActiveRoom: () => {},
      });
      // Any trailing roomGone snapshots also ignored
      challenger.roomGoneEffect();
      expect(challenger.alerts).toEqual([]);
    });

    it('D. Reverse order: Host leaves second -> room deleted -> Host gets NO false room-closed alert', async () => {
      const host = makeHarness({ wasHost: true });
      // Challenger has already departed. Now Host explicitly leaves:
      await performExplicitDeparture({
        isHost: true,
        setIntent: (i) => { host.intent = i; },
        leave: async () => {
          // Destructive write deletes room in Firebase; listener triggers roomGone effect mid-write
          host.roomGoneEffect();
        },
        clearActiveRoom: () => {},
      });
      host.roomGoneEffect();
      expect(host.alerts).toEqual([]);
    });

    it('E. Genuine unexpected room removal: remaining player NOT explicitly leaving -> room-closed alert appears', () => {
      const remainingChallenger = makeHarness({ wasHost: false });
      // Challenger did NOT tap leave; intent is NONE
      remainingChallenger.roomGoneEffect();
      expect(remainingChallenger.alerts).toEqual([DepartureAlert.ROOM_CLOSED]);
    });
  });
});
