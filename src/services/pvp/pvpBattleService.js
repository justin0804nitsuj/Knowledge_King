import { ref, runTransaction, update, onValue, off, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { RoomStatus } from '../../domain/pvp/roomConstants';

/**
 * Idempotent answer submission for PvP matches.
 * Uses a transaction to ensure we only process each questionIndex once per player.
 */
export async function submitAnswer(roomCode, uid, matchId, questionIndex, isCorrect, points, isLastQuestion) {
  const playerStateRef = ref(db, `rooms/${roomCode}/matchState/players/${uid}`);
  
  return runTransaction(playerStateRef, (currentState) => {
    // Initialize if it doesn't exist
    if (!currentState) {
      currentState = {
        currentQuestionIndex: 0,
        score: 0,
        correct: 0,
        wrong: 0,
        completed: false
      };
    }

    // Idempotency: if the state index is already beyond this question, ignore it
    if (currentState.currentQuestionIndex > questionIndex) {
      return; // Abort transaction without making changes (already processed)
    }

    // Apply the answer
    if (isCorrect) {
      currentState.score += points;
      currentState.correct += 1;
    } else {
      currentState.wrong += 1;
    }

    // Advance progression
    currentState.currentQuestionIndex = questionIndex + 1;

    // Check completion
    if (isLastQuestion) {
      currentState.completed = true;
      currentState.finishedAt = serverTimestamp();
    }

    return currentState;
  }, { applyLocally: false });
}

/**
 * Host finalization transaction.
 * Requires both players to be completed.
 */
export async function finalizeMatch(roomCode, hostUid, guestUid) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  
  return runTransaction(roomRef, (roomData) => {
    if (!roomData) return;
    
    // Validate we are currently in battle and have both players
    if (roomData.meta?.status !== RoomStatus.IN_BATTLE) {
      return; // Abort if already finished or cancelled
    }
    
    const hostState = roomData.matchState?.players?.[hostUid];
    const guestState = roomData.matchState?.players?.[guestUid];
    
    if (!hostState?.completed || !guestState?.completed) {
      return; // Both must be completed
    }
    
    // Determine winner
    let winnerUid = null;
    if (hostState.score > guestState.score) {
      winnerUid = hostUid;
    } else if (guestState.score > hostState.score) {
      winnerUid = guestUid;
    } // else draw, winnerUid remains null
    
    // Write result
    if (!roomData.matchState) roomData.matchState = {};
    roomData.matchState.result = {
      winnerUid,
      scores: {
        [hostUid]: hostState.score,
        [guestUid]: guestState.score
      },
      finishedAt: serverTimestamp()
    };
    
    // Update room status
    roomData.meta.status = RoomStatus.FINISHED;
    
    return roomData;
  }, { applyLocally: false });
}

/**
 * Listen to the matchState for realtime sync.
 */
export function subscribeToMatchState(roomCode, onUpdate) {
  const stateRef = ref(db, `rooms/${roomCode}/matchState`);
  
  onValue(stateRef, (snapshot) => {
    const data = snapshot.val();
    onUpdate(data || {});
  });
  
  return () => {
    off(stateRef);
  };
}
