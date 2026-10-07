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
    score: 0,
    correct: 0,
    wrong: 0,
    processedActions: {}
  };
}

export async function submitAnswer(roomCode, uid, opponentUid, roundIndex, choiceId, isCorrect, points) {
  const answerRef = ref(db, `rooms/${roomCode}/matchState/rounds/${roundIndex}/answers/${uid}`);
  return runTransaction(answerRef, (current) => {
    if (current) return; // already answered
    return {
      selectedChoiceId: choiceId,
      isCorrect,
      submittedAt: serverTimestamp()
    };
  }, { applyLocally: false });
}

export async function resolveRound(roomCode, hostUid, guestUid, roundIndex) {
  const matchStateRef = ref(db, `rooms/${roomCode}/matchState`);
  return runTransaction(matchStateRef, (matchState) => {
    if (!matchState) return;
    if (matchState.roundIndex !== roundIndex) return; // Not the right round
    if (matchState.phase !== 'ANSWERING') return matchState; // Already resolving/resolved
    
    const round = matchState.rounds?.[roundIndex];
    if (!round || !round.answers || !round.answers[hostUid] || !round.answers[guestUid]) {
      return; // Both haven't answered yet
    }

    if (round.resolution) {
      return matchState; // Already resolved
    }

    matchState.phase = 'RESOLVING';

    const hostAnswer = round.answers[hostUid];
    const guestAnswer = round.answers[guestUid];

    const hostCorrect = hostAnswer.isCorrect;
    const guestCorrect = guestAnswer.isCorrect;

    const hostHpBefore = matchState.players[hostUid].hp;
    const guestHpBefore = matchState.players[guestUid].hp;

    let damageToHost = guestCorrect ? DAMAGE : 0;
    let damageToGuest = hostCorrect ? DAMAGE : 0;

    let hostHpAfter = Math.max(0, hostHpBefore - damageToHost);
    let guestHpAfter = Math.max(0, guestHpBefore - damageToGuest);

    round.resolution = {
      hostCorrect,
      guestCorrect,
      damageToHost,
      damageToGuest,
      hostHpBefore,
      guestHpBefore,
      hostHpAfter,
      guestHpAfter,
      resolvedAt: serverTimestamp()
    };

    matchState.players[hostUid].hp = hostHpAfter;
    matchState.players[guestUid].hp = guestHpAfter;
    
    if (hostCorrect) {
      matchState.players[hostUid].correct += 1;
      matchState.players[hostUid].score += 10;
    } else {
      matchState.players[hostUid].wrong += 1;
    }

    if (guestCorrect) {
      matchState.players[guestUid].correct += 1;
      matchState.players[guestUid].score += 10;
    } else {
      matchState.players[guestUid].wrong += 1;
    }

    matchState.phase = 'ROUND_RESULT';
    return matchState;
  }, { applyLocally: false });
}

export async function advanceRound(roomCode, currentRoundIndex) {
  const matchStateRef = ref(db, `rooms/${roomCode}/matchState`);
  return runTransaction(matchStateRef, (matchState) => {
    if (!matchState) return;
    if (matchState.roundIndex !== currentRoundIndex) return;
    if (matchState.phase !== 'ROUND_RESULT') return;
    
    matchState.roundIndex += 1;
    matchState.phase = 'ANSWERING';
    return matchState;
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
    
    if (!hostState || !guestState) {
      return; 
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
    
    roomData.matchState.phase = 'FINISHED';
    
    // Update room status
    roomData.meta.status = RoomStatus.FINISHED;
    
    return roomData;
  }, { applyLocally: false });
}

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
