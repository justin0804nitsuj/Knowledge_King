import { ref, runTransaction, update, onValue, off, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { RoomStatus } from '../../domain/pvp/roomConstants';

const MAX_HP = 100;
const DAMAGE = 20;
const POTION_HEAL = 25;

function getInitialPlayerState() {
  return {
    hp: MAX_HP,
    potionsRemaining: 2,
    currentQuestionIndex: 0,
    score: 0,
    correct: 0,
    wrong: 0,
    completed: false,
    processedActions: {}
  };
}

/**
 * Idempotent answer submission for PvP matches.
 * Uses a transaction on 'players' to update self progress and opponent HP simultaneously.
 */
export async function submitAnswer(roomCode, uid, opponentUid, matchId, questionIndex, isCorrect, points, isLastQuestion) {
  const playersRef = ref(db, `rooms/${roomCode}/matchState/players`);
  
  return runTransaction(playersRef, (playersState) => {
    if (!playersState) {
      playersState = {};
    }
    
    // Initialize if they don't exist
    if (!playersState[uid]) playersState[uid] = getInitialPlayerState();
    if (!playersState[opponentUid]) playersState[opponentUid] = getInitialPlayerState();

    const myState = playersState[uid];
    const oppState = playersState[opponentUid];

    // Idempotency: if the state index is already beyond this question, ignore it
    if (myState.currentQuestionIndex > questionIndex) {
      return; // Abort transaction without making changes (already processed)
    }

    // Dead player cannot answer
    if (myState.hp <= 0) {
      return;
    }

    // Apply the answer
    if (isCorrect) {
      myState.score += points;
      myState.correct += 1;
      
      // Deal damage
      if (oppState.hp > 0) {
        oppState.hp = Math.max(0, oppState.hp - DAMAGE);
      }
    } else {
      myState.wrong += 1;
    }

    // Advance progression
    myState.currentQuestionIndex = questionIndex + 1;

    // Check completion (either last question or opponent dead)
    if (isLastQuestion || oppState.hp <= 0) {
      myState.completed = true;
      myState.finishedAt = serverTimestamp();
    }
    
    // If opponent is dead, they are also completed
    if (oppState.hp <= 0 && !oppState.completed) {
      oppState.completed = true;
      oppState.finishedAt = serverTimestamp();
    }

    return playersState;
  }, { applyLocally: false });
}

export async function usePotion(roomCode, uid, actionId) {
  const playerStateRef = ref(db, `rooms/${roomCode}/matchState/players/${uid}`);
  
  return runTransaction(playerStateRef, (currentState) => {
    if (!currentState) {
      currentState = getInitialPlayerState();
    }
    
    if (!currentState.processedActions) {
      currentState.processedActions = {};
    }

    if (currentState.processedActions[actionId]) {
      return; // Already processed
    }

    if (currentState.hp <= 0 || currentState.hp >= MAX_HP || currentState.potionsRemaining <= 0) {
      return; // Abort if cannot heal
    }

    currentState.hp = Math.min(MAX_HP, currentState.hp + POTION_HEAL);
    currentState.potionsRemaining -= 1;
    currentState.processedActions[actionId] = true;

    return currentState;
  }, { applyLocally: false });
}

/**
 * Host finalization transaction.
 * Requires both players to be completed (either through finishing questions or dying).
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
    
    // Determine winner based on HP, tiebreaker Score
    let winnerUid = null;
    let loserUid = null;
    
    if (hostState.hp > guestState.hp) {
      winnerUid = hostUid;
      loserUid = guestUid;
    } else if (guestState.hp > hostState.hp) {
      winnerUid = guestUid;
      loserUid = hostUid;
    } else {
      // HP equal, fallback to score
      if (hostState.score > guestState.score) {
        winnerUid = hostUid;
        loserUid = guestUid;
      } else if (guestState.score > hostState.score) {
        winnerUid = guestUid;
        loserUid = hostUid;
      }
    } // else draw, winnerUid remains null
    
    // Write result
    if (!roomData.matchState) roomData.matchState = {};
    roomData.matchState.result = {
      winnerUid,
      loserUid,
      finalHp: {
        [hostUid]: hostState.hp,
        [guestUid]: guestState.hp
      },
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
