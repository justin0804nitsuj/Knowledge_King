import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme';
import { loadMistakes, saveMistakes, getActiveMistakes, processReviewResult } from '../storage/mistakeStorage';
import { loadPlayerProgress, savePlayerProgress, recordDailyActivity } from '../storage/playerProgressStorage';
import { getWordById, getWordsByLevel } from '../domain/vocabulary/vocabularyRepository';
import { generateQuestion } from '../domain/vocabulary/questionGenerator';
import { createSeededRandom } from '../domain/game/seededRandom';
import { XP_REWARDS } from '../domain/player/xpRewards';

export default function MistakeReviewScreen({ navigation }) {
  const [activeMistakes, setActiveMistakes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState({
    reviewed: 0,
    correct: 0,
    wrong: 0,
    xpEarned: 0,
    recoveredCount: 0
  });
  const [isFinished, setIsFinished] = useState(false);
  const [feedback, setFeedback] = useState(null); // 'correct' | 'wrong'

  const loadData = useCallback(async () => {
    setLoading(true);
    const mistakesObj = await loadMistakes();
    const mistakes = getActiveMistakes(mistakesObj);
    
    // Sort logic: higher wrong count first, then by lastMistakeAt descending
    mistakes.sort((a, b) => {
      if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
      return b.lastMistakeAt - a.lastMistakeAt;
    });

    // Take up to 10 for a session
    const sessionMistakes = mistakes.slice(0, 10);
    setActiveMistakes(sessionMistakes);
    
    if (sessionMistakes.length > 0) {
      setupQuestion(sessionMistakes[0], 0);
    } else {
      setIsFinished(true);
    }
    
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const setupQuestion = (mistake, index) => {
    const word = getWordById(mistake.level, mistake.id);
    const levelWords = getWordsByLevel(mistake.level);
    const rng = createSeededRandom(Date.now() + index); // deterministic for this specific setup
    const q = generateQuestion(word, levelWords, rng);
    setCurrentQuestion(q);
    setFeedback(null);
  };

  const handleAnswer = async (choiceId) => {
    if (feedback) return; // Prevent double tap

    const isCorrect = choiceId === currentQuestion.correctChoiceId;
    setFeedback(isCorrect ? 'correct' : 'wrong');
    
    const mistake = activeMistakes[currentIndex];
    
    // Process storage
    let mistakesObj = await loadMistakes();
    const preRecovered = mistakesObj.records[mistake.id]?.isRecovered || false;
    
    mistakesObj = await processReviewResult(mistakesObj, mistake.id, isCorrect);
    await saveMistakes(mistakesObj);
    
    const postRecovered = mistakesObj.records[mistake.id]?.isRecovered || false;
    const newlyRecovered = !preRecovered && postRecovered;

    // Player progress / XP
    let playerProgress = await loadPlayerProgress();
    playerProgress = recordDailyActivity(playerProgress);
    
    let xpEarned = 0;
    if (isCorrect) {
      xpEarned = XP_REWARDS.REVIEW_CORRECT;
      playerProgress.totalXp += xpEarned;
      playerProgress.stats.totalXpEarned += xpEarned;
    }
    
    // Mission 1: 20 questions (review counts as questions)
    const dm = playerProgress.daily.missions;
    if (!dm.m1.claimed) {
      dm.m1.progress += 1;
      if (dm.m1.progress >= 20) {
        dm.m1.claimed = true;
        playerProgress.totalXp += 30;
        playerProgress.stats.totalXpEarned += 30;
        xpEarned += 30;
      }
    }
    
    await savePlayerProgress(playerProgress);

    setSessionResults(prev => ({
      reviewed: prev.reviewed + 1,
      correct: prev.correct + (isCorrect ? 1 : 0),
      wrong: prev.wrong + (isCorrect ? 0 : 1),
      xpEarned: prev.xpEarned + xpEarned,
      recoveredCount: prev.recoveredCount + (newlyRecovered ? 1 : 0)
    }));

    // Next question delay
    setTimeout(() => {
      const nextIndex = currentIndex + 1;
      if (nextIndex < activeMistakes.length) {
        setCurrentIndex(nextIndex);
        setupQuestion(activeMistakes[nextIndex], nextIndex);
      } else {
        setIsFinished(true);
      }
    }, 1000);
  };

  if (loading) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  if (isFinished) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Review Complete</Text>
          <Text style={styles.stat}>Reviewed: {sessionResults.reviewed}</Text>
          <Text style={styles.stat}>Correct: {sessionResults.correct}</Text>
          <Text style={styles.stat}>Recovered Words: {sessionResults.recoveredCount}</Text>
          <Text style={styles.stat}>XP Earned: +{sessionResults.xpEarned}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
            <Text style={styles.btnText}>Back to Menu</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Mistake Review ({currentIndex + 1}/{activeMistakes.length})</Text>
      
      <View style={styles.questionCard}>
        <Text style={styles.targetWord}>{currentQuestion.targetText}</Text>
        <Text style={styles.partOfSpeech}>{currentQuestion.targetPartOfSpeech}</Text>
      </View>

      <View style={styles.choicesContainer}>
        {currentQuestion.choices.map(choice => {
          let bgColor = theme.colors.card;
          if (feedback) {
            if (choice.id === currentQuestion.correctChoiceId) {
              bgColor = theme.colors.success;
            } else if (choice.selected) {
              // Wait, we didn't mark selected in state, we can just use feedback state
              // But for simplicity, correct is green, rest are faded if feedback is present.
            }
          }

          return (
            <TouchableOpacity 
              key={choice.id} 
              style={[styles.choiceBtn, { backgroundColor: bgColor, opacity: feedback && choice.id !== currentQuestion.correctChoiceId ? 0.5 : 1 }]}
              onPress={() => handleAnswer(choice.id)}
              disabled={!!feedback}
            >
              <Text style={styles.choiceText}>{choice.text}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.large,
    justifyContent: 'center',
  },
  header: {
    fontSize: 20,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.large,
  },
  card: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: theme.spacing.medium,
  },
  stat: {
    fontSize: 18,
    color: theme.colors.textMain,
    marginBottom: 8,
  },
  btn: {
    marginTop: theme.spacing.large,
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.medium,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  questionCard: {
    alignItems: 'center',
    marginBottom: 40,
  },
  targetWord: {
    fontSize: 48,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: 8,
  },
  partOfSpeech: {
    fontSize: 18,
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  choicesContainer: {
    width: '100%',
  },
  choiceBtn: {
    padding: theme.spacing.medium,
    borderRadius: 8,
    marginBottom: theme.spacing.medium,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  choiceText: {
    fontSize: 20,
    color: theme.colors.textMain,
  }
});
