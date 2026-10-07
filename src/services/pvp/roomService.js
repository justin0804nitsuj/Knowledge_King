import { ref, runTransaction, get, set, update, onValue, off, remove, serverTimestamp, onDisconnect } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { RoomStatus, PlayerRole } from '../../domain/pvp/roomConstants';
import { getCompatibilityInfo } from '../../domain/game/pvpCompatibility';

function generateRoomCode() {
  return Math.floor(10000 + Math.random() * 90000).toString();
}

/**
 * Atomically create a new room. Retries up to 10 times to avoid collision.
 */
export async function createRoom(user) {
  if (!user || !user.uid) {
    const err = new Error("Unauthenticated user");
    err.code = 'AUTH_REQUIRED';
    throw err;
  }

  const maxRetries = 10;
  
  for (let i = 0; i < maxRetries; i++) {
    const code = generateRoomCode();
    const roomRef = ref(db, `rooms/${code}`);
    
    try {
      const result = await runTransaction(roomRef, (currentData) => {
        if (currentData === null) {
          // Safe to create
          const compatibility = getCompatibilityInfo();
          return {
            meta: {
              hostUid: user.uid,
              status: RoomStatus.WAITING,
              createdAt: serverTimestamp(),
              rulesetVersion: compatibility.rulesetVersion,
              vocabularyVersion: compatibility.vocabularyVersion,
              vocabularySchemaVersion: compatibility.vocabularySchemaVersion,
            },
            players: {
              [user.uid]: {
                displayName: user.displayName || 'Player',
                photoURL: user.photoURL || null,
                role: PlayerRole.HOST,
                ready: false,
                joinedAt: serverTimestamp()
              }
            }
          };
        } else {
          // Room code in use, abort transaction
          return;
        }
      });
      
      if (result.committed) {
        return code;
      }
      // If we reach here, result.committed is false, meaning it was a collision.
      console.warn(`[PvP] create room attempt ${i + 1} code=${code} - collision`);
    } catch (e) {
      console.error(`[PvP] create room attempt ${i + 1} code=${code} - Firebase error:`, e.code || e.message);
      // Do NOT retry on permission denied, network errors, etc.
      throw e;
    }
  }
  
  const exhaustedError = new Error("Unable to generate a unique room code. Please try again.");
  exhaustedError.code = 'ROOM_CODE_EXHAUSTED';
  throw exhaustedError;
}

/**
 * Join an existing WAITING room.
 */
export async function joinRoom(roomCode, user) {
  if (!user || !user.uid) {
    const e = new Error("Unauthenticated user");
    e.code = 'AUTH_REQUIRED';
    throw e;
  }
  if (!/^\d{5}$/.test(roomCode)) {
    const e = new Error("Room not found");
    e.code = 'ROOM_NOT_FOUND';
    throw e;
  }

  const roomRef = ref(db, `rooms/${roomCode}`);
  
  try {
    // 1. Preflight check using get() to fail fast with clear error messages
    const snapshot = await get(roomRef);
    const currentData = snapshot.val();
    
    if (currentData === null) {
      const e = new Error("Room not found");
      e.code = 'ROOM_NOT_FOUND';
      throw e;
    }
    
    if (currentData.meta.status !== RoomStatus.WAITING) {
      const e = new Error("Room is not waiting for players");
      e.code = 'ROOM_NOT_JOINABLE';
      throw e;
    }
    
    if (currentData.meta.hostUid === user.uid) {
      const e = new Error("Cannot join your own room");
      e.code = 'SELF_JOIN';
      throw e;
    }
    
    const comp = getCompatibilityInfo();
    if (
      currentData.meta.rulesetVersion !== comp.rulesetVersion ||
      currentData.meta.vocabularyVersion !== comp.vocabularyVersion ||
      currentData.meta.vocabularySchemaVersion !== comp.vocabularySchemaVersion
    ) {
      const e = new Error("Game versions are incompatible. Please update the app.");
      e.code = 'INCOMPATIBLE';
      throw e;
    }

    let abortReason = null;

    // 2. Atomic transaction on the players node
    const playersRef = ref(db, `rooms/${roomCode}/players`);
    const result = await runTransaction(playersRef, (currentPlayers) => {
      // Seed with fetched data if local cache is empty.
      // The transaction will still hash-mismatch on the server and retry with absolute truth.
      if (currentPlayers === null) {
        currentPlayers = { ...currentData.players };
      }
      
      const playerIds = Object.keys(currentPlayers);
      
      // If already in room, do nothing (idempotent)
      if (currentPlayers[user.uid]) {
        return currentPlayers;
      }
      
      // Concurrency check: abort if full
      if (playerIds.length >= 2) {
        abortReason = 'ROOM_FULL';
        return; 
      }
      
      // Safe to join
      currentPlayers[user.uid] = {
        displayName: user.displayName || 'Player',
        photoURL: user.photoURL || null,
        role: PlayerRole.GUEST,
        ready: false,
        joinedAt: serverTimestamp()
      };
      
      return currentPlayers;
    });

    if (result.committed) {
      return roomCode;
    } else {
      if (abortReason === 'ROOM_FULL') {
        const e = new Error("Room is full");
        e.code = 'ROOM_FULL';
        throw e;
      }
      const e = new Error("Failed to join room");
      e.code = 'DATABASE_ERROR';
      throw e;
    }
  } catch (e) {
    console.error(`[PvP] join room code=${roomCode} - Firebase error:`, e.code || e.message);
    throw e;
  }
}

/**
 * Leave a room. Handles Host (cancels room) vs Guest (just leaves)
 */
export async function leaveRoom(roomCode, user) {
  if (!roomCode || !user || !user.uid) return;
  
  console.log('[PVP-TRACE] leaveRoom called');
  const roomRef = ref(db, `rooms/${roomCode}`);
  
  try {
    const snap = await get(roomRef);
    const roomData = snap.val();
    
    if (!roomData || !roomData.players || !roomData.players[user.uid]) {
      return; // Not in this room
    }
    
    if (roomData.meta.hostUid === user.uid) {
      // Host leaves: cancel and remove room
      await set(ref(db, `rooms/${roomCode}/meta/status`), RoomStatus.CANCELLED);
      await remove(roomRef);
      console.log('[PVP-TRACE] REMOVE room called');
    } else {
      // Guest leaves: just remove self
      const playerRef = ref(db, `rooms/${roomCode}/players/${user.uid}`);
      await remove(playerRef);
      console.log('[PVP-TRACE] REMOVE player called');
    }
  } catch (e) {
    if (__DEV__) console.error("Leave room failed", e);
    throw e;
  }
}

/**
 * Set the ready state for the current player
 */
export async function setPlayerReady(roomCode, user, isReady) {
  if (!roomCode || !user || !user.uid) {
    const e = new Error("Unauthenticated user");
    e.code = 'AUTH_REQUIRED';
    throw e;
  }
  const playerReadyRef = ref(db, `rooms/${roomCode}/players/${user.uid}/ready`);
  try {
    console.log(`[PVP-PERM] setPlayerReady begin path=rooms/${roomCode}/players/${user.uid}/ready`);
    await set(playerReadyRef, isReady);
    console.log(`[PVP-PERM] setPlayerReady success`);
  } catch (e) {
    console.log(`[PVP-PERM] setPlayerReady error code=${e.code} message=${e.message}`);
    throw e;
  }
}

/**
 * Atomically start the match if all conditions are met
 */
export async function startMatch(roomCode, user) {
  if (!roomCode || !user || !user.uid) {
    const e = new Error("Unauthenticated user");
    e.code = 'AUTH_REQUIRED';
    throw e;
  }

  const roomRef = ref(db, `rooms/${roomCode}`);
  console.log(`[PVP-PERM] startMatch begin transaction path=rooms/${roomCode}`);
  let result;
  try {
    result = await runTransaction(roomRef, (currentData) => {
      if (currentData === null) return; // aborted
    
    // Check authority
    if (currentData.meta.hostUid !== user.uid) {
      return; // aborted, not host
    }

    // Already started? Be idempotent.
    if (currentData.meta.status === RoomStatus.IN_BATTLE) {
      return currentData; 
    }

    if (currentData.meta.status !== RoomStatus.WAITING) {
      return currentData; // Cannot start if cancelled/finished
    }

    const hostUid = currentData.meta.hostUid;
    const playerUids = Object.keys(currentData.players || {});
    const guestUid = playerUids.find(id => id !== hostUid);

    if (!guestUid) return; // no guest

    // Treat missing ready as false
    const hostReady = currentData.players[hostUid]?.ready === true;
    const guestReady = currentData.players[guestUid]?.ready === true;

    if (!hostReady || !guestReady) return; // not both ready

    // Create match config
    if (!currentData.match) {
      const matchId = `match_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const battleSeed = Math.floor(Math.random() * 1000000).toString();
      
      currentData.match = {
        matchId,
        battleSeed,
        rulesetVersion: currentData.meta.rulesetVersion,
        vocabularyVersion: currentData.meta.vocabularyVersion,
        createdAt: serverTimestamp(),
        questionCount: 10,
        level: 1
      };
    }
    
    currentData.meta.status = RoomStatus.IN_BATTLE;
    return currentData;
  }, { applyLocally: false });

  if (!result.committed) {
    const e = new Error("Failed to start match");
    e.code = 'START_FAILED';
    throw e;
  }
  
  console.log(`[PVP-PERM] startMatch success`);
  } catch (e) {
    console.log(`[PVP-PERM] startMatch error code=${e.code} message=${e.message}`);
    throw e;
  }
}

/**
 * Realtime subscription to room state
 */
export function subscribeToRoom(roomCode, callback) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  // onValue returns its own unsubscribe. (Previously off() was called with
  // that unsubscribe function as the callback, which matched no listener,
  // so room listeners were never detached.)
  const unsubscribe = onValue(roomRef, (snapshot) => {
    callback(snapshot.val());
  });
  return () => {
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}

/**
 * Diagnostic method to verify room exists without caching
 */
export async function verifyRoomExists(roomCode) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  const snap = await get(roomRef);
  return snap.exists();
}

/**
 * Configure WAITING room onDisconnect behavior.
 * Host disconnects: entire room is removed.
 * Guest disconnects: only Guest player node is removed.
 */
export function setupWaitingRoomPresence(roomCode, user, isHost) {
  if (!roomCode || !user || !user.uid) return () => {};
  
  let targetRef;
  if (isHost) {
    targetRef = ref(db, `rooms/${roomCode}`);
  } else {
    targetRef = ref(db, `rooms/${roomCode}/players/${user.uid}`);
  }
  
  const onDisconnectRef = onDisconnect(targetRef);
  onDisconnectRef.remove();
  console.log(`[PVP-TRACE] onDisconnect registered (isHost=${isHost})`);
  
  return () => {
    onDisconnectRef.cancel();
    console.log(`[PVP-TRACE] onDisconnect cancelled (isHost=${isHost})`);
  };
}
