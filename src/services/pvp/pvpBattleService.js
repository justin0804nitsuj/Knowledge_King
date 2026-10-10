import { ref, runTransaction, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { RoomStatus } from '../../domain/pvp/roomConstants';
import { PVP_ITEMS, ITEM_TYPES } from '../../domain/pvp/pvpItems';
import { createPvpQuestions } from '../../domain/pvp/pvpQuestions';

const MAX_HP = 100;
const BASE_DAMAGE = 20;
export const NEAR_TIE_THRESHOLD_MS = 150;

export function calculateSpeedOutcome(hostSubmittedAt, guestSubmittedAt, hostCorrect, guestCorrect) {
  const validTimestamps = typeof hostSubmittedAt === 'number' && Number.isFinite(hostSubmittedAt) &&
                          typeof guestSubmittedAt === 'number' && Number.isFinite(guestSubmittedAt);

  if (!validTimestamps || !hostCorrect || !guestCorrect) {
    return {
      speedOutcome: 'NONE',
      speedDiffMs: 0
    };
  }

  const speedDiffMs = Math.round(Math.abs(hostSubmittedAt - guestSubmittedAt));

  if (speedDiffMs <= NEAR_TIE_THRESHOLD_MS) {
    return {
      speedOutcome: 'TIE',
      speedDiffMs
    };
  }

  if (hostSubmittedAt < guestSubmittedAt) {
    return {
      speedOutcome: 'HOST_FASTER',
      speedDiffMs
    };
  }

  return {
    speedOutcome: 'GUEST_FASTER',
    speedDiffMs
  };
}

export function calculateRoundDamage({
  hostCorrect,
  guestCorrect,
  speedOutcome,
  hostPowerActive,
  guestPowerActive,
  hostShieldActive,
  guestShieldActive
}) {
  let hostBaseDamage = 0;
  let guestBaseDamage = 0;

  if (hostCorrect && guestCorrect) {
    if (speedOutcome === 'HOST_FASTER') {
      hostBaseDamage = BASE_DAMAGE;
      guestBaseDamage = 0;
    } else if (speedOutcome === 'GUEST_FASTER') {
      hostBaseDamage = 0;
      guestBaseDamage = BASE_DAMAGE;
    } else if (speedOutcome === 'TIE') {
      hostBaseDamage = 10;
      guestBaseDamage = 10;
    }
  } else if (hostCorrect && !guestCorrect) {
    hostBaseDamage = BASE_DAMAGE;
    guestBaseDamage = 0;
  } else if (!hostCorrect && guestCorrect) {
    hostBaseDamage = 0;
    guestBaseDamage = BASE_DAMAGE;
  } else {
    hostBaseDamage = 0;
    guestBaseDamage = 0;
  }

  const hostPowerBonus = (hostPowerActive && hostBaseDamage > 0) ? PVP_ITEMS[ITEM_TYPES.POWER].bonusDamage : 0;
  const guestPowerBonus = (guestPowerActive && guestBaseDamage > 0) ? PVP_ITEMS[ITEM_TYPES.POWER].bonusDamage : 0;

  const rawHostOutgoingDamage = hostBaseDamage + hostPowerBonus;
  const rawGuestOutgoingDamage = guestBaseDamage + guestPowerBonus;

  const hostShieldBlock = hostShieldActive ? PVP_ITEMS[ITEM_TYPES.SHIELD].blockAmount : 0;
  const guestShieldBlock = guestShieldActive ? PVP_ITEMS[ITEM_TYPES.SHIELD].blockAmount : 0;

  const damageToHost = Math.max(0, rawGuestOutgoingDamage - hostShieldBlock);
  const damageToGuest = Math.max(0, rawHostOutgoingDamage - guestShieldBlock);

  const hostShieldBlocked = Math.min(rawGuestOutgoingDamage, hostShieldBlock);
  const guestShieldBlocked = Math.min(rawHostOutgoingDamage, guestShieldBlock);

  return {
    hostBaseDamage,
    guestBaseDamage,
    hostPowerBonus,
    guestPowerBonus,
    rawHostOutgoingDamage,
    rawGuestOutgoingDamage,
    hostShieldBlocked,
    guestShieldBlocked,
    damageToHost,
    damageToGuest
  };
}

function getAnsweringState(roomData, uid, roundIndex) {
  const state = roomData?.matchState;
  if (roomData?.meta?.status !== RoomStatus.IN_BATTLE || !roomData.players?.[uid] ||
      !Number.isInteger(roomData.match?.questionCount) ||
      !Number.isInteger(roundIndex) || roundIndex < 0 ||
      roundIndex >= roomData.match?.questionCount || state?.phase !== 'ANSWERING' ||
      state.roundIndex !== roundIndex || !(state.players?.[uid]?.hp > 0)) return null;
  return state;
}

export async function submitAnswer(roomCode, uid, roundIndex, choiceId) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    const state = getAnsweringState(roomData, uid, roundIndex);
    if (!state || typeof choiceId !== 'string' || !choiceId.length) return;
    if (state.rounds?.[roundIndex]?.answers?.[uid]) return;
    if (!state.rounds) state.rounds = {};
    if (!state.rounds[roundIndex]) state.rounds[roundIndex] = {};
    if (!state.rounds[roundIndex].answers) state.rounds[roundIndex].answers = {};
    state.rounds[roundIndex].answers[uid] = {
      selectedChoiceId: choiceId,
      submittedAt: serverTimestamp()
    };
    return roomData;
  }, { applyLocally: false });
}

export async function resolveRound(roomCode, hostUid, guestUid, roundIndex) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    const matchState = getAnsweringState(roomData, hostUid, roundIndex);
    if (!matchState || roomData.meta.hostUid !== hostUid || hostUid === guestUid ||
        !roomData.players?.[guestUid] || !(matchState.players?.[guestUid]?.hp > 0)) return;
    
    const round = matchState.rounds?.[roundIndex];
    if (!round || !round.answers || !round.answers[hostUid] || !round.answers[guestUid]) {
      return; // Both haven't answered yet
    }

    if (round.resolution) {
      return; // Already resolved
    }

    const hostAnswer = round.answers[hostUid];
    const guestAnswer = round.answers[guestUid];

    // Legacy answer.isCorrect, if present, is non-authoritative.
    const question = createPvpQuestions(roomData.match)[roundIndex];
    const hostCorrect = hostAnswer.selectedChoiceId === question.correctChoiceId;
    const guestCorrect = guestAnswer.selectedChoiceId === question.correctChoiceId;
    matchState.phase = 'RESOLVING';

    const hostHpBefore = matchState.players[hostUid].hp;
    const guestHpBefore = matchState.players[guestUid].hp;

    const hostItemUse = matchState.players[hostUid].itemUses?.[roundIndex];
    const guestItemUse = matchState.players[guestUid].itemUses?.[roundIndex];

    const hostPowerActive = hostItemUse?.itemId === ITEM_TYPES.POWER;
    const guestPowerActive = guestItemUse?.itemId === ITEM_TYPES.POWER;
    const hostShieldActive = hostItemUse?.itemId === ITEM_TYPES.SHIELD;
    const guestShieldActive = guestItemUse?.itemId === ITEM_TYPES.SHIELD;

    const speed = calculateSpeedOutcome(
      hostAnswer?.submittedAt,
      guestAnswer?.submittedAt,
      hostCorrect,
      guestCorrect
    );

    const {
      hostBaseDamage,
      guestBaseDamage,
      hostPowerBonus,
      guestPowerBonus,
      hostShieldBlocked,
      guestShieldBlocked,
      damageToHost,
      damageToGuest
    } = calculateRoundDamage({
      hostCorrect,
      guestCorrect,
      speedOutcome: speed.speedOutcome,
      hostPowerActive,
      guestPowerActive,
      hostShieldActive,
      guestShieldActive
    });

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
      resolvedAt: serverTimestamp(),
      speedOutcome: speed.speedOutcome,
      speedDiffMs: speed.speedDiffMs
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
    return roomData;
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
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    const matchState = getAnsweringState(roomData, uid, roundIndex);
    if (!matchState || !Object.prototype.hasOwnProperty.call(PVP_ITEMS, itemId) ||
        typeof actionId !== 'string' || !actionId.length ||
        matchState.rounds?.[roundIndex]?.answers?.[uid]) return;
    const currentState = matchState.players[uid];

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

    return roomData;
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
    
    if (!hostState || !guestState || roomData.meta.hostUid !== hostUid ||
        roomData.matchState.phase !== 'ROUND_RESULT') {
      return; 
    }
    const exhausted = roomData.matchState.roundIndex + 1 >= roomData.match?.questionCount;
    if (hostState.hp > 0 && guestState.hp > 0 && !exhausted) return;
    
    let winnerUid = null;
    let loserUid = null;
    
    if (hostState.hp <= 0 && guestState.hp <= 0) {
      // Simultaneous KO is always a draw, regardless of accumulated score.
      winnerUid = null;
      loserUid = null;
    } else if (hostState.hp > guestState.hp) {
      winnerUid = hostUid;
      loserUid = guestUid;
    } else if (guestState.hp > hostState.hp) {
      winnerUid = guestUid;
      loserUid = hostUid;
    } else if (exhausted) {
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
  
  return onValue(stateRef, (snapshot) => {
    const data = snapshot.val();
    onUpdate(data);
  });
}
