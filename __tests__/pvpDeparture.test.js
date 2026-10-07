import {
  DepartureIntent,
  DepartureAlert,
  resolveDepartureAlert,
  performExplicitDeparture,
} from '../src/domain/pvp/departure';

/**
 * Simulates the local context's explicit departure: intent ref + active room,
 * then evaluates what the local WaitingRoom would alert once the room is cleared.
 */
function makeLocalSession({ isHost, leaveImpl }) {
  const session = {
    intent: DepartureIntent.NONE,
    activeRoom: '12345',
    intentDuringLeave: null,
  };
  const run = () =>
    performExplicitDeparture({
      isHost,
      setIntent: (i) => { session.intent = i; },
      leave: async () => {
        // Capture intent at the moment of the destructive Firebase write.
        session.intentDuringLeave = session.intent;
        return leaveImpl();
      },
      clearActiveRoom: () => { session.activeRoom = null; },
    });
  return { session, run };
}

describe('PvP local vs remote departure', () => {
  it('1. Guest explicit leave: local Guest gets no roomClosed alert', async () => {
    const { session, run } = makeLocalSession({ isHost: false, leaveImpl: async () => {} });
    await run();
    expect(session.intentDuringLeave).toBe(DepartureIntent.SELF_LEAVING);
    expect(session.activeRoom).toBeNull();
    // Guest's own node removed, then local room cleared: neither may alert.
    expect(resolveDepartureAlert({
      departureIntent: session.intent, roomGone: false, wasHost: false,
      previousGuestUid: 'guest', currentGuestUid: null,
    })).toBeNull();
    expect(resolveDepartureAlert({
      departureIntent: session.intent, roomGone: true, wasHost: false,
    })).toBeNull();
  });

  it('2. Guest explicit leave: remote Host gets challengerLeft', () => {
    // Host device has no local intent; room still exists, Guest node removed.
    expect(resolveDepartureAlert({
      departureIntent: DepartureIntent.NONE, roomGone: false, wasHost: true,
      previousGuestUid: 'guest', currentGuestUid: null,
    })).toBe(DepartureAlert.CHALLENGER_LEFT);
  });

  it('3. Host explicit close: local Host gets no roomClosed alert', async () => {
    const { session, run } = makeLocalSession({ isHost: true, leaveImpl: async () => {} });
    await run();
    expect(session.intentDuringLeave).toBe(DepartureIntent.HOST_CLOSING);
    expect(session.activeRoom).toBeNull();
    // Even if last-known role were lost (isHost derived from cleared room), no alert.
    expect(resolveDepartureAlert({
      departureIntent: session.intent, roomGone: true, wasHost: false,
    })).toBeNull();
    expect(resolveDepartureAlert({
      departureIntent: session.intent, roomGone: true, wasHost: true,
    })).toBeNull();
  });

  it('4. Host explicit close: remote Guest gets roomClosed', () => {
    expect(resolveDepartureAlert({
      departureIntent: DepartureIntent.NONE, roomGone: true, wasHost: false,
    })).toBe(DepartureAlert.ROOM_CLOSED);
  });

  it('5. failed Guest leave: departure intent resets', async () => {
    const err = Object.assign(new Error('PERMISSION_DENIED'), { code: 'PERMISSION_DENIED' });
    const { session, run } = makeLocalSession({ isHost: false, leaveImpl: async () => { throw err; } });
    await expect(run()).rejects.toBe(err);
    expect(session.intentDuringLeave).toBe(DepartureIntent.SELF_LEAVING);
    expect(session.intent).toBe(DepartureIntent.NONE);
  });

  it('6. failed Host close: departure intent resets', async () => {
    const { session, run } = makeLocalSession({
      isHost: true, leaveImpl: async () => { throw new Error('network'); },
    });
    await expect(run()).rejects.toThrow('network');
    expect(session.intentDuringLeave).toBe(DepartureIntent.HOST_CLOSING);
    expect(session.intent).toBe(DepartureIntent.NONE);
  });

  it('7. active room remains if leave fails', async () => {
    const { session, run } = makeLocalSession({
      isHost: false, leaveImpl: async () => { throw new Error('fail'); },
    });
    await expect(run()).rejects.toThrow();
    expect(session.activeRoom).toBe('12345');
  });

  it('8. Guest disconnect without local intent: Host still gets challengerLeft', () => {
    expect(resolveDepartureAlert({
      departureIntent: DepartureIntent.NONE, roomGone: false, wasHost: true,
      previousGuestUid: 'guest', currentGuestUid: null,
    })).toBe(DepartureAlert.CHALLENGER_LEFT);
  });

  it('9. Host disconnect without local intent: Guest still gets roomClosed', () => {
    expect(resolveDepartureAlert({
      departureIntent: DepartureIntent.NONE, roomGone: true, wasHost: false,
    })).toBe(DepartureAlert.ROOM_CLOSED);
  });
});
