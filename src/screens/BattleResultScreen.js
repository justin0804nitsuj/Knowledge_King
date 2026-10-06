import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme';
import { BATTLE_STATES } from '../domain/game/battleEngine';

export default function BattleResultScreen({ route, navigation }) {
  const { level, finalState } = route.params;
  const { status, score, maxCombo, correctCount, wrongCount, timeoutCount, questionNumber } = finalState;

  const isVictory = status === BATTLE_STATES.VICTORY;

  const handleRematch = () => {
    navigation.replace('Battle', { level });
  };

  const handleBack = () => {
    navigation.navigate('Adventure');
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: isVictory ? theme.colors.success : theme.colors.danger }]}>
        {isVictory ? 'VICTORY' : 'DEFEAT'}
      </Text>

      <View style={styles.statsCard}>
        <Text style={styles.statRow}>Final Score: <Text style={styles.statValue}>{score}</Text></Text>
        <Text style={styles.statRow}>Max Combo: <Text style={styles.statValue}>{maxCombo}</Text></Text>
        <Text style={styles.statRow}>Questions Answered: <Text style={styles.statValue}>{questionNumber}</Text></Text>
        <View style={styles.divider} />
        <Text style={styles.statRow}>Correct: <Text style={styles.statValue}>{correctCount}</Text></Text>
        <Text style={styles.statRow}>Wrong: <Text style={styles.statValue}>{wrongCount}</Text></Text>
        <Text style={styles.statRow}>Timeouts: <Text style={styles.statValue}>{timeoutCount}</Text></Text>
      </View>

      <View style={styles.btnContainer}>
        <TouchableOpacity style={styles.btnPrimary} onPress={handleRematch}>
          <Text style={styles.btnTextPrimary}>Rematch</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={handleBack}>
          <Text style={styles.btnTextSecondary}>Back to Adventure</Text>
        </TouchableOpacity>
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
    alignItems: 'center',
  },
  title: {
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: theme.spacing.large,
  },
  statsCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    width: '100%',
    marginBottom: theme.spacing.large,
  },
  statRow: {
    fontSize: 18,
    color: theme.colors.textMuted,
    marginBottom: 8,
  },
  statValue: {
    color: theme.colors.textMain,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 12,
  },
  btnContainer: {
    width: '100%',
  },
  btnPrimary: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.medium,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: theme.spacing.medium,
  },
  btnTextPrimary: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  btnSecondary: {
    backgroundColor: 'transparent',
    padding: theme.spacing.medium,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  btnTextSecondary: {
    color: theme.colors.primary,
    fontSize: 18,
    fontWeight: 'bold',
  },
});
