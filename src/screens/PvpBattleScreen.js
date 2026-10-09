import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Animated } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { createPvpQuestions } from '../domain/pvp/pvpQuestions';
import { submitAnswer, subscribeToMatchState, finalizeMatch, useBattleItem, resolveRound, advanceRound } from '../services/pvp/pvpBattleService';
import { useTranslation } from 'react-i18next';
import { RoomStatus } from '../domain/pvp/roomConstants';
import PvpHealthBar from '../components/pvp/PvpHealthBar';
import PvpItemBar from '../components/pvp/PvpItemBar';
import { Ionicons } from '@expo/vector-icons';
import { gameFeedback } from '../services/feedback/gameFeedback';

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
  const fadeAnim = useRef(new Animated.Value(0)).current;
  
  const lastMyHpRef = useRef(null);
  const lastOppHpRef = useRef(null);
  const lastResultRoundRef = useRef(-1);

  useEffect(() => {
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
      setPhase('PREPARING_MATCH');
      setCountdown(null);
    } catch (e) {
      console.error('[PVP-BATTLE] Initialization failed:', e.message);
      setInitError(e.message);
      setPhase('ERROR');
    }
  }, [room?.match?.matchId]);

  // Countdown effect
  useEffect(() => {
    if (phase === 'COUNTDOWN') {
      if (countdown === null) return;

      fadeAnim.setValue(0.35);
      Animated.timing(fadeAnim, {
        toValue: countdown === 'GO!' ? 1 : 0.8,
        duration: 200,
        useNativeDriver: true,
      }).start(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
        }).start();
      });

      if (countdown === 'GO!') {
        gameFeedback.playCountdownGo();
        const timer = setTimeout(() => {
          setCountdown(null);
          setPhase('READY');
        }, 1000);
        return () => { clearTimeout(timer); fadeAnim.stopAnimation(); };
      }
      
      gameFeedback.playCountdownTick();
      const timer = setTimeout(() => {
        if (countdown > 1) {
          setCountdown(countdown - 1);
        } else {
          setCountdown('GO!');
        }
      }, 1000);
      return () => { clearTimeout(timer); fadeAnim.stopAnimation(); };
    }
  }, [phase, countdown, fadeAnim]);

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
  const currentQuestion = questions?.[roundIndex];
  const isContentHidden = phase !== 'READY';

  useEffect(() => {
    if (phase === 'PREPARING_MATCH' && hasLiveState) {
      setPhase('COUNTDOWN');
      setCountdown(3);
    }
  }, [phase, hasLiveState]);
  
  // Host Settlement Logic
  useEffect(() => {
    if (isHost && phase === 'READY' && room?.meta?.status === RoomStatus.IN_BATTLE) {
      const currentRound = matchState?.rounds?.[roundIndex];
      
      if (matchPhase === 'ANSWERING') {
        const hostAnswer = currentRound?.answers?.[hostUid];
        const guestAnswer = currentRound?.answers?.[guestUid];
        
        if (hostAnswer && guestAnswer && !currentRound.resolution) {
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
  }, [isHost, phase, matchPhase, roundIndex, matchState, roomId, hostUid, guestUid, room]);

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
  const hasAnswered = !!myAnswer;
  // Lock answering if we answered, if it's not ANSWERING phase, if countdown is active, or submitting
  const isLocked = !hasLiveState || !currentQuestion || hasAnswered ||
    matchPhase !== 'ANSWERING' || isSubmitting || isItemPending || phase !== 'READY';
  
  const myItemUse = myState?.itemUses?.[roundIndex];
  const hasUsedItem = !!myItemUse;

  let itemDisabledReason = null;
  let itemsDisabled = false;

  if (phase !== 'READY') {
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
    if (isLocked || !currentQuestion) return;
    
    // Safety invariant checks
    if (!user || !myUid || !room || !room.players || !room.players[myUid]) return;
    if (playerUids.length !== 2 || !opponentUid) return;
    if (room.meta.status !== RoomStatus.IN_BATTLE) return;
    
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
        choiceId
      );
    } catch (err) {
      console.error("Failed to submit answer:", err);
      Alert.alert("Error", "Failed to submit answer. Please try again.");
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
    
    if (hasAnswered && !isSelected) {
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
        <View style={styles.playerStats}>
          <PvpHealthBar 
            name={`${t('pvp.you')} (${myState.score})`}
            hp={myState.hp}
          />
        </View>
        <View style={styles.vsContainer}>
          <Text style={styles.vsText}>VS</Text>
          <Text style={styles.roundText}>{t('pvp.round', { current: roundIndex + 1, total: totalQuestions })}</Text>
        </View>
        <View style={styles.playerStats}>
          <PvpHealthBar 
            name={`${t('pvp.opponent')} (${oppState.score})`} 
            hp={oppState.hp} 
            isOpponent={true}
          />
        </View>
      </View>




      {matchPhase === 'ROUND_RESULT' && currentRound?.resolution ? (() => {
        const res = currentRound.resolution;
        const iAmHost = myUid === hostUid;
        const myCorrect = res[iAmHost ? 'hostCorrect' : 'guestCorrect'];
        const oppCorrect = res[iAmHost ? 'guestCorrect' : 'hostCorrect'];
        const myPowerBonus = res[iAmHost ? 'hostPowerBonus' : 'guestPowerBonus'];
        const oppPowerBonus = res[iAmHost ? 'guestPowerBonus' : 'hostPowerBonus'];
        const myShieldBlocked = res[iAmHost ? 'hostShieldBlocked' : 'guestShieldBlocked'];
        const oppShieldBlocked = res[iAmHost ? 'guestShieldBlocked' : 'hostShieldBlocked'];
        const myDamageDealt = res[iAmHost ? 'damageToGuest' : 'damageToHost'];
        const myDamageReceived = res[iAmHost ? 'damageToHost' : 'damageToGuest'];

        return (
          <View style={styles.resultContainer}>
            <Text style={styles.resultTitle}>{t('pvp.roundResult')}</Text>
            
            <View style={styles.resultColumns}>
              <View style={styles.resultCol}>
                <Text style={styles.resultColTitle}>{t('pvp.you')}</Text>
                <Text style={[styles.resultText, myCorrect ? styles.textSuccess : styles.textDanger]}>
                  {myCorrect ? t('pvp.correctLabel', 'Correct') : t('pvp.wrongLabel', 'Wrong')}
                </Text>
                {myPowerBonus > 0 && <Text style={styles.itemEffectText}>{t('pvp.powerBonus', { bonus: myPowerBonus }, 'Power +{{bonus}}')}</Text>}
                {myShieldBlocked > 0 && <Text style={styles.itemEffectText}>{t('pvp.shieldBlocked', { blocked: myShieldBlocked }, 'Shield blocked {{blocked}}')}</Text>}
                <Text style={styles.damageText}>{t('pvp.youDealt', { amount: myDamageDealt })}</Text>
              </View>

              <View style={styles.resultCol}>
                <Text style={styles.resultColTitle}>{t('pvp.opponent')}</Text>
                <Text style={[styles.resultText, oppCorrect ? styles.textSuccess : styles.textDanger]}>
                  {oppCorrect ? t('pvp.correctLabel', 'Correct') : t('pvp.wrongLabel', 'Wrong')}
                </Text>
                {oppPowerBonus > 0 && <Text style={styles.itemEffectText}>{t('pvp.powerBonus', { bonus: oppPowerBonus }, 'Power +{{bonus}}')}</Text>}
                {oppShieldBlocked > 0 && <Text style={styles.itemEffectText}>{t('pvp.shieldBlocked', { blocked: oppShieldBlocked }, 'Shield blocked {{blocked}}')}</Text>}
                <Text style={styles.damageText}>{t('pvp.youReceived', { amount: myDamageReceived })}</Text>
              </View>
            </View>
          </View>
        );
      })() : (
        currentQuestion && (
          <ScrollView 
            style={[styles.questionContainer, isContentHidden ? { opacity: 0 } : {}]}
            pointerEvents={isContentHidden ? 'none' : 'auto'}
            importantForAccessibility={isContentHidden ? 'no-hide-descendants' : 'auto'}
          >
            <Text style={styles.questionLabel}>Question {roundIndex + 1}</Text>
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
      
      {matchPhase === 'ANSWERING' && hasAnswered && phase !== 'COUNTDOWN' && (
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingTextHeader}>{t('pvp.answerLocked')}</Text>
          <Text style={styles.waitingText}>{t('pvp.waitingForOpponent')}</Text>
        </View>
      )}
      
      {matchPhase === 'RESOLVING' && (
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingText}>...</Text>
        </View>
      )}

      {matchPhase === 'ANSWERING' && (
        <PvpItemBar 
          items={myState.items}
          hp={myState.hp}
          onUseItem={handleUseItem} 
          disabled={itemsDisabled || phase === 'COUNTDOWN'} 
          disabledReason={itemDisabledReason} 
        />
      )}

      {phase === 'COUNTDOWN' && countdown && (
        <Animated.View pointerEvents="none" style={[styles.countdownContainer, { opacity: fadeAnim }]}>
          <Text style={styles.countdownText}>{countdown === 'GO!' ? t('pvp.go') : countdown}</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: theme.spacing.medium, backgroundColor: theme.colors.card,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border, paddingTop: 50,
  },
  playerStats: { flex: 1 },
  vsContainer: { paddingHorizontal: theme.spacing.medium, alignItems: 'center' },
  vsText: { fontSize: 18, fontWeight: 'bold', color: theme.colors.secondary },
  roundText: { fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },
  questionContainer: { flex: 1, padding: theme.spacing.large },
  questionLabel: { fontSize: 14, color: theme.colors.textMuted, marginBottom: 8, fontWeight: 'bold', textAlign: 'center' },
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
  countdownText: { fontSize: 120, fontWeight: 'bold', color: 'white', textShadowColor: 'rgba(0,0,0,0.5)', textShadowOffset: { width: 2, height: 2 }, textShadowRadius: 10 }
});
