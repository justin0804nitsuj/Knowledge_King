import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { theme } from '../theme';
import { BATTLE_STATES } from '../domain/game/battleEngine';
import { processBattleResult } from '../domain/game/resultProcessor';
import { getStageById, getNextStage } from '../domain/adventure/campaignConfig';
import { getPlayerLevelInfo } from '../domain/player/levelSystem';
import { loadPlayerProgress } from '../storage/playerProgressStorage';

export default function BattleResultScreen({ route, navigation }) {
  const { stageId, battleId, finalState } = route.params;
  const { status, score, maxCombo, correctCount, wrongCount, timeoutCount, questionNumber } = finalState;

  const isVictory = status === BATTLE_STATES.VICTORY;
  const stage = getStageById(stageId);
  
  const [resultData, setResultData] = useState(null);
  const [levelUpInfo, setLevelUpInfo] = useState(null);
  const [nextStageId, setNextStageId] = useState(null);

  useEffect(() => {
    async function doProcess() {
      // Get level before process to detect level up
      const pBefore = await loadPlayerProgress();
      const levelBefore = getPlayerLevelInfo(pBefore.totalXp).level;

      const res = await processBattleResult(battleId, finalState, stageId);
      
      const pAfter = await loadPlayerProgress();
      const levelAfter = getPlayerLevelInfo(pAfter.totalXp).level;
      
      if (levelAfter > levelBefore) {
        setLevelUpInfo({ from: levelBefore, to: levelAfter });
      }
      
      if (res && isVictory) {
        const next = getNextStage(stageId);
        if (next) setNextStageId(next);
      }
      
      // Even if res is null (already processed), we can still display finalState stats
      setResultData(res || { xpEarned: 0, isFirstClear: false, isPerfect: false, earnedStars: 0 });
    }
    doProcess();
  }, [battleId]);

  const handleReplay = () => {
    navigation.replace('StagePreview', { stageId });
  };

  const handleNext = () => {
    if (nextStageId) {
      navigation.replace('StagePreview', { stageId: nextStageId });
    } else {
      navigation.navigate('Adventure');
    }
  };

  const handleBack = () => {
    navigation.navigate('Adventure');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: isVictory ? theme.colors.success : theme.colors.danger }]}>
        {isVictory ? (stage.type === 'BOSS' ? 'BOSS DEFEATED!' : 'VICTORY') : 'DEFEAT'}
      </Text>
      
      <Text style={styles.stageTitle}>{stage.title}</Text>

      {resultData && (
        <View style={styles.starsContainer}>
          <Text style={styles.starsText}>
            {'★'.repeat(resultData.earnedStars)}{'☆'.repeat(3 - resultData.earnedStars)}
          </Text>
        </View>
      )}

      {levelUpInfo && (
        <View style={styles.levelUpBox}>
          <Text style={styles.levelUpText}>LEVEL UP!</Text>
          <Text style={styles.levelUpSub}>Level {levelUpInfo.from} → Level {levelUpInfo.to}</Text>
        </View>
      )}

      {resultData && resultData.xpEarned > 0 && (
        <Text style={styles.xpText}>+{resultData.xpEarned} XP</Text>
      )}

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
        {isVictory && nextStageId && (
          <TouchableOpacity style={styles.btnPrimary} onPress={handleNext}>
            <Text style={styles.btnTextPrimary}>Next Stage</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.btnSecondary} onPress={handleReplay}>
          <Text style={styles.btnTextSecondary}>{isVictory ? 'Replay' : 'Retry'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnSecondary} onPress={handleBack}>
          <Text style={styles.btnTextSecondary}>Back to Adventure</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.large,
    alignItems: 'center',
    paddingBottom: 60,
  },
  title: {
    fontSize: 40,
    fontWeight: 'bold',
    marginBottom: theme.spacing.small,
    marginTop: 40,
    textAlign: 'center',
  },
  stageTitle: {
    fontSize: 24,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.medium,
  },
  starsContainer: {
    alignItems: 'center',
    marginBottom: theme.spacing.medium,
  },
  starsText: {
    fontSize: 32,
    color: '#D69E2E',
  },
  levelUpBox: {
    backgroundColor: '#FAF089',
    padding: theme.spacing.medium,
    borderRadius: 8,
    marginBottom: theme.spacing.medium,
    alignItems: 'center',
    width: '100%',
  },
  levelUpText: {
    color: '#975A16',
    fontWeight: 'bold',
    fontSize: 24,
  },
  levelUpSub: {
    color: '#975A16',
    fontSize: 18,
  },
  xpText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.primary,
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
    marginBottom: theme.spacing.medium,
  },
  btnTextSecondary: {
    color: theme.colors.primary,
    fontSize: 18,
    fontWeight: 'bold',
  },
});
