import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme';
import { getWorlds, getStagesForWorld, STAGE_TYPES } from '../domain/adventure/campaignConfig';
import { loadCampaignProgress } from '../storage/campaignStorage';
import { isStageUnlocked, isWorldCompleted, isCampaignCompleted } from '../domain/adventure/campaignProgress';
import { useTranslation } from 'react-i18next';

export default function AdventureScreen({ navigation }) {
  const [progress, setProgress] = useState(null);
  const { t } = useTranslation();

  useFocusEffect(
    useCallback(() => {
      loadCampaignProgress().then(setProgress);
    }, [])
  );

  if (!progress) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  const handleSelectStage = (stageId) => {
    navigation.navigate('StagePreview', { stageId });
  };

  const campaignDone = isCampaignCompleted(progress);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('navigation.adventure')}</Text>
      
      {campaignDone && (
        <View style={styles.campaignCompleteBox}>
          <Text style={styles.campaignCompleteText}>{t('battleResult.adventureComplete')}</Text>
        </View>
      )}

      {getWorlds().map(world => {
        const worldCompleted = isWorldCompleted(progress, world);
        // Only show world if its first stage is unlocked
        const firstStageId = `L${world}-S1`;
        if (!isStageUnlocked(progress, firstStageId) && world !== 1) {
          return (
            <View key={world} style={styles.lockedWorld}>
              <Text style={styles.lockedWorldText}>{t('adventure.world')} {world} {t('adventure.locked')}</Text>
            </View>
          );
        }

        return (
          <View key={world} style={styles.worldContainer}>
            <Text style={styles.worldTitle}>{t('adventure.world')} {world}</Text>
            {worldCompleted && <Text style={styles.worldCompletedText}>{t('adventure.unlocked')}</Text>}
            <View style={styles.divider} />
            
            {getStagesForWorld(world).map((stage, index) => {
              const unlocked = isStageUnlocked(progress, stage.id);
              const stars = progress.stageStars[stage.id] || 0;
              const isBoss = stage.type === STAGE_TYPES.BOSS;
              const isElite = stage.type === STAGE_TYPES.ELITE;

              let icon = '●';
              if (progress.clearedStages.includes(stage.id)) icon = '✓';
              else if (!unlocked) icon = '🔒';

              let starString = '';
              if (unlocked && (progress.clearedStages.includes(stage.id) || stars > 0)) {
                starString = '★'.repeat(stars) + '☆'.repeat(3 - stars);
              }

              let stageColor = theme.colors.textMain;
              if (isBoss) stageColor = theme.colors.danger;
              else if (isElite) stageColor = '#DD6B20'; // Orange
              
              if (!unlocked) stageColor = theme.colors.textMuted;

              let stageName = stage.title;
              if (stage.type === STAGE_TYPES.NORMAL) {
                stageName = `${t('adventure.stage')} ${stage.stageNumber}`;
              } else if (stage.type === STAGE_TYPES.ELITE) {
                stageName = t('adventure.eliteGatekeeper');
              } else if (stage.type === STAGE_TYPES.BOSS) {
                stageName = t('adventure.boss');
              }

              return (
                <View key={stage.id} style={styles.stageRow}>
                  <TouchableOpacity 
                    style={styles.stageBtn}
                    disabled={!unlocked}
                    onPress={() => handleSelectStage(stage.id)}
                  >
                    <Text style={[styles.stageIcon, { color: stageColor }]}>{icon}</Text>
                    <Text style={[styles.stageName, { color: stageColor }]}>
                      {stageName}
                    </Text>
                    <Text style={styles.stageStars}>{starString}</Text>
                  </TouchableOpacity>
                  {index < 4 && <View style={styles.pathLine} />}
                </View>
              );
            })}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.medium,
    paddingBottom: 100,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginVertical: theme.spacing.large,
  },
  campaignCompleteBox: {
    backgroundColor: '#C6F6D5',
    padding: theme.spacing.medium,
    borderRadius: 8,
    marginBottom: theme.spacing.large,
    alignItems: 'center',
  },
  campaignCompleteText: {
    color: '#22543D',
    fontWeight: 'bold',
    fontSize: 18,
  },
  worldContainer: {
    marginBottom: theme.spacing.large,
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: theme.spacing.large,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  worldTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  worldCompletedText: {
    color: theme.colors.success,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.medium,
  },
  lockedWorld: {
    marginBottom: theme.spacing.large,
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: theme.spacing.large,
    alignItems: 'center',
    opacity: 0.5,
  },
  lockedWorldText: {
    fontSize: 18,
    color: theme.colors.textMuted,
    fontWeight: 'bold',
  },
  stageRow: {
    flexDirection: 'column',
  },
  stageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  stageIcon: {
    fontSize: 18,
    width: 30,
    textAlign: 'center',
  },
  stageName: {
    fontSize: 18,
    flex: 1,
  },
  stageStars: {
    fontSize: 16,
    color: '#D69E2E',
  },
  pathLine: {
    width: 2,
    height: 20,
    backgroundColor: theme.colors.border,
    marginLeft: 14,
  }
});
