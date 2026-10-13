import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme';
import { getStageById, STAGE_TYPES } from '../domain/adventure/campaignConfig';
import { loadCampaignProgress } from '../storage/campaignStorage';
import { useTranslation } from 'react-i18next';

export default function StagePreviewScreen({ route, navigation }) {
  const { t } = useTranslation();
  const { stageId } = route.params;
  const stage = getStageById(stageId);
  const [bestStars, setBestStars] = useState(0);

  useEffect(() => {
    loadCampaignProgress().then(progress => {
      setBestStars(progress.stageStars[stageId] || 0);
    });
  }, [stageId]);

  if (!stage) {
    return <View style={styles.container}><Text>Stage not found.</Text></View>;
  }

  const isBoss = stage.type === STAGE_TYPES.BOSS;
  const isElite = stage.type === STAGE_TYPES.ELITE;
  
  let typeColor = theme.colors.primary;
  if (isBoss) typeColor = theme.colors.danger;
  else if (isElite) typeColor = '#DD6B20'; // Orange

  const handleStart = () => {
    navigation.navigate('Battle', { stageId });
  };

  const handleBack = () => {
    navigation.goBack();
  };

  let stageName = stage.title;
  if (stage.type === STAGE_TYPES.NORMAL) {
    stageName = `${t('adventure.stage')} ${stage.stageNumber}`;
  } else if (stage.type === STAGE_TYPES.ELITE) {
    stageName = t('adventure.eliteGatekeeper');
  } else if (stage.type === STAGE_TYPES.BOSS) {
    stageName = t('adventure.boss');
  }

  return (
    <View style={styles.container}>
      <View style={[styles.card, { borderColor: typeColor }]}>
        <Text style={[styles.title, { color: typeColor }]}>{stageName}</Text>
        <Text style={styles.subtitle}>{t('adventure.world')} {stage.world} - {t('adventure.level')} {stage.vocabularyLevel}</Text>
        
        <View style={styles.statsContainer}>
          <Text style={styles.statText}>{t('stagePreview.playerHp')}: {stage.playerHp}</Text>
          <Text style={styles.statText}>{t('stagePreview.enemyHp')}: {stage.enemyHp}</Text>
          <Text style={styles.statText}>{t('stagePreview.timer')}: {stage.timePerQuestionMs / 1000}s</Text>
        </View>

        <View style={styles.starsContainer}>
          <Text style={styles.starsText}>
            Best: {'★'.repeat(bestStars)}{'☆'.repeat(3 - bestStars)}
          </Text>
        </View>

        <TouchableOpacity style={[styles.startBtn, { backgroundColor: typeColor }]} onPress={handleStart}>
          <Text style={styles.startBtnText}>{t('adventure.startBattle')}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backBtnText}>{t('battleResult.backToAdventure')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    justifyContent: 'center',
    padding: theme.spacing.large,
  },
  card: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: theme.spacing.small,
  },
  subtitle: {
    fontSize: 18,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.large,
  },
  statsContainer: {
    width: '100%',
    backgroundColor: theme.colors.background,
    padding: theme.spacing.medium,
    borderRadius: 8,
    marginBottom: theme.spacing.large,
  },
  statText: {
    fontSize: 16,
    color: theme.colors.textMain,
    marginBottom: 4,
    textAlign: 'center',
  },
  starsContainer: {
    marginBottom: theme.spacing.large,
  },
  starsText: {
    fontSize: 24,
    color: '#D69E2E', // Gold
  },
  startBtn: {
    width: '100%',
    padding: theme.spacing.medium,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: theme.spacing.medium,
  },
  startBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  backBtn: {
    padding: theme.spacing.medium,
  },
  backBtnText: {
    color: theme.colors.textMuted,
    fontSize: 16,
  }
});
