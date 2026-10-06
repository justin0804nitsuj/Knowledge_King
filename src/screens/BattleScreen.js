import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme';
import { createInitialState, nextQuestion, answerQuestion, BATTLE_STATES } from '../domain/game/battleEngine';
import { getWordsByLevel } from '../domain/vocabulary/vocabularyRepository';
import { getStageById } from '../domain/adventure/campaignConfig';

export default function BattleScreen({ route, navigation }) {
  const { stageId } = route.params;
  const stage = getStageById(stageId);
  
  const [gameState, setGameState] = useState(null);
  const [timerRemaining, setTimerRemaining] = useState(stage ? stage.timePerQuestionMs : 10000);
  
  const timerRef = useRef(null);
  const battleIdRef = useRef(null);

  // Initialize Game
  useEffect(() => {
    if (!stage) return;
    const seed = Date.now(); // fresh seed per battle run
    battleIdRef.current = `B-${stageId}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const words = getWordsByLevel(stage.vocabularyLevel);
    let initialState = createInitialState(seed, stage.vocabularyLevel, words, stage);
    initialState = nextQuestion(initialState);
    setGameState(initialState);
  }, [stageId]);

  // Timer tick
  useEffect(() => {
    if (!gameState || gameState.status !== BATTLE_STATES.QUESTION_ACTIVE) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    setTimerRemaining(stage.timePerQuestionMs);
    
    timerRef.current = setInterval(() => {
      setTimerRemaining(prev => {
        if (prev <= 100) {
          clearInterval(timerRef.current);
          handleTimeout();
          return 0;
        }
        return prev - 100;
      });
    }, 100);

    return () => clearInterval(timerRef.current);
  }, [gameState?.questionNumber, gameState?.status]);

  const handleTimeout = useCallback(() => {
    setGameState(prev => {
      if (prev.status !== BATTLE_STATES.QUESTION_ACTIVE) return prev;
      return answerQuestion(prev, null, 0);
    });
  }, []);

  const handleChoice = (choiceId) => {
    if (gameState.status !== BATTLE_STATES.QUESTION_ACTIVE) return;
    
    if (timerRef.current) clearInterval(timerRef.current);
    
    setGameState(prev => answerQuestion(prev, choiceId, timerRemaining));
  };

  const handleNext = () => {
    if (gameState.status === BATTLE_STATES.VICTORY || gameState.status === BATTLE_STATES.DEFEAT) {
      // Go to result
      navigation.replace('BattleResult', { 
        stageId,
        battleId: battleIdRef.current,
        finalState: gameState
      });
    } else {
      setGameState(prev => nextQuestion(prev));
    }
  };

  if (!gameState) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  const { playerHp, opponentHp, score, combo, currentQuestion, status, questionNumber } = gameState;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.scoreText}>Score: {score}</Text>
        <Text style={styles.scoreText}>Combo: {combo}</Text>
      </View>

      {/* HP Bars */}
      <View style={styles.hpContainer}>
        <View style={styles.hpBox}>
          <Text style={styles.hpTitle}>Player</Text>
          <Text style={styles.hpValue}>{playerHp} HP</Text>
        </View>
        <Text style={styles.vs}>VS</Text>
        <View style={styles.hpBox}>
          <Text style={styles.hpTitle}>Gatekeeper</Text>
          <Text style={styles.hpValue}>{opponentHp} HP</Text>
        </View>
      </View>

      {/* Target Word */}
      {currentQuestion && (
        <View style={styles.questionContainer}>
          <Text style={styles.questionNumber}>Question {questionNumber}</Text>
          <Text style={styles.targetWord}>{currentQuestion.word}</Text>
          <Text style={styles.posText}>({currentQuestion.partOfSpeech})</Text>
        </View>
      )}

      {/* Timer */}
      {status === BATTLE_STATES.QUESTION_ACTIVE && (
        <View style={styles.timerBarContainer}>
          <View style={[styles.timerBarFill, { width: `${(timerRemaining / stage.timePerQuestionMs) * 100}%` }]} />
        </View>
      )}

      {/* Choices */}
      <View style={styles.choicesContainer}>
        {currentQuestion?.choices.map((choice) => {
          let btnStyle = styles.choiceBtn;
          let textStyle = styles.choiceText;
          
          if (status === BATTLE_STATES.QUESTION_RESOLVED || status === BATTLE_STATES.VICTORY || status === BATTLE_STATES.DEFEAT) {
            if (choice.id === currentQuestion.correctChoiceId) {
              btnStyle = [styles.choiceBtn, styles.choiceCorrect];
              textStyle = [styles.choiceText, styles.choiceTextCorrect];
            } else if (choice.id === currentQuestion.selectedChoiceId && !currentQuestion.isCorrect) {
              btnStyle = [styles.choiceBtn, styles.choiceWrong];
              textStyle = [styles.choiceText, styles.choiceTextWrong];
            } else {
              btnStyle = [styles.choiceBtn, styles.choiceDisabled];
            }
          }

          return (
            <TouchableOpacity 
              key={choice.id} 
              style={btnStyle}
              disabled={status !== BATTLE_STATES.QUESTION_ACTIVE}
              onPress={() => handleChoice(choice.id)}
            >
              <Text style={textStyle}>{choice.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Feedback / Next Button */}
      {(status === BATTLE_STATES.QUESTION_RESOLVED || status === BATTLE_STATES.VICTORY || status === BATTLE_STATES.DEFEAT) && (
        <View style={styles.feedbackContainer}>
          {currentQuestion.isTimeout ? (
            <Text style={[styles.feedbackText, { color: theme.colors.danger }]}>Timeout!</Text>
          ) : currentQuestion.isCorrect ? (
            <Text style={[styles.feedbackText, { color: theme.colors.success }]}>Correct!</Text>
          ) : (
            <Text style={[styles.feedbackText, { color: theme.colors.danger }]}>Wrong!</Text>
          )}
          <TouchableOpacity style={styles.nextBtn} onPress={handleNext}>
            <Text style={styles.nextBtnText}>
              {status === BATTLE_STATES.QUESTION_RESOLVED ? "Next Question" : "View Results"}
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.medium,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.medium,
  },
  scoreText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
  },
  hpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.medium,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.large,
  },
  hpBox: {
    alignItems: 'center',
  },
  hpTitle: {
    fontSize: 12,
    color: theme.colors.textMuted,
  },
  hpValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  vs: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMuted,
  },
  questionContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing.large,
  },
  questionNumber: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  targetWord: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.textMain,
  },
  posText: {
    fontSize: 16,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  timerBarContainer: {
    height: 8,
    backgroundColor: theme.colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: theme.spacing.medium,
  },
  timerBarFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
  },
  choicesContainer: {
    flex: 1,
  },
  choiceBtn: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.medium,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.small,
    alignItems: 'center',
  },
  choiceText: {
    fontSize: 18,
    color: theme.colors.textMain,
  },
  choiceCorrect: {
    backgroundColor: '#C6F6D5',
    borderColor: theme.colors.success,
  },
  choiceTextCorrect: {
    color: '#22543D',
    fontWeight: 'bold',
  },
  choiceWrong: {
    backgroundColor: '#FED7D7',
    borderColor: theme.colors.danger,
  },
  choiceTextWrong: {
    color: '#822727',
    fontWeight: 'bold',
  },
  choiceDisabled: {
    opacity: 0.6,
  },
  feedbackContainer: {
    alignItems: 'center',
    paddingVertical: theme.spacing.large,
  },
  feedbackText: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: theme.spacing.medium,
  },
  nextBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  nextBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
