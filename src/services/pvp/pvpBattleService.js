import { ref, runTransaction, onValue, off, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { RoomStatus } from '../../domain/pvp/roomConstants';
import { PVP_ITEMS, ITEM_TYPES, getInitialItemsState } from '../../domain/pvp/pvpItems';

const MAX_HP = 100;
const BASE_DAMAGE = 20;

function getInitialPlayerState() {
  return {
    hp: MAX_HP,
    score: 0,
    correct: 0,
    wrong: 0,
    items: getInitialItemsState(),
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

    const hostItemUse = round.itemUses?.[hostUid];
    const guestItemUse = round.itemUses?.[guestUid];

    const hostPowerActive = hostItemUse?.itemId === ITEM_TYPES.POWER;
    const guestPowerActive = guestItemUse?.itemId === ITEM_TYPES.POWER;
    const hostShieldActive = hostItemUse?.itemId === ITEM_TYPES.SHIELD;
    const guestShieldActive = guestItemUse?.itemId === ITEM_TYPES.SHIELD;

    const hostPowerBonus = hostPowerActive ? PVP_ITEMS[ITEM_TYPES.POWER].bonusDamage : 0;
    const guestPowerBonus = guestPowerActive ? PVP_ITEMS[ITEM_TYPES.POWER].bonusDamage : 0;

    const hostBaseDamage = hostCorrect ? BASE_DAMAGE : 0;
    const guestBaseDamage = guestCorrect ? BASE_DAMAGE : 0;

    let rawHostOutgoingDamage = hostCorrect ? (BASE_DAMAGE + hostPowerBonus) : 0;
    let rawGuestOutgoingDamage = guestCorrect ? (BASE_DAMAGE + guestPowerBonus) : 0;

    const hostShieldBlock = hostShieldActive ? PVP_ITEMS[ITEM_TYPES.SHIELD].blockAmount : 0;
    const guestShieldBlock = guestShieldActive ? PVP_ITEMS[ITEM_TYPES.SHIELD].blockAmount : 0;

    const damageToHost = Math.max(0, rawGuestOutgoingDamage - hostShieldBlock);
    const damageToGuest = Math.max(0, rawHostOutgoingDamage - guestShieldBlock);
    
    const hostShieldBlocked = Math.min(rawGuestOutgoingDamage, hostShieldBlock);
    const guestShieldBlocked = Math.min(rawHostOutgoingDamage, guestShieldBlock);

    let hostHpAfter = Math.max(0, hostHpBefore - damageToHost);
    let guestHpAfter = Math.max(0, guestHpBefore - damageToGuest);

    round.resolution = {
      hostCorrect,
      guestCorrect,
      hostBaseDamage,
      guestBaseDamage,
      hostPowerBonus,
      guestPowerBonus,
      hostShieldBlocked,
      guestShieldBlocked,
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

export async function useBattleItem({ roomCode, uid, roundIndex, itemId, actionId }) {
  const playerStateRef = ref(db, `rooms/${roomCode}/matchState/players/${uid}`);
  
  return runTransaction(playerStateRef, (currentState) => {
    if (!currentState) return;

    if (currentState.hp <= 0) return;

    if (currentState.itemUses && currentState.itemUses[roundIndex]) {
      return; // Already used an item this round
    }

    const itemInv = currentState.items?.[itemId];
    if (!itemInv || itemInv.remaining <= 0) return;

    if (itemId === ITEM_TYPES.HEAL) {
      if (currentState.hp >= MAX_HP) return;
      currentState.hp = Math.min(MAX_HP, currentState.hp + PVP_ITEMS[ITEM_TYPES.HEAL].healAmount);
    }

    itemInv.remaining -= 1;

    if (!currentState.itemUses) {
      currentState.itemUses = {};
    }
    
    currentState.itemUses[roundIndex] = {
      itemId,
      actionId,
      usedAt: serverTimestamp()
    };

    return currentState;
  }, { applyLocally: false });
}

export async function finalizeMatch(roomCode, hostUid, guestUid) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  
  return runTransaction(roomRef, (roomData) => {
    if (!roomData) return;
    
    if (roomData.meta?.status !== RoomStatus.IN_BATTLE) {
      return;
    }
    
    const hostState = roomData.matchState?.players?.[hostUid];
    const guestState = roomData.matchState?.players?.[guestUid];
    
    if (!hostState || !guestState) {
      return; 
    }
    
    let winnerUid = null;
    let loserUid = null;
    
    if (hostState.hp > guestState.hp) {
      winnerUid = hostUid;
      loserUid = guestUid;
    } else if (guestState.hp > hostState.hp) {
      winnerUid = guestUid;
      loserUid = hostUid;
    } else {
      if (hostState.score > guestState.score) {
        winnerUid = hostUid;
        loserUid = guestUid;
      } else if (guestState.score > hostState.score) {
        winnerUid = guestUid;
        loserUid = hostUid;
      }
    }
    
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
