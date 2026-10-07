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
  if (!user || !user.uid) throw new Error("Unauthenticated user");

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
    } catch (e) {
      console.warn("Room creation transaction failed", e);
    }
  }
  
  throw new Error("Unable to generate a unique room code. Please try again.");
}

/**
 * Join an existing WAITING room.
 */
export async function joinRoom(roomCode, user) {
  if (!user || !user.uid) throw new Error("Unauthenticated user");
  if (!/^\d{5}$/.test(roomCode)) throw new Error("Invalid room code");

  const roomRef = ref(db, `rooms/${roomCode}`);
  
  try {
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
    
    // If the user is already in the room, let them re-join seamlessly
    if (currentData.players && currentData.players[user.uid]) {
      return roomCode;
    }
    
    const players = currentData.players || {};
    const playerIds = Object.keys(players);
    
    if (playerIds.length >= 2) {
      throw new Error("Room is full");
    }
    
    // Safe to join: atomic set on our own node
    const playerRef = ref(db, `rooms/${roomCode}/players/${user.uid}`);
    await set(playerRef, {
      displayName: user.displayName || 'Player',
      photoURL: user.photoURL || null,
      role: PlayerRole.GUEST,
      joinedAt: serverTimestamp()
    });
    
    return roomCode;
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
