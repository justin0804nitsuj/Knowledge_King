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
