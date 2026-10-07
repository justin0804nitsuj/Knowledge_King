/**
 * Local (client-only) PvP departure intent.
 *
 * This value is NEVER written to Firebase. It only tells the local
 * WaitingRoom that the room/player disappearance it is about to observe
 * was caused by this device's own explicit action, so remote-departure
 * alerts must be suppressed.
 */
export const DepartureIntent = {
  NONE: 'NONE',
  SELF_LEAVING: 'SELF_LEAVING', // Guest explicitly leaving
  HOST_CLOSING: 'HOST_CLOSING', // Host explicitly closing the room
};

export const DepartureAlert = {
  ROOM_CLOSED: 'roomClosed',
  CHALLENGER_LEFT: 'challengerLeft',
};

/**
 * Decide which (if any) remote-departure alert to show.
 *
 * @param {object} p
 * @param {string} p.departureIntent  local intent (DepartureIntent)
 * @param {boolean} p.roomGone        room deleted / cancelled / cleared
 * @param {boolean} p.wasHost         last known role of THIS device while the room existed
 * @param {string|null} p.previousGuestUid
 * @param {string|null} p.currentGuestUid
 * @returns {string|null} DepartureAlert value or null
 */
export function resolveDepartureAlert({
  departureIntent,
  roomGone,
  wasHost,
  previousGuestUid = null,
  currentGuestUid = null,
}) {
  // Local explicit action: never alert this device about its own departure.
  if (departureIntent && departureIntent !== DepartureIntent.NONE) return null;

  if (roomGone) {
    // Only a Guest is told the Host closed the room.
    return wasHost ? null : DepartureAlert.ROOM_CLOSED;
  }

  // Room still exists: only the Host cares about the Guest disappearing.
  if (wasHost && previousGuestUid && !currentGuestUid) {
    return DepartureAlert.CHALLENGER_LEFT;
  }

  return null;
}

/**
 * Perform an explicit local departure.
 *
 * The intent is set BEFORE the destructive Firebase write so the local
 * room listener cannot win the race and show a remote-departure alert.
 * On failure the intent is reset, the active room is kept, and the error
 * is rethrown so the caller can show a localized message without navigating.
 *
 * On success the intent intentionally stays set; it is reset when the next
 * room is created or joined.
 */
export async function performExplicitDeparture({ isHost, setIntent, leave, clearActiveRoom }) {
  setIntent(isHost ? DepartureIntent.HOST_CLOSING : DepartureIntent.SELF_LEAVING);
  try {
    await leave();
  } catch (e) {
    setIntent(DepartureIntent.NONE);
    throw e;
  }
  clearActiveRoom();
}

/**
 * One room session's notification guards. Created when a room is
 * created/joined; never reset by re-renders or WaitingRoom remounts.
 */
export function createDepartureSession(roomCode = null) {
  let roomGoneHandled = false;
  let previousGuestUid = null;
  return {
    roomCode,
    /** Returns true only for the first caller in this session. */
    claimRoomGone() {
      if (roomGoneHandled) return false;
      roomGoneHandled = true;
      return true;
    },
    isRoomGoneHandled: () => roomGoneHandled,
    /** Records the current Guest and returns the transition. */
    observeGuest(currentGuestUid) {
      const prev = previousGuestUid;
      previousGuestUid = currentGuestUid || null;
      return { previousGuestUid: prev, currentGuestUid: previousGuestUid };
    },
  };
}

const noop = () => {};

/**
 * Handle "room is gone" (deleted/cancelled/cleared) exactly once per session.
 *
 * The guard is claimed synchronously BEFORE verification, alert or navigation,
 * so repeated snapshots / effect reruns cannot both pass it.
 * verify() is diagnostic only; its result is ignored if the session changed.
 *
 * @returns {string|null} alert key shown, or null
 */
export function processRoomGone({
  session,
  getCurrentSession,
  departureIntent,
  wasHost,
  showAlert,
  navigateToArena,
  verify,
  log = noop,
}) {
  if (!session || getCurrentSession() !== session) {
    log('[PVP-ALERT] roomClosed ignored (stale session)');
    return null;
  }
  if (!session.claimRoomGone()) {
    log('[PVP-ALERT] roomClosed suppressed duplicate');
    return null;
  }

  // Local explicit leave/close: the leave handler navigates, no alert.
  if (departureIntent && departureIntent !== DepartureIntent.NONE) {
    log(`[PVP-ALERT] room gone after local departure (${departureIntent}), no alert`);
    return null;
  }

  if (verify && session.roomCode) {
    const code = session.roomCode;
    log('[PVP-ALERT] verification started');
    Promise.resolve()
      .then(() => verify(code))
      .then((exists) => {
        if (getCurrentSession() !== session) {
          log('[PVP-ALERT] verification result ignored (stale session)');
          return;
        }
        log(`[PVP-ALERT] verification result exists=${exists}`);
      })
      .catch(noop);
  }

  const alertKey = resolveDepartureAlert({ departureIntent, roomGone: true, wasHost });
  if (alertKey) {
    log(`[PVP-ALERT] ${alertKey} requested`);
    showAlert(alertKey);
  }
  log('[PVP-ALERT] navigation to Arena');
  navigateToArena();
  return alertKey;
}

/**
 * Handle a live room snapshot on the Host: alert challengerLeft only on the
 * Guest present -> absent transition (repeated absent snapshots are ignored).
 */
export function processGuestSnapshot({
  session,
  getCurrentSession,
  departureIntent,
  wasHost,
  currentGuestUid,
  showAlert,
  log = noop,
}) {
  if (!session || getCurrentSession() !== session) return null;
  const transition = session.observeGuest(currentGuestUid);
  const alertKey = resolveDepartureAlert({
    departureIntent,
    roomGone: false,
    wasHost,
    previousGuestUid: transition.previousGuestUid,
    currentGuestUid: transition.currentGuestUid,
  });
  if (alertKey) {
    log(`[PVP-ALERT] ${alertKey} requested (${transition.previousGuestUid})`);
    showAlert(alertKey);
  }
  return alertKey;
}
