import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { createInitialState, nextQuestion } from '../domain/game/battleEngine';
import { getWordsByLevel } from '../domain/vocabulary/vocabularyRepository';
import { submitAnswer, subscribeToMatchState, finalizeMatch } from '../services/pvp/pvpBattleService';
import { useTranslation } from 'react-i18next';
import { RoomStatus } from '../domain/pvp/roomConstants';

export default function PvpBattleScreen({ navigation }) {
  const { roomId, room, isHost, user } = usePvpRoom();
  const { t } = useTranslation();
  
  const [phase, setPhase] = useState('LOADING_MATCH');
  const [gameState, setGameState] = useState(null);
  const [initError, setInitError] = useState(null);
  const [matchState, setMatchState] = useState({});
  const [isLocked, setIsLocked] = useState(false);
  const [selectedChoiceId, setSelectedChoiceId] = useState(null);
  
  // Local derived state for immediate feedback
  const [localIndex, setLocalIndex] = useState(0);

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

      const q = state.currentQuestion;
      if (!q.targetId || !q.word || !q.choices || q.choices.length !== 4 || !q.correctChoiceId) {
        throw new Error("Generated question violates invariant schema");
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
  
  // Host finalization
  useEffect(() => {
    if (isHost && phase === 'READY' && room?.meta?.status === RoomStatus.IN_BATTLE) {
      const hostUid = room.meta.hostUid;
      const guestUid = Object.keys(room.players || {}).find(uid => uid !== hostUid);
      
      if (hostUid && guestUid) {
        const hostCompleted = matchState?.players?.[hostUid]?.completed;
        const guestCompleted = matchState?.players?.[guestUid]?.completed;
        
        if (hostCompleted && guestCompleted && !matchState?.result) {
          finalizeMatch(roomId, hostUid, guestUid).catch(err => {
            console.error('Failed to finalize match', err);
          });
        }
      }
    }
  }, [isHost, phase, matchState, room, roomId]);

  // Navigate to result screen when FINISHED
  useEffect(() => {
    if (room?.meta?.status === RoomStatus.FINISHED && matchState?.result) {
      navigation.replace('PvpResult');
    }
  }, [room?.meta?.status, matchState?.result, navigation]);

  const handleChoice = async (choiceId) => {
    if (isLocked || !gameState || !gameState.currentQuestion) return;
    
    setIsLocked(true);
    setSelectedChoiceId(choiceId);
    
    const isCorrect = choiceId === gameState.currentQuestion.correctChoiceId;
    const points = isCorrect ? 10 : 0;
    const isLastQuestion = localIndex + 1 >= room.match.questionCount;
    
    try {
      await submitAnswer(
        roomId, 
        user.uid, 
        room.match.matchId, 
        localIndex, 
        isCorrect, 
        points, 
        isLastQuestion
      );
      
      // Delay before showing next question
      setTimeout(() => {
        if (!isLastQuestion) {
          setGameState(prev => nextQuestion(prev));
          setLocalIndex(prev => prev + 1);
          setSelectedChoiceId(null);
          setIsLocked(false);
        }
      }, 1000);
      
    } catch (err) {
      console.error("Failed to submit answer:", err);
      Alert.alert("Error", "Failed to submit answer. Please try again.");
      setIsLocked(false);
      setSelectedChoiceId(null);
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

  const hostUid = room.meta?.hostUid;
  const guestUid = Object.keys(room.players || {}).find(uid => uid !== hostUid);
  
  const myUid = user?.uid;
  const opponentUid = myUid === hostUid ? guestUid : hostUid;
  
  const myPlayer = room.players[myUid] || {};
  const opponentPlayer = room.players[opponentUid] || {};
  
  const myState = matchState?.players?.[myUid] || { score: 0, currentQuestionIndex: 0 };
  const oppState = matchState?.players?.[opponentUid] || { score: 0, currentQuestionIndex: 0 };
  const totalQuestions = room.match.questionCount;

  const getButtonStateStyle = (choiceId) => {
    const isSelected = selectedChoiceId === choiceId;
    const isCorrect = choiceId === gameState.currentQuestion.correctChoiceId;
    
    if (isLocked) {
      if (isCorrect) return styles.choiceCorrect;
      if (isSelected && !isCorrect) return styles.choiceWrong;
    } else if (isSelected) {
      return styles.choiceSelected;
    }
    return {};
  };

  const getButtonTextStyle = (choiceId) => {
    const isSelected = selectedChoiceId === choiceId;
    const isCorrect = choiceId === gameState.currentQuestion.correctChoiceId;
    
    if (isLocked) {
      if (isCorrect) return styles.choiceTextCorrect;
      if (isSelected && !isCorrect) return styles.choiceTextWrong;
    }
    return {};
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.playerStats}>
          <Text style={styles.playerName}>You</Text>
          <Text style={styles.playerScore}>Score: {myState.score}</Text>
          <Text style={styles.playerProgress}>{myState.currentQuestionIndex} / {totalQuestions}</Text>
        </View>
        <View style={styles.vsContainer}>
          <Text style={styles.vsText}>VS</Text>
        </View>
        <View style={styles.playerStats}>
          <Text style={styles.playerName}>{opponentPlayer?.displayName || 'Opponent'}</Text>
          <Text style={styles.playerScore}>Score: {oppState.score}</Text>
          <Text style={styles.playerProgress}>{oppState.currentQuestionIndex} / {totalQuestions}</Text>
        </View>
      </View>

      {gameState && gameState.currentQuestion && (
        <ScrollView style={styles.questionContainer}>
          <Text style={styles.questionLabel}>Question {localIndex + 1}</Text>
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
      )}
      
      {myState.completed && (
        <View style={styles.waitingContainer}>
          <Text style={styles.waitingText}>Waiting for opponent to finish...</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.medium,
    backgroundColor: theme.colors.card,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingTop: 50,
  },
  playerStats: {
    alignItems: 'center',
    flex: 1,
  },
  playerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: 4,
  },
  playerScore: {
    fontSize: 14,
    color: theme.colors.primary,
    fontWeight: '600',
  },
  playerProgress: {
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  vsContainer: {
    paddingHorizontal: theme.spacing.medium,
  },
  vsText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.secondary,
  },
  questionContainer: {
    flex: 1,
    padding: theme.spacing.large,
  },
  questionLabel: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 8,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  questionText: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: 32,
    textAlign: 'center',
  },
  choicesContainer: {
    marginTop: 16,
  },
  choiceButton: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.medium,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  choiceSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primary + '20',
  },
  choiceCorrect: {
    borderColor: theme.colors.success,
    backgroundColor: theme.colors.success + '20',
  },
  choiceWrong: {
    borderColor: theme.colors.danger,
    backgroundColor: theme.colors.danger + '20',
  },
  choiceText: {
    fontSize: 18,
    color: theme.colors.textMain,
    fontWeight: '500',
  },
  choiceTextCorrect: {
    color: theme.colors.success,
    fontWeight: 'bold',
  },
  choiceTextWrong: {
    color: theme.colors.danger,
    fontWeight: 'bold',
  },
  waitingContainer: {
    padding: theme.spacing.large,
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
  },
  waitingText: {
    fontSize: 16,
    color: theme.colors.textMain,
    fontWeight: 'bold',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 20,
  },
  value: {
    fontSize: 16,
    color: theme.colors.textMain,
    textAlign: 'center',
  },
});
