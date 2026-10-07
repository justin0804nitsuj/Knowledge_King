import { ref, runTransaction, get, set, update, onValue, off, remove, serverTimestamp } from 'firebase/database';
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
  if (!user || !user.uid) throw new Error("Unauthenticated user");
  if (!/^\d{5}$/.test(roomCode)) throw new Error("Invalid room code");

  const roomRef = ref(db, `rooms/${roomCode}`);
  
  try {
    // 1. Preflight check using get() to fail fast with clear error messages
    const snapshot = await get(roomRef);
    const currentData = snapshot.val();
    
    if (currentData === null) {
      throw new Error("Room not found");
    }
    
    if (currentData.meta.status !== RoomStatus.WAITING) {
      throw new Error("Room is not waiting for players");
    }
    
    const comp = getCompatibilityInfo();
    if (
      currentData.meta.rulesetVersion !== comp.rulesetVersion ||
      currentData.meta.vocabularyVersion !== comp.vocabularyVersion ||
      currentData.meta.vocabularySchemaVersion !== comp.vocabularySchemaVersion
    ) {
      throw new Error("Game versions are incompatible. Please update the app.");
    }

    // 2. Atomic transaction on the players node
    const playersRef = ref(db, `rooms/${roomCode}/players`);
    const result = await runTransaction(playersRef, (currentPlayers) => {
      if (currentPlayers === null) return; // Should not happen if room exists, but abort if so
      
      const playerIds = Object.keys(currentPlayers);
      
      // If already in room, do nothing (idempotent)
      if (currentPlayers[user.uid]) {
        return currentPlayers;
      }
      
      // Concurrency check: abort if full
      if (playerIds.length >= 2) {
        return; 
      }
      
      // Safe to join
      currentPlayers[user.uid] = {
        displayName: user.displayName || 'Player',
        photoURL: user.photoURL || null,
        role: PlayerRole.GUEST,
        joinedAt: serverTimestamp()
      };
      
      return currentPlayers;
    });

    if (result.committed) {
      const resultingPlayers = result.snapshot.val();
      if (!resultingPlayers || !resultingPlayers[user.uid]) {
        throw new Error("Room is full"); // Transaction aborted because it was full
      }
      return roomCode;
    } else {
      throw new Error("Failed to join room");
    }
  } catch (e) {
    throw e;
  }
}

/**
 * Leave a room. Handles Host (cancels room) vs Guest (just leaves)
 */
export async function leaveRoom(roomCode, user) {
  if (!roomCode || !user || !user.uid) return;
  
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
    } else {
      // Guest leaves: just remove self
      const playerRef = ref(db, `rooms/${roomCode}/players/${user.uid}`);
      await remove(playerRef);
    }
  } catch (e) {
    console.error("Leave room failed", e);
  }
}

/**
 * Realtime subscription to room state
 */
export function subscribeToRoom(roomCode, callback) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  const unsubscribe = onValue(roomRef, (snapshot) => {
    callback(snapshot.val());
  });
  return () => off(roomRef, 'value', unsubscribe);
}
