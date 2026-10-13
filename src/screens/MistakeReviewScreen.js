import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme';
import { getActiveMistakes, loadMistakes } from '../storage/mistakeStorage';
import { getWordById, getWordsByLevel } from '../domain/vocabulary/vocabularyRepository';
import { generateQuestion } from '../domain/vocabulary/questionGenerator';
import { createSeededRandom } from '../domain/game/seededRandom';
import { processReviewAnswer } from '../domain/game/reviewProcessor';
import { useTranslation } from 'react-i18next';

export default function MistakeReviewScreen({ navigation }) {
  const { t } = useTranslation();
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
  const sessionIdRef = useRef(`R-${Date.now()}-${Math.floor(Math.random() * 100000)}`);

  const loadData = useCallback(async () => {
    try {
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
    } catch (err) {
      console.error('MistakeReviewScreen loadData error:', err);
    } finally {
      setLoading(false);
    }
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

  const timerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleAnswer = async (choiceId) => {
    if (feedback) return; // Prevent double tap

    try {
      const isCorrect = choiceId === currentQuestion.correctChoiceId;
      setFeedback(isCorrect ? 'correct' : 'wrong');
      
      const mistake = activeMistakes[currentIndex];
      const eventId = `${sessionIdRef.current}-${currentIndex}`;
      
      const { xpEarned, newlyRecovered } = await processReviewAnswer(eventId, mistake.id, isCorrect);

      setSessionResults(prev => ({
        reviewed: prev.reviewed + 1,
        correct: prev.correct + (isCorrect ? 1 : 0),
        wrong: prev.wrong + (isCorrect ? 0 : 1),
        xpEarned: prev.xpEarned + xpEarned,
        recoveredCount: prev.recoveredCount + (newlyRecovered ? 1 : 0)
      }));

      // Next question delay
      timerRef.current = setTimeout(() => {
        const nextIndex = currentIndex + 1;
        if (nextIndex < activeMistakes.length) {
          setCurrentIndex(nextIndex);
          setupQuestion(activeMistakes[nextIndex], nextIndex);
        } else {
          setIsFinished(true);
        }
      }, 1000);
    } catch (err) {
      console.error('MistakeReviewScreen handleAnswer error:', err);
      setFeedback(null); // Reset UI so user can try again or go back
    }
  };

  if (loading) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  if (isFinished) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>{t('mistakeReview.reviewComplete')}</Text>
          <Text style={styles.stat}>{t('mistakeReview.reviewed')}: {sessionResults.reviewed}</Text>
          <Text style={styles.stat}>{t('mistakeReview.correct')}: {sessionResults.correct}</Text>
          <Text style={styles.stat}>{t('mistakeReview.recoveredWords')}: {sessionResults.recoveredCount}</Text>
          <Text style={styles.stat}>{t('mistakeReview.xpEarned')}: +{sessionResults.xpEarned}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => navigation.goBack()}>
            <Text style={styles.btnText}>{t('mistakeReview.backToMenu')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>{t('mistakeReview.progress', { current: currentIndex + 1, total: activeMistakes.length })}</Text>
      
      <View style={styles.questionCard}>
        <Text style={styles.targetWord}>{currentQuestion.word}</Text>
        <Text style={styles.partOfSpeech}>{currentQuestion.partOfSpeech}</Text>
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
