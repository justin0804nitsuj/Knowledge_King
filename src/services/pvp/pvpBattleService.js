import { ref, set, runTransaction, onValue, serverTimestamp } from 'firebase/database';
import { db } from '../firebase/firebaseDatabase';
import { getServerNow } from '../firebase/serverTimeService';
import { RoomStatus } from '../../domain/pvp/roomConstants';
import { PVP_ITEMS, ITEM_TYPES, getInitialItemsState } from '../../domain/pvp/pvpItems';
import { createPvpQuestions } from '../../domain/pvp/pvpQuestions';
import { validatePvpLoadout } from '../../domain/pvp/pvpLoadout';

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

export const ROUND_TIME_LIMIT_MS = 6000;
export const ROUND_PRE_BATTLE_MS = 4000;
export const SUBMISSION_TRANSIT_TOLERANCE_MS = 500;

export function getRoundDeadline(roundStartedAt, roundIndex) {
  if (typeof roundStartedAt !== 'number') return null;
  const preBattleMs = roundIndex === 0 ? ROUND_PRE_BATTLE_MS : 0;
  return roundStartedAt + preBattleMs + ROUND_TIME_LIMIT_MS;
}

export function getRoundAnsweringStart(roundStartedAt, roundIndex) {
  if (typeof roundStartedAt !== 'number') return null;
  return roundIndex === 0 ? roundStartedAt + ROUND_PRE_BATTLE_MS : roundStartedAt;
}

export async function startRoundTimer(roomCode, roundIndex = 0) {
  const matchStateRef = ref(db, `rooms/${roomCode}/matchState`);
  return runTransaction(matchStateRef, (matchState) => {
    if (!matchState) return;
    if (matchState.roundIndex !== roundIndex) return;
    if (matchState.phase !== 'ANSWERING') return;
    if (matchState.roundStartedAt) return; // already started

    matchState.roundStartedAt = serverTimestamp();
    return matchState;
  }, { applyLocally: false });
}

export async function submitAnswer(roomCode, uid, roundIndex, choiceId, clientSubmittedAt) {
  const tapTime = typeof clientSubmittedAt === 'number' ? clientSubmittedAt : getServerNow();
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    const state = getAnsweringState(roomData, uid, roundIndex);
    if (!state || typeof choiceId !== 'string' || !choiceId.length) return;
    if (state.rounds?.[roundIndex]?.answers?.[uid]) return;

    const deadline = getRoundDeadline(state.roundStartedAt, roundIndex);
    if (typeof deadline === 'number' && tapTime > deadline) {
      return; // answer rejected after deadline
    }

    if (!state.rounds) state.rounds = {};
    if (!state.rounds[roundIndex]) state.rounds[roundIndex] = {};
    if (!state.rounds[roundIndex].answers) state.rounds[roundIndex].answers = {};
    state.rounds[roundIndex].answers[uid] = {
      selectedChoiceId: choiceId,
      clientSubmittedAt: tapTime,
      submittedAt: serverTimestamp()
    };
    return roomData;
  }, { applyLocally: false });
}

export async function submitTimeout(roomCode, uid, roundIndex) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    const state = getAnsweringState(roomData, uid, roundIndex);
    if (!state) return;
    if (state.rounds?.[roundIndex]?.answers?.[uid]) return;

    const deadline = getRoundDeadline(state.roundStartedAt, roundIndex);
    const now = getServerNow();
    // Cannot submit timeout before deadline
    if (typeof deadline === 'number' && now < deadline) {
      return;
    }

    if (!state.rounds) state.rounds = {};
    if (!state.rounds[roundIndex]) state.rounds[roundIndex] = {};
    if (!state.rounds[roundIndex].answers) state.rounds[roundIndex].answers = {};
    state.rounds[roundIndex].answers[uid] = {
      timedOut: true,
      submittedAt: serverTimestamp()
    };
    return roomData;
  }, { applyLocally: false });
}

export async function fillMissingTimeouts(roomCode, hostUid, guestUid, roundIndex) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    const matchState = getAnsweringState(roomData, hostUid, roundIndex);
    if (!matchState || roomData.meta.hostUid !== hostUid || hostUid === guestUid ||
        !roomData.players?.[guestUid] || !(matchState.players?.[guestUid]?.hp > 0)) return;

    if (!matchState.rounds) matchState.rounds = {};
    if (!matchState.rounds[roundIndex]) matchState.rounds[roundIndex] = {};
    if (!matchState.rounds[roundIndex].answers) matchState.rounds[roundIndex].answers = {};
    const round = matchState.rounds[roundIndex];

    if (round.resolution) {
      return; // Already resolved
    }

    const deadline = getRoundDeadline(matchState.roundStartedAt, roundIndex);
    const now = getServerNow();
    if (typeof deadline === 'number' && now < deadline) {
      return; // Cannot fill timeout before deadline
    }

    const hostAnswer = round.answers[hostUid];
    const guestAnswer = round.answers[guestUid];

    if (hostAnswer && guestAnswer) {
      return roomData; // Both already have answers or timeouts, no-op
    }

    const ts = serverTimestamp();
    if (!hostAnswer) {
      round.answers[hostUid] = {
        timedOut: true,
        submittedAt: ts
      };
    }
    if (!guestAnswer) {
      round.answers[guestUid] = {
        timedOut: true,
        submittedAt: ts
      };
    }

    return roomData;
  }, { applyLocally: false });
}

export async function autoResolveRound(roomCode, hostUid, guestUid, roundIndex) {
  // Step A: authoritatively fill any missing timeout answers while phase is still ANSWERING
  await fillMissingTimeouts(roomCode, hostUid, guestUid, roundIndex);
  // Step B: settle the round using complete answers
  return resolveRound(roomCode, hostUid, guestUid, roundIndex);
}

export async function resolveRound(roomCode, hostUid, guestUid, roundIndex) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    const matchState = getAnsweringState(roomData, hostUid, roundIndex);
    if (!matchState || roomData.meta.hostUid !== hostUid || hostUid === guestUid ||
        !roomData.players?.[guestUid] || !(matchState.players?.[guestUid]?.hp > 0)) return;
    
    if (!matchState.rounds) matchState.rounds = {};
    if (!matchState.rounds[roundIndex]) matchState.rounds[roundIndex] = {};
    if (!matchState.rounds[roundIndex].answers) matchState.rounds[roundIndex].answers = {};
    const round = matchState.rounds[roundIndex];

    if (round.resolution) {
      return; // Already resolved
    }

    const deadline = getRoundDeadline(matchState.roundStartedAt, roundIndex);
    const now = getServerNow();
    const isTimedOut = typeof deadline === 'number' && now >= deadline;

    const hostAnswer = round.answers[hostUid];
    const guestAnswer = round.answers[guestUid];

    const hostDone = !!hostAnswer || isTimedOut;
    const guestDone = !!guestAnswer || isTimedOut;

    if (!hostDone || !guestDone) {
      return; // Both haven't finished answering/timing out yet
    }

    // Fill in timeout record for missing answer
    const ts = serverTimestamp();
    if (!hostAnswer) {
      round.answers[hostUid] = {
        timedOut: true,
        submittedAt: ts
      };
    }
    if (!guestAnswer) {
      round.answers[guestUid] = {
        timedOut: true,
        submittedAt: ts
      };
    }

    const finalHostAnswer = round.answers[hostUid];
    const finalGuestAnswer = round.answers[guestUid];

    const hostTimedOut = Boolean(finalHostAnswer?.timedOut || !finalHostAnswer?.selectedChoiceId);
    const guestTimedOut = Boolean(finalGuestAnswer?.timedOut || !finalGuestAnswer?.selectedChoiceId);

    const question = createPvpQuestions(roomData.match)[roundIndex];
    const hostCorrect = !hostTimedOut && finalHostAnswer.selectedChoiceId === question.correctChoiceId;
    const guestCorrect = !guestTimedOut && finalGuestAnswer.selectedChoiceId === question.correctChoiceId;
    matchState.phase = 'RESOLVING';

    const hostHpBefore = matchState.players[hostUid].hp;
    const guestHpBefore = matchState.players[guestUid].hp;

    const hostItemUse = matchState.players[hostUid].itemUses?.[roundIndex];
    const guestItemUse = matchState.players[guestUid].itemUses?.[roundIndex];

    const hostPowerActive = hostItemUse?.itemId === ITEM_TYPES.POWER;
    const guestPowerActive = guestItemUse?.itemId === ITEM_TYPES.POWER;
    const hostShieldActive = hostItemUse?.itemId === ITEM_TYPES.SHIELD;
    const guestShieldActive = guestItemUse?.itemId === ITEM_TYPES.SHIELD;

    const hostSubmittedAt = finalHostAnswer?.clientSubmittedAt ?? finalHostAnswer?.submittedAt;
    const guestSubmittedAt = finalGuestAnswer?.clientSubmittedAt ?? finalGuestAnswer?.submittedAt;

    const speed = (hostTimedOut || guestTimedOut)
      ? { speedOutcome: 'NONE', speedDiffMs: 0 }
      : calculateSpeedOutcome(
          hostSubmittedAt,
          guestSubmittedAt,
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
      speedDiffMs: speed.speedDiffMs,
      hostTimedOut,
      guestTimedOut
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
    matchState.roundStartedAt = serverTimestamp();
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

export async function publishRevealedLoadout({ roomCode, uid, loadout }) {
  if (!validatePvpLoadout(loadout)) {
    throw new Error('Invalid loadout');
  }
  const loadoutRef = ref(db, `rooms/${roomCode}/matchState/revealedLoadouts/${uid}`);
  return set(loadoutRef, {
    HEAL: loadout.HEAL,
    SHIELD: loadout.SHIELD,
    POWER: loadout.POWER,
  });
}

export async function startFirstRound({ roomCode, hostUid, guestUid }) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    if (!roomData || !roomData.matchState) return;
    if (roomData.meta?.hostUid !== hostUid) return;
    if (roomData.matchState.phase !== 'LOADOUT_REVEAL') return;

    const revealed = roomData.matchState.revealedLoadouts;
    if (!revealed) return;
    const hostLoadout = revealed[hostUid];
    const guestLoadout = revealed[guestUid];

    if (!validatePvpLoadout(hostLoadout) || !validatePvpLoadout(guestLoadout)) {
      return;
    }

    roomData.matchState.phase = 'ANSWERING';
    roomData.matchState.roundStartedAt = serverTimestamp();

    if (!roomData.matchState.players) {
      roomData.matchState.players = {};
    }
    if (roomData.matchState.players[hostUid]) {
      roomData.matchState.players[hostUid].items = getInitialItemsState(hostLoadout);
    }
    if (roomData.matchState.players[guestUid]) {
      roomData.matchState.players[guestUid].items = getInitialItemsState(guestLoadout);
    }

    return roomData;
  }, { applyLocally: false });
}

export async function cancelMatchOnRevealTimeout({ roomCode, hostUid }) {
  const roomRef = ref(db, `rooms/${roomCode}`);
  return runTransaction(roomRef, (roomData) => {
    if (!roomData) return;
    if (roomData.meta?.hostUid !== hostUid) return;
    if (roomData.matchState?.phase !== 'LOADOUT_REVEAL') return;

    roomData.meta.status = RoomStatus.CANCELLED;
    return roomData;
  }, { applyLocally: false });
}
