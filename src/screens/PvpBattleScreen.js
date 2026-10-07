import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { createInitialState, nextQuestion } from '../domain/game/battleEngine';
import { getWordsByLevel } from '../domain/vocabulary/vocabularyRepository';
import { submitAnswer, subscribeToMatchState, finalizeMatch, usePotion, resolveRound, advanceRound } from '../services/pvp/pvpBattleService';
import { useTranslation } from 'react-i18next';
import { RoomStatus } from '../domain/pvp/roomConstants';

export default function PvpBattleScreen({ navigation }) {
  const { roomId, room, isHost, user } = usePvpRoom();
  const { t } = useTranslation();
  
  const [phase, setPhase] = useState('LOADING_MATCH');
  const [gameState, setGameState] = useState(null);
  const [initError, setInitError] = useState(null);
  const [matchState, setMatchState] = useState({});
  const [isPotionPending, setIsPotionPending] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
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
      
      setPhase('LOADING_VOCABULARY');
      const seed = parseInt(battleSeed, 10) || Date.now();
      const words = getWordsByLevel(level); 
      
      if (!words || words.length === 0) {
        throw new Error(`Empty vocabulary pool for level ${level}`);
      }
      
      setPhase('GENERATING_QUESTIONS');
      const config = {
        playerHp: 3,
        enemyHp: 3,
        timePerQuestionMs: 10000
      };

      let state = createInitialState(seed, level, words, config);
      state = nextQuestion(state);
      
      if (!state.currentQuestion) {
        throw new Error("Failed to generate first question");
      }

      setGameState(state);
      setPhase('READY');
    } catch (e) {
      console.error('[PVP-BATTLE] Initialization failed:', e.message);
      setInitError(e.message);
      setPhase('ERROR');
    }
  }, [room?.match?.matchId]);

  // Subscribe to realtime matchState
  useEffect(() => {
    if (phase === 'READY' && roomId) {
      const unsubscribe = subscribeToMatchState(roomId, (data) => {
        setMatchState(data);
      });
      return unsubscribe;
    }
  }, [phase, roomId]);
  
  const hostUid = room?.meta?.hostUid;
  const playerUids = Object.keys(room?.players || {});
  const myUid = user?.uid;
  const guestUid = playerUids.find(uid => uid !== hostUid);
  const opponentUid = myUid === hostUid ? guestUid : hostUid;

  const roundIndex = matchState?.roundIndex || 0;
  const matchPhase = matchState?.phase || 'ANSWERING';
  
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

  // Sync Local Game Engine to roundIndex
  useEffect(() => {
    if (!gameState) return;
    
    let state = gameState;
    // state.questionNumber is 1-indexed, roundIndex is 0-indexed
    while (state.questionNumber <= roundIndex && state.status !== 'DEFEAT' && state.status !== 'VICTORY') {
      state = { ...state, status: 'QUESTION_RESOLVED' };
      state = nextQuestion(state);
    }
    
    if (state !== gameState) {
      setGameState(state);
    }
  }, [roundIndex, gameState]);

  const myState = matchState?.players?.[myUid];
  const safeMyState = myState || { hp: 100, score: 0, potionsRemaining: 2 };
  const oppState = matchState?.players?.[opponentUid] || { hp: 100, score: 0, potionsRemaining: 2 };
  const totalQuestions = room?.match?.questionCount || 10;
  
  const currentRound = matchState?.rounds?.[roundIndex];
  const myAnswer = currentRound?.answers?.[myUid];
  const hasAnswered = !!myAnswer;
  const isLocked = hasAnswered || matchPhase !== 'ANSWERING' || isSubmitting;
  
  const canUsePotion = safeMyState.hp > 0 && safeMyState.hp < 100 && safeMyState.potionsRemaining > 0 && room?.meta?.status === RoomStatus.IN_BATTLE && matchPhase === 'ANSWERING' && !hasAnswered && !isPotionPending;

  const handleChoice = async (choiceId) => {
    if (isLocked || !gameState || !gameState.currentQuestion) return;
    
    // Safety invariant checks
    if (!user || !myUid || !room || !room.players || !room.players[myUid]) return;
    if (playerUids.length !== 2 || !opponentUid) return;
    if (room.meta.status !== RoomStatus.IN_BATTLE) return;
    
    setIsSubmitting(true);
    
    const isCorrect = choiceId === gameState.currentQuestion.correctChoiceId;
    const points = isCorrect ? 10 : 0;
    
    try {
      await submitAnswer(
        roomId, 
        myUid, 
        opponentUid,
        roundIndex,
        choiceId, 
        isCorrect, 
        points
      );
    } catch (err) {
      console.error("Failed to submit answer:", err);
      Alert.alert("Error", "Failed to submit answer. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePotion = async () => {
    if (!canUsePotion) return;
    setIsPotionPending(true);
    
    const actionId = `potion_${roundIndex}_${safeMyState.potionsRemaining}`;
    try {
      await usePotion(roomId, myUid, actionId);
    } catch (err) {
      console.error("Failed to use potion:", err);
    } finally {
      setIsPotionPending(false);
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

  if (phase !== 'READY' || !gameState) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>
          {phase === 'LOADING_MATCH' ? 'Loading Match...' : 
           phase === 'LOADING_VOCABULARY' ? 'Loading Vocabulary...' : 
           'Generating Questions...'}
        </Text>
      </View>
    );
  }

  const getButtonStateStyle = (choiceId) => {
    const isSelected = myAnswer?.selectedChoiceId === choiceId;
    
    // InROUND_RESULT we reveal correct answers
    if (matchPhase === 'ROUND_RESULT') {
       const isCorrect = choiceId === gameState.currentQuestion.correctChoiceId;
       if (isCorrect) return styles.choiceCorrect;
       if (isSelected && !isCorrect) return styles.choiceWrong;
       return {};
    }
    
    // While answering
    if (isSelected) {
      return styles.choiceSelected; // Just selected, not revealed
    }
    
    return {};
  };

  const getButtonTextStyle = (choiceId) => {
    const isSelected = myAnswer?.selectedChoiceId === choiceId;
    
    if (matchPhase === 'ROUND_RESULT') {
       const isCorrect = choiceId === gameState.currentQuestion.correctChoiceId;
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
          <Text style={styles.playerName}>YOU</Text>
          <Text style={styles.playerHpText}>HP {safeMyState.hp} / 100</Text>
          <View style={styles.hpBarContainer}>
            <View style={[styles.hpBarFill, { width: `${Math.max(0, safeMyState.hp)}%` }]} />
          </View>
          <Text style={styles.playerProgress}>Score: {safeMyState.score}</Text>
        </View>
        <View style={styles.vsContainer}>
          <Text style={styles.vsText}>VS</Text>
          <Text style={styles.roundText}>Round {roundIndex + 1}/{totalQuestions}</Text>
        </View>
        <View style={styles.playerStats}>
          <Text style={styles.playerName}>OPPONENT</Text>
          <Text style={styles.playerHpText}>HP {oppState.hp} / 100</Text>
          <View style={styles.hpBarContainer}>
            <View style={[styles.hpBarFill, { width: `${Math.max(0, oppState.hp)}%`, backgroundColor: theme.colors.danger }]} />
          </View>
          <Text style={styles.playerProgress}>Score: {oppState.score}</Text>
        </View>
      </View>

      <View style={styles.potionContainer}>
        <TouchableOpacity 
          style={[styles.potionButton, !canUsePotion && styles.potionButtonDisabled]} 
          onPress={handlePotion}
          disabled={!canUsePotion}
        >
          <Text style={styles.potionIcon}>🧪</Text>
          <View>
            <Text style={styles.potionTitle}>Heal +25</Text>
            <Text style={styles.potionCount}>{safeMyState.potionsRemaining} left</Text>
          </View>
        </TouchableOpacity>
      </View>
      
      {matchPhase === 'ROUND_RESULT' && currentRound?.resolution ? (
        <View style={styles.resultContainer}>
          <Text style={styles.resultTitle}>Round {roundIndex + 1} Result</Text>
          <Text style={styles.resultText}>
            You were {currentRound.resolution[myUid === hostUid ? 'hostCorrect' : 'guestCorrect'] ? 'Correct' : 'Wrong'}
          </Text>
          <Text style={styles.resultText}>
            Opponent was {currentRound.resolution[myUid === hostUid ? 'guestCorrect' : 'hostCorrect'] ? 'Correct' : 'Wrong'}
          </Text>
          <Text style={styles.damageText}>
            You dealt {currentRound.resolution[myUid === hostUid ? 'damageToGuest' : 'damageToHost']} damage!
          </Text>
          <Text style={styles.damageText}>
            You received {currentRound.resolution[myUid === hostUid ? 'damageToHost' : 'damageToGuest']} damage!
          </Text>
        </View>
      ) : (
        gameState && gameState.currentQuestion && (
          <ScrollView style={styles.questionContainer}>
            <Text style={styles.questionLabel}>Question {roundIndex + 1}</Text>
            <Text style={styles.questionText}>{gameState.currentQuestion.word}</Text>
            
            <View style={styles.choicesContainer}>
              {gameState.currentQuestion.choices.map((choice) => (
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
      
      {matchPhase === 'ANSWERING' && hasAnswered && (
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingText}>等待對手作答…</Text>
        </View>
      )}
      
      {matchPhase === 'RESOLVING' && (
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingText}>結算中…</Text>
        </View>
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
  playerStats: { alignItems: 'center', flex: 1 },
  playerName: { fontSize: 16, fontWeight: 'bold', color: theme.colors.textMain, marginBottom: 4, textTransform: 'uppercase' },
  playerHpText: { fontSize: 14, fontWeight: 'bold', color: theme.colors.textMain, marginBottom: 4 },
  hpBarContainer: { width: 100, height: 12, backgroundColor: theme.colors.surface, borderRadius: 6, overflow: 'hidden', marginBottom: 6 },
  hpBarFill: { height: '100%', backgroundColor: theme.colors.success },
  playerProgress: { fontSize: 12, color: theme.colors.textMuted },
  potionContainer: { padding: theme.spacing.medium, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  potionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.primary, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 24 },
  potionButtonDisabled: { backgroundColor: theme.colors.surface, opacity: 0.5 },
  potionIcon: { fontSize: 24, marginRight: 8 },
  potionTitle: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  potionCount: { color: 'white', fontSize: 12 },
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
  waitingText: { fontSize: 16, color: theme.colors.textMain, fontWeight: 'bold' },
  title: { fontSize: 24, fontWeight: 'bold', color: theme.colors.textMain, textAlign: 'center', marginTop: 40, marginBottom: 20 },
  value: { fontSize: 16, color: theme.colors.textMain, textAlign: 'center' },
  resultContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: theme.spacing.large },
  resultTitle: { fontSize: 24, fontWeight: 'bold', color: theme.colors.textMain, marginBottom: 20 },
  resultText: { fontSize: 18, color: theme.colors.textMain, marginBottom: 10 },
  damageText: { fontSize: 16, color: theme.colors.secondary, marginTop: 10, fontWeight: 'bold' }
});
