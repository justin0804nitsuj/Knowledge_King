import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Animated } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { createPvpQuestions } from '../domain/pvp/pvpQuestions';
import {
  submitAnswer,
  subscribeToMatchState,
  finalizeMatch,
  useBattleItem,
  resolveRound,
  autoResolveRound,
  advanceRound,
  submitTimeout,
  getRoundDeadline,
  getRoundAnsweringStart,
  ROUND_TIME_LIMIT_MS,
  ROUND_PRE_BATTLE_MS
} from '../services/pvp/pvpBattleService';
import { initServerTimeOffset, getServerNow } from '../services/firebase/serverTimeService';
import { useTranslation } from 'react-i18next';
import { RoomStatus } from '../domain/pvp/roomConstants';
import PvpHealthBar from '../components/pvp/PvpHealthBar';
import PvpItemBar from '../components/pvp/PvpItemBar';
import { Ionicons } from '@expo/vector-icons';
import { ITEM_TYPES } from '../domain/pvp/pvpItems';
import PvpActiveEffectBadge from '../components/pvp/PvpActiveEffectBadge';
import { gameFeedback } from '../services/feedback/gameFeedback';

export async function executeHostDeadlineAutoResolve({
  roomId,
  hostUid,
  guestUid,
  roundIndex,
  isHost,
  getMatchState,
  autoResolveFn = autoResolveRound,
  onWarn = console.warn,
  onError = console.error,
  scheduleRetry = (fn, delayMs) => setTimeout(fn, delayMs),
  onRetryScheduled,
  isCancelled = () => false,
}) {
  if (isCancelled() || !roomId || !isHost) return;
  const currentMatchState = typeof getMatchState === 'function' ? getMatchState() : getMatchState;
  const roundData = currentMatchState?.rounds?.[roundIndex];
  if (roundData?.resolution) return;

  try {
    return await autoResolveFn(roomId, hostUid, guestUid, roundIndex);
  } catch (err) {
    if (isCancelled()) return;
    const isPermissionError = /permission_denied/i.test(err?.message || err?.code || '');
    if (isPermissionError) {
      onWarn('[PvP] Host deadline auto-resolve boundary race, retrying in 400ms:', err?.message || err);
      const timer = scheduleRetry(async () => {
        if (isCancelled() || !roomId || !isHost) return;
        const latestMatchState = typeof getMatchState === 'function' ? getMatchState() : getMatchState;
        const latestRound = latestMatchState?.rounds?.[roundIndex];
        if (latestMatchState?.phase !== 'ANSWERING' || latestRound?.resolution) {
          return; // Round already settled or transitioned
        }
        try {
          return await autoResolveFn(roomId, hostUid, guestUid, roundIndex);
        } catch (retryErr) {
          if (isCancelled()) return;
          onError('[PvP] Host deadline auto-resolve retry failed:', retryErr);
        }
      }, 400);
      if (onRetryScheduled) onRetryScheduled(timer);
    } else {
      onError('[PvP] Host deadline auto-resolve unexpected failure:', err);
    }
  }
}

export function formatRemainingSeconds(remainingMs) {
  if (typeof remainingMs !== 'number' || Number.isNaN(remainingMs) || remainingMs <= 0) {
    return '0.0';
  }
  // Clamp positive values between 1ms and 99ms to 0.1s so positive time doesn't display as 0.0
  const clampedMs = Math.max(100, remainingMs);
  return (clampedMs / 1000).toFixed(1);
}

export function getCountdownStep(roundStartedAt, serverNow) {
  if (typeof roundStartedAt !== 'number' || typeof serverNow !== 'number') {
    return null;
  }
  const elapsed = serverNow - roundStartedAt;
  if (elapsed < 0) {
    return 3;
  }
  if (elapsed < 1000) {
    return 3;
  }
  if (elapsed < 2000) {
    return 2;
  }
  if (elapsed < 3000) {
    return 1;
  }
  if (elapsed < 4000) {
    return 'GO!';
  }
  return null;
}

export function getRoundResultLabel(timedOut, isCorrect, t) {
  if (timedOut === true) {
    return t ? t('pvp.timeoutLabel', 'Timeout') : 'Timeout';
  }
  if (isCorrect) {
    return t ? t('pvp.correctLabel', 'Correct') : 'Correct';
  }
  return t ? t('pvp.wrongLabel', 'Wrong') : 'Wrong';
}

export function getTransitionStatus({ matchPhase, myAnswer, countdown }) {
  if (matchPhase !== 'ANSWERING' && matchPhase !== 'RESOLVING') {
    return null;
  }
  if (Boolean(countdown)) {
    return null;
  }
  const isTimedOut = myAnswer?.timedOut === true;
  const hasRealAnswer = !isTimedOut && typeof myAnswer?.selectedChoiceId === 'string';

  if (isTimedOut) {
    return 'TIMEOUT';
  }
  if (hasRealAnswer) {
    return 'ANSWERED';
  }
  if (matchPhase === 'RESOLVING') {
    return 'RESOLVING';
  }
  return null;
}

export function getTransitionLabel({ status, t }) {
  if (status === 'TIMEOUT') {
    return t ? t('pvp.timeoutLabel', 'Timeout') : 'Timeout';
  }
  if (status === 'ANSWERED') {
    return t ? t('pvp.answerLocked', 'Answer locked') : 'Answer locked';
  }
  if (status === 'RESOLVING') {
    return '...';
  }
  return null;
}

export function processSubmitAnswerError({
  error,
  roundIndex,
  serverNow,
  deadline,
  matchPhase,
  alreadyHadAnswer,
  onInfo = console.info,
  onWarn,
  onError = console.error,
  showAlert = (title, msg) => Alert.alert(title, msg),
}) {
  const isPermissionDenied = /permission_denied/i.test(error?.message || error?.code || '');
  const remainingMs = typeof deadline === 'number' ? deadline - serverNow : null;

  const diagnostics = {
    roundIndex,
    serverNow,
    deadline,
    remainingMs,
    matchPhase,
    alreadyHadAnswer,
    error: error?.message || error,
  };

  const infoLog = onInfo || onWarn || console.info;

  if (isPermissionDenied) {
    // If deadline has passed or failure is within small deadline boundary tolerance (<= 500ms)
    // while the player has not yet had an accepted answer, treat as late answer rejected (timeout)
    const isDeadlineBoundary = !alreadyHadAnswer && (remainingMs === null || remainingMs <= 500);

    if (isDeadlineBoundary) {
      infoLog('[PvP] Submit answer rejected at deadline boundary (late answer/timeout):', diagnostics);
      return { type: 'DEADLINE_REJECTED', diagnostics };
    }

    // Otherwise, substantial time remained (> 500ms) - real permission bug!
    onError('[PvP] Submit answer failed with unexpected permission_denied (>500ms remaining):', diagnostics);
    showAlert('Error', 'Failed to submit answer. Please try again.');
    return { type: 'UNEXPECTED_PERMISSION_ERROR', diagnostics };
  }

  // Non-permission error (network error, transaction abort, etc.)
  onError('[PvP] Submit answer failed:', diagnostics);
  showAlert('Error', 'Failed to submit answer. Please try again.');
  return { type: 'NON_PERMISSION_ERROR', diagnostics };
}

export default function PvpBattleScreen({ navigation }) {
  const { roomId, room, isHost, user } = usePvpRoom();
  const { t } = useTranslation();

  const [phase, setPhase] = useState('LOADING_MATCH');
  const [questions, setQuestions] = useState(null);
  const [initError, setInitError] = useState(null);
  const [matchState, setMatchState] = useState(null);
  const [isItemPending, setIsItemPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(null); // 3, 2, 1, 'GO!', null
  const [itemUsedThisRound, setItemUsedThisRound] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(null);
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const lastCountdownStepRef = useRef(null);
  const fallbackRoundStartedAtRef = useRef(null);

  const matchStateRef = useRef(matchState);
  matchStateRef.current = matchState;

  const lastMyHpRef = useRef(null);
  const lastOppHpRef = useRef(null);
  const lastResultRoundRef = useRef(-1);
  const lastAlertedSecondRef = useRef(null);
  const submittedRoundsRef = useRef(new Set());

  useEffect(() => {
    initServerTimeOffset();
    gameFeedback.init();
    return () => gameFeedback.cleanup();
  }, []);

  useEffect(() => {
    if (!room || !room.match) {
      setPhase('LOADING_MATCH');
      return;
    }

    try {
      const { battleSeed, level, matchId, rulesetVersion, vocabularyVersion, questionCount } = room.match;

      if (!battleSeed || level === undefined || !matchId || !rulesetVersion || !vocabularyVersion || !questionCount) {
        throw new Error("Malformed or incomplete match config");
      }

      setInitError(null);
      setQuestions(createPvpQuestions(room.match));
      setPhase('READY');
      setCountdown(null);
    } catch (e) {
      console.error('[PVP-BATTLE] Initialization failed:', e.message);
      setInitError(e.message);
      setPhase('ERROR');
    }
  }, [room?.match?.matchId]);

  // Subscribe while preparing and counting down as well as during combat.
  useEffect(() => {
    setMatchState(null);
    if (!roomId) return;
    return subscribeToMatchState(roomId, setMatchState);
  }, [roomId]);

  const hostUid = room?.meta?.hostUid;
  const playerUids = Object.keys(room?.players || {});
  const myUid = user?.uid;
  const guestUid = playerUids.find(uid => uid !== hostUid);
  const opponentUid = myUid === hostUid ? guestUid : hostUid;

  const roundIndex = matchState?.roundIndex ?? 0;
  const matchPhase = matchState?.phase;
  const myState = matchState?.players?.[myUid];
  const oppState = matchState?.players?.[opponentUid];
  const hasLiveState = Number.isInteger(matchState?.roundIndex) && !!matchPhase &&
    typeof myState?.hp === 'number' && typeof oppState?.hp === 'number' &&
    !!myState?.items && !!oppState?.items;

  // Authoritative item use for local player
  const myItemUse = myState?.itemUses?.[roundIndex];
  // Badges shown while round not resolved
  const isRoundUnresolved = matchPhase === 'ANSWERING' || matchPhase === 'RESOLVING';
  const activeShield = isRoundUnresolved && myItemUse?.itemId === ITEM_TYPES.SHIELD;
  const activePower = isRoundUnresolved && myItemUse?.itemId === ITEM_TYPES.POWER;
  const currentQuestion = questions?.[roundIndex];

  const roundDeadlineAt = getRoundDeadline(matchState?.roundStartedAt, roundIndex);

  // Active Answering Countdown Timer & Round 0 Pre-battle Countdown
  useEffect(() => {
    const currentRound = matchState?.rounds?.[roundIndex];
    const myAnswer = currentRound?.answers?.[myUid];
    const hasAnswerOrTimeout = Boolean(myAnswer);

    if (!hasLiveState || matchPhase !== 'ANSWERING') {
      setRemainingSeconds(null);
      setCountdown(null);
      lastAlertedSecondRef.current = null;
      lastCountdownStepRef.current = null;
      return;
    }

    const currentRoundStartedAt = typeof matchState?.roundStartedAt === 'number'
      ? matchState.roundStartedAt
      : (fallbackRoundStartedAtRef.current ?? (fallbackRoundStartedAtRef.current = getServerNow()));

    const currentAnswerStartAt = getRoundAnsweringStart(currentRoundStartedAt, roundIndex);
    const currentRoundDeadlineAt = getRoundDeadline(currentRoundStartedAt, roundIndex);

    const updateTimer = () => {
      const serverNow = getServerNow();

      // Round 0 Pre-battle countdown (3 -> 2 -> 1 -> GO!)
      if (roundIndex === 0 && typeof currentAnswerStartAt === 'number' && serverNow < currentAnswerStartAt) {
        const step = getCountdownStep(currentRoundStartedAt, serverNow);
        setCountdown(step);
        setRemainingSeconds(null);

        if (step !== lastCountdownStepRef.current) {
          lastCountdownStepRef.current = step;
          if (step === 'GO!') {
            gameFeedback.playCountdownGo?.();
            fadeAnim.setValue(0.35);
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 800,
                useNativeDriver: true,
              }).start();
            });
          } else if (step !== null) {
            gameFeedback.playCountdownTick?.();
            fadeAnim.setValue(0.35);
            Animated.timing(fadeAnim, {
              toValue: 0.8,
              duration: 200,
              useNativeDriver: true,
            }).start(() => {
              Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 800,
                useNativeDriver: true,
              }).start();
            });
          }
        }
        return;
      }

      // Pre-battle is complete (or Round 1+)
      if (lastCountdownStepRef.current !== null) {
        lastCountdownStepRef.current = null;
      }
      setCountdown(null);

      if (hasAnswerOrTimeout || typeof currentRoundDeadlineAt !== 'number') {
        setRemainingSeconds(null);
        return;
      }

      const diffMs = currentRoundDeadlineAt - serverNow;
      const formatted = formatRemainingSeconds(diffMs);
      setRemainingSeconds(formatted);

      const wholeSec = Math.ceil(diffMs / 1000);
      if (wholeSec <= 2 && wholeSec > 0 && lastAlertedSecondRef.current !== wholeSec) {
        lastAlertedSecondRef.current = wholeSec;
        gameFeedback.playCountdownTick?.();
      }

      if (diffMs <= 0 && !hasAnswerOrTimeout && roomId && myUid) {
        submitTimeout(roomId, myUid, roundIndex).catch(err => {
          console.error('Failed to submit timeout', err);
        });
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 50);
    return () => clearInterval(interval);
  }, [matchPhase, hasLiveState, matchState?.roundStartedAt, roundIndex, roomId, myUid, matchState?.rounds?.[roundIndex]?.answers?.[myUid]]);

  // Host Deadline Auto-Resolve (Liveness Trigger: wakes at deadline + 250ms)
  useEffect(() => {
    if (!isHost || matchPhase !== 'ANSWERING' || typeof roundDeadlineAt !== 'number' || !roomId) {
      return;
    }
    const currentRound = matchState?.rounds?.[roundIndex];
    if (currentRound?.resolution) return;

    const serverNow = getServerNow();
    const delay = Math.max(0, roundDeadlineAt - serverNow + 250);

    let retryTimer = null;
    let cancelled = false;

    const executeResolve = () => {
      executeHostDeadlineAutoResolve({
        roomId,
        hostUid,
        guestUid,
        roundIndex,
        isHost,
        getMatchState: () => matchStateRef.current,
        autoResolveFn: autoResolveRound,
        scheduleRetry: (fn, delayMs) => setTimeout(fn, delayMs),
        onRetryScheduled: (timer) => { retryTimer = timer; },
        isCancelled: () => cancelled,
      });
    };

    const timer = setTimeout(executeResolve, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isHost, matchPhase, roundDeadlineAt, roundIndex, roomId, hostUid, guestUid, matchState?.rounds?.[roundIndex]?.resolution]);

  // Host Settlement Logic (triggers immediately when both players have answered)
  useEffect(() => {
    if (isHost && phase === 'READY' && room?.meta?.status === RoomStatus.IN_BATTLE) {
      const currentRound = matchState?.rounds?.[roundIndex];

      if (matchPhase === 'ANSWERING') {
        const hostAnswer = currentRound?.answers?.[hostUid];
        const guestAnswer = currentRound?.answers?.[guestUid];

        if (!currentRound?.resolution && hostAnswer && guestAnswer) {
          resolveRound(roomId, hostUid, guestUid, roundIndex).catch(err => {
            console.error('Failed to resolve round', err);
          });
        }
      }

      if (matchPhase === 'ROUND_RESULT') {
        // Wait a short moment then advance
        const timer = setTimeout(() => {
          // Check if match should end
          const hostHp = matchState.players?.[hostUid]?.hp || 0;
          const guestHp = matchState.players?.[guestUid]?.hp || 0;
          const totalQuestions = room?.match?.questionCount || 10;

          if (hostHp <= 0 || guestHp <= 0 || roundIndex + 1 >= totalQuestions) {
            finalizeMatch(roomId, hostUid, guestUid).catch(err => {
              console.error('Failed to finalize match', err);
            });
          } else {
            advanceRound(roomId, roundIndex).catch(err => {
              console.error('Failed to advance round', err);
            });
          }
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isHost, phase, matchPhase, roundIndex, matchState, roomId, hostUid, guestUid, room, roundDeadlineAt]);

  // Navigate to result screen when FINISHED
  useEffect(() => {
    if (room?.meta?.status === RoomStatus.FINISHED && matchState?.phase === 'FINISHED') {
      navigation.replace('PvpResult');
    }
  }, [room?.meta?.status, matchState?.phase, navigation]);

  const totalQuestions = room?.match?.questionCount || 10;

  // Feedback listeners
  // Feedback listeners for HP changes (damage/heal)
  useEffect(() => {
    if (!hasLiveState) return;
    if (lastMyHpRef.current !== null && myState.hp < lastMyHpRef.current) {
      gameFeedback.playDamage();
    } else if (lastMyHpRef.current !== null && myState.hp > lastMyHpRef.current) {
      gameFeedback.playHeal();
    }
    lastMyHpRef.current = myState.hp;
  }, [hasLiveState, myState?.hp]);

  // Reset per-round item-used flag when round index advances
  useEffect(() => {
    fallbackRoundStartedAtRef.current = null;
    lastCountdownStepRef.current = null;
    lastAlertedSecondRef.current = null;
    setItemUsedThisRound(false);
  }, [roundIndex]);

  useEffect(() => {
    if (!hasLiveState) return;
    if (lastOppHpRef.current !== null && oppState.hp < lastOppHpRef.current) {
      gameFeedback.playOpponentHit();
    }
    lastOppHpRef.current = oppState.hp;
  }, [hasLiveState, oppState?.hp]);

  const currentRound = matchState?.rounds?.[roundIndex];

  useEffect(() => {
    if (matchPhase === 'ROUND_RESULT' && currentRound?.resolution && lastResultRoundRef.current !== roundIndex) {
      const hostDamaged = currentRound.resolution.damageToHost > 0;
      const guestDamaged = currentRound.resolution.damageToGuest > 0;

      if (!hostDamaged && !guestDamaged) {
        gameFeedback.playDraw();
      }
      lastResultRoundRef.current = roundIndex;
    }
  }, [matchPhase, currentRound, roundIndex]);

  const myAnswer = currentRound?.answers?.[myUid];
  const localTimedOut = myAnswer?.timedOut === true;
  const localHasRealAnswer = !localTimedOut && typeof myAnswer?.selectedChoiceId === 'string';
  const hasAnswerOrTimeout = Boolean(myAnswer);

  const transitionStatus = getTransitionStatus({
    matchPhase,
    myAnswer,
    countdown
  });

  const isLocalSubmitted = submittedRoundsRef.current.has(roundIndex);
  const serverNow = getServerNow();
  const currentRoundStartedAt = typeof matchState?.roundStartedAt === 'number'
    ? matchState.roundStartedAt
    : fallbackRoundStartedAtRef.current;
  const currentAnswerStartAt = getRoundAnsweringStart(currentRoundStartedAt, roundIndex);
  const remainingMs = typeof roundDeadlineAt === 'number' ? roundDeadlineAt - serverNow : null;
  const isDeadlinePassed = typeof remainingMs === 'number' && remainingMs <= 0;
  const isBeforeAnswerStart = roundIndex === 0 && typeof currentAnswerStartAt === 'number' && serverNow < currentAnswerStartAt;
  const isPreBattle = roundIndex === 0 && (Boolean(countdown) || isBeforeAnswerStart);
  const isTimedOut = (remainingSeconds !== null && (remainingSeconds === '0.0' || remainingSeconds === 0)) || isDeadlinePassed;
  // Lock answering if we answered, if timed out, if deadline passed, if pre-battle countdown active, if locally submitted, if not ANSWERING phase, or submitting
  const isLocked = !hasLiveState || !currentQuestion || hasAnswerOrTimeout || isTimedOut ||
    isPreBattle || isLocalSubmitted || matchPhase !== 'ANSWERING' || isSubmitting || isItemPending || phase !== 'READY';

  const isContentHidden = phase !== 'READY' || isPreBattle;

  const hasUsedItem = !!myItemUse;

  let itemDisabledReason = null;
  let itemsDisabled = false;

  if (phase !== 'READY' || isPreBattle) {
    itemsDisabled = true;
    itemDisabledReason = null;
  } else if (hasUsedItem || itemUsedThisRound) {
    itemsDisabled = true;
    itemDisabledReason = t('pvpItems.disabledUsed', 'Item already used this round');
  } else if (isLocked) {
    itemsDisabled = true;
    itemDisabledReason = t('pvpItems.disabledLocked', 'Answer already locked');
  } else if (isItemPending) {
    itemsDisabled = true;
  }

  const handleChoice = async (choiceId) => {
    if (isLocked || !currentQuestion || isSubmitting) return;

    // Safety invariant checks
    if (!user || !myUid || !room || !room.players || !room.players[myUid]) return;
    if (playerUids.length !== 2 || !opponentUid) return;
    if (room.meta.status !== RoomStatus.IN_BATTLE) return;

    // Immediately capture server-aligned tap time before awaiting Firebase
    const clientSubmittedAt = getServerNow();

    // Synchronously lock this round against any repeated taps
    submittedRoundsRef.current.add(roundIndex);
    setIsSubmitting(true);

    const isCorrect = choiceId === currentQuestion.correctChoiceId;
    if (isCorrect) {
      gameFeedback.playAnswerCorrect();
    } else {
      gameFeedback.playAnswerWrong();
    }

    try {
      await submitAnswer(
        roomId,
        myUid,
        roundIndex,
        choiceId,
        clientSubmittedAt
      );
    } catch (err) {
      const currentServerNow = getServerNow();
      const deadline = typeof roundDeadlineAt === 'number'
        ? roundDeadlineAt
        : getRoundDeadline(matchState?.roundStartedAt, roundIndex);
      const alreadyHadAnswer = Boolean(matchState?.rounds?.[roundIndex]?.answers?.[myUid]);

      processSubmitAnswerError({
        error: err,
        roundIndex,
        serverNow: currentServerNow,
        deadline,
        matchPhase,
        alreadyHadAnswer,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUseItem = async (itemId) => {
    if (itemsDisabled) return;
    setIsItemPending(true);

    const actionId = `item_${roundIndex}_${itemId}`;
    try {
      const result = await useBattleItem({ roomCode: roomId, uid: myUid, roundIndex, itemId, actionId });
      // Mark that an item was used this round for immediate UI feedback
      if (result.committed) setItemUsedThisRound(true);
    } catch (err) {
      console.error("Failed to use item:", err);
    } finally {
      setIsItemPending(false);
    }
  };

  if (phase === 'ERROR') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Battle Error</Text>
        <Text style={styles.value}>{initError}</Text>
      </View>
    );
  }

  if (!questions || phase === 'LOADING_MATCH' || !hasLiveState) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>
          {phase === 'LOADING_MATCH' ? 'Loading Match...' :
            'Preparing Match...'}
        </Text>
      </View>
    );
  }

  const getButtonStateStyle = (choiceId) => {
    const isSelected = myAnswer?.selectedChoiceId === choiceId;

    // InROUND_RESULT we reveal correct answers
    if (matchPhase === 'ROUND_RESULT') {
      const isCorrect = choiceId === currentQuestion.correctChoiceId;
      if (isCorrect) return styles.choiceCorrect;
      if (isSelected && !isCorrect) return styles.choiceWrong;
      return { opacity: 0.5 };
    }

    // While answering
    if (isSelected) {
      return styles.choiceSelected; // Just selected, not revealed
    }

    if (hasAnswerOrTimeout && !isSelected) {
      return { opacity: 0.5 };
    }

    return {};
  };

  const getButtonTextStyle = (choiceId) => {
    const isSelected = myAnswer?.selectedChoiceId === choiceId;

    if (matchPhase === 'ROUND_RESULT') {
      const isCorrect = choiceId === currentQuestion.correctChoiceId;
      if (isCorrect) return styles.choiceTextCorrect;
      if (isSelected && !isCorrect) return styles.choiceTextWrong;
      return {};
    }

    return {};
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={[styles.playerStats, styles.localHudWrapper]}>
          <PvpHealthBar
            name={`${t('pvp.you')} (${myState?.score ?? 0})`}
            hp={myState?.hp}
          />
          {isRoundUnresolved && myItemUse?.itemId === ITEM_TYPES.SHIELD && (
            <PvpActiveEffectBadge
              type="SHIELD"
              label={t('pvp.shieldBadge')}
              testID="localShieldBadge"
            />
          )}
          {isRoundUnresolved && myItemUse?.itemId === ITEM_TYPES.POWER && (
            <PvpActiveEffectBadge
              type="POWER"
              label={t('pvp.powerBadge')}
              testID="localPowerBadge"
            />
          )}
        </View>

        <View style={styles.vsContainer}>
          <Text style={styles.vsText}>VS</Text>
          <Text style={styles.roundText}>
            {t('pvp.round', {
              current: roundIndex + 1,
              total: totalQuestions,
            })}
          </Text>
        </View>

        <View style={styles.playerStats}>
          <PvpHealthBar
            name={`${t('pvp.opponent')} (${oppState?.score ?? 0})`}
            hp={oppState?.hp}
            isOpponent={true}
          />
        </View>
      </View>




      <View style={styles.battleBody}>
        {matchPhase === 'ROUND_RESULT' && currentRound?.resolution ? (() => {
          const res = currentRound.resolution;
          const iAmHost = myUid === hostUid;
          const myCorrect = Boolean(res[iAmHost ? 'hostCorrect' : 'guestCorrect']);
          const oppCorrect = Boolean(res[iAmHost ? 'guestCorrect' : 'hostCorrect']);
          const myTimedOut = Boolean(res[iAmHost ? 'hostTimedOut' : 'guestTimedOut']);
          const oppTimedOut = Boolean(res[iAmHost ? 'guestTimedOut' : 'hostTimedOut']);
          const myPowerBonus = res[iAmHost ? 'hostPowerBonus' : 'guestPowerBonus'];
          const oppPowerBonus = res[iAmHost ? 'guestPowerBonus' : 'hostPowerBonus'];
          const myShieldBlocked = res[iAmHost ? 'hostShieldBlocked' : 'guestShieldBlocked'];
          const oppShieldBlocked = res[iAmHost ? 'guestShieldBlocked' : 'hostShieldBlocked'];
          const myDamageDealt = res[iAmHost ? 'damageToGuest' : 'damageToHost'];
          const myDamageReceived = res[iAmHost ? 'damageToHost' : 'damageToGuest'];

          const myResultLabel = getRoundResultLabel(myTimedOut, myCorrect, t);
          const oppResultLabel = getRoundResultLabel(oppTimedOut, oppCorrect, t);

          let speedMessage = null;
          if (res.speedOutcome === 'TIE') {
            speedMessage = t('pvp.speedTie');
          } else if (res.speedOutcome === 'HOST_FASTER') {
            const seconds = (Math.max(0, res.speedDiffMs || 0) / 1000).toFixed(2);
            speedMessage = iAmHost
              ? t('pvp.speedFaster', { seconds })
              : t('pvp.speedSlower', { seconds });
          } else if (res.speedOutcome === 'GUEST_FASTER') {
            const seconds = (Math.max(0, res.speedDiffMs || 0) / 1000).toFixed(2);
            speedMessage = !iAmHost
              ? t('pvp.speedFaster', { seconds })
              : t('pvp.speedSlower', { seconds });
          }

          return (
            <View style={styles.resultContainer}>
              <Text style={styles.resultTitle}>{t('pvp.roundResult')}</Text>

              <View style={styles.resultColumns}>
                <View style={styles.resultCol}>
                  <Text style={styles.resultColTitle}>{t('pvp.you')}</Text>
                  <Text style={[styles.resultText, myCorrect ? styles.textSuccess : styles.textDanger]}>
                    {myResultLabel}
                  </Text>
                  {myPowerBonus > 0 && <Text style={styles.itemEffectText}>{t('pvp.powerBonus', { bonus: myPowerBonus }, 'Power +{{bonus}}')}</Text>}
                  {myShieldBlocked > 0 && <Text style={styles.itemEffectText}>{t('pvp.shieldBlocked', { blocked: myShieldBlocked }, 'Shield blocked {{blocked}}')}</Text>}
                  <Text style={styles.damageText}>{t('pvp.youDealt', { amount: myDamageDealt })}</Text>
                </View>

                <View style={styles.resultCol}>
                  <Text style={styles.resultColTitle}>{t('pvp.opponent')}</Text>
                  <Text style={[styles.resultText, oppCorrect ? styles.textSuccess : styles.textDanger]}>
                    {oppResultLabel}
                  </Text>
                  {oppPowerBonus > 0 && <Text style={styles.itemEffectText}>{t('pvp.powerBonus', { bonus: oppPowerBonus }, 'Power +{{bonus}}')}</Text>}
                  {oppShieldBlocked > 0 && <Text style={styles.itemEffectText}>{t('pvp.shieldBlocked', { blocked: oppShieldBlocked }, 'Shield blocked {{blocked}}')}</Text>}
                  <Text style={styles.damageText}>{t('pvp.youReceived', { amount: myDamageReceived })}</Text>
                </View>
              </View>

              {speedMessage && (
                <View style={styles.speedPill} testID="pvpSpeedPill">
                  <Ionicons name="flash-outline" size={14} color={theme.colors.secondary || '#F59E0B'} style={styles.speedIcon} />
                  <Text style={styles.speedText}>{speedMessage}</Text>
                </View>
              )}
            </View>
          );
        })() : (
          currentQuestion && (
            <ScrollView
              style={[styles.questionContainer, isContentHidden ? { opacity: 0 } : {}]}
              pointerEvents={isContentHidden ? 'none' : 'auto'}
              importantForAccessibility={isContentHidden ? 'no-hide-descendants' : 'auto'}
            >
              <View style={styles.questionHeaderRow}>
                <Text style={styles.questionLabel}>Question {roundIndex + 1}</Text>
                {matchPhase === 'ANSWERING' && !hasAnswerOrTimeout && remainingSeconds !== null && (() => {
                  const isUrgent = parseFloat(remainingSeconds) <= 2.0;
                  return (
                    <View style={[styles.timerBadge, isUrgent && styles.timerBadgeUrgent]} testID="pvpRoundTimerBadge">
                      <Ionicons
                        name="timer-outline"
                        size={14}
                        color={isUrgent ? '#EF4444' : (theme.colors.textSecondary || '#9CA3AF')}
                        style={styles.timerIcon}
                      />
                      <Text style={[styles.timerText, isUrgent && styles.timerTextUrgent]}>
                        {remainingSeconds}
                      </Text>
                    </View>
                  );
                })()}
              </View>
              <Text style={styles.questionText}>{currentQuestion.word}</Text>

              <View style={styles.choicesContainer}>
                {currentQuestion.choices.map((choice) => (
                  <TouchableOpacity
                    key={choice.id}
                    style={[styles.choiceButton, getButtonStateStyle(choice.id)]}
                    onPress={() => handleChoice(choice.id)}
                    disabled={isLocked}
                  >
                    <Text style={[styles.choiceText, getButtonTextStyle(choice.id)]}>{choice.text}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          )
        )}

        {transitionStatus && (
          <View style={styles.waitingContainer} testID="pvpTransitionWaitingContainer">
            {transitionStatus === 'TIMEOUT' ? (
              <>
                <Text style={[styles.waitingTextHeader, styles.textDanger]} testID="pvpTransitionHeader">
                  {t('pvp.timeoutLabel', 'Timeout')}
                </Text>
                <Text style={styles.waitingText}>{t('pvp.waitingForOpponent')}</Text>
              </>
            ) : transitionStatus === 'ANSWERED' ? (
              <>
                <Text style={styles.waitingTextHeader} testID="pvpTransitionHeader">
                  {t('pvp.answerLocked')}
                </Text>
                <Text style={styles.waitingText}>{t('pvp.waitingForOpponent')}</Text>
              </>
            ) : (
              <Text style={styles.waitingText}>...</Text>
            )}
          </View>
        )}
      </View>

      <PvpItemBar
        items={myState?.items || {}}
        hp={myState?.hp}
        onUseItem={handleUseItem}
        disabled={itemsDisabled || Boolean(countdown)}
        disabledReason={Boolean(countdown) ? null : itemDisabledReason}
      />

      {Boolean(countdown) && (
        <Animated.View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            styles.countdownContainer,
            { opacity: fadeAnim },
          ]}
        >
          <Text style={styles.countdownText}>
            {countdown === 'GO!' ? t('pvp.go') : countdown}
          </Text>
        </Animated.View>
      )}







    </View>
  );
}

const styles = StyleSheet.create({
  battleBody: { flex: 1, minHeight: 0 },
  container: { flex: 1, position: 'relative', backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: theme.spacing.medium, backgroundColor: theme.colors.card,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingTop: 50,
  },
  playerStats: { flex: 1 },
  localHudWrapper: { position: 'relative' },
  vsContainer: { paddingHorizontal: theme.spacing.medium, alignItems: 'center' },
  vsText: { fontSize: 18, fontWeight: 'bold', color: theme.colors.secondary },
  roundText: { fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },
  questionContainer: { flex: 1, padding: theme.spacing.large },
  questionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  questionLabel: { fontSize: 14, color: theme.colors.textMuted, fontWeight: 'bold' },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  timerBadgeUrgent: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  timerIcon: {
    marginRight: 4,
  },
  timerText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#E5E7EB',
  },
  timerTextUrgent: {
    color: '#EF4444',
  },
  questionText: { fontSize: 32, fontWeight: 'bold', color: theme.colors.textMain, marginBottom: 32, textAlign: 'center' },
  choicesContainer: { marginTop: 16 },
  choiceButton: { backgroundColor: theme.colors.card, padding: theme.spacing.medium, borderRadius: 8, marginBottom: 12, borderWidth: 2, borderColor: theme.colors.border, alignItems: 'center' },
  choiceSelected: { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary + '20' },
  choiceCorrect: { borderColor: theme.colors.success, backgroundColor: theme.colors.success + '20' },
  choiceWrong: { borderColor: theme.colors.danger, backgroundColor: theme.colors.danger + '20' },
  choiceText: { fontSize: 18, color: theme.colors.textMain, fontWeight: '500' },
  choiceTextCorrect: { color: theme.colors.success, fontWeight: 'bold' },
  choiceTextWrong: { color: theme.colors.danger, fontWeight: 'bold' },
  waitingContainer: { padding: theme.spacing.large, alignItems: 'center', backgroundColor: theme.colors.surface },
  waitingTextHeader: { fontSize: 18, color: theme.colors.primary, fontWeight: 'bold', marginBottom: 4 },
  waitingText: { fontSize: 16, color: theme.colors.textMuted, fontWeight: 'bold' },
  title: { fontSize: 24, fontWeight: 'bold', color: theme.colors.textMain, textAlign: 'center', marginTop: 40, marginBottom: 20 },
  value: { fontSize: 16, color: theme.colors.textMain, textAlign: 'center' },
  resultContainer: { flex: 1, justifyContent: 'center', alignItems: 'stretch', padding: theme.spacing.large, backgroundColor: theme.colors.card, margin: theme.spacing.large, borderRadius: 12, elevation: 4 },
  resultTitle: { fontSize: 24, fontWeight: 'bold', color: theme.colors.textMain, marginBottom: 24, textAlign: 'center' },
  resultColumns: { flexDirection: 'row', justifyContent: 'space-between' },
  resultCol: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  resultColTitle: { fontSize: 16, color: theme.colors.textMuted, marginBottom: 8, fontWeight: 'bold' },
  resultText: { fontSize: 20, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  itemEffectText: { fontSize: 14, color: theme.colors.primary, fontStyle: 'italic', marginBottom: 4, textAlign: 'center' },
  textSuccess: { color: theme.colors.success },
  textDanger: { color: theme.colors.danger },
  damageText: { fontSize: 16, color: theme.colors.secondary, marginTop: 12, fontWeight: '600', textAlign: 'center' },
  countdownContainer: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.2)', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  countdownText: { fontSize: 120, fontWeight: 'bold', color: 'white', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 10 },
  speedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 14,
    marginTop: 20,
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  speedIcon: {
    marginRight: 6,
  },
  speedText: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textMain,
  },
});
