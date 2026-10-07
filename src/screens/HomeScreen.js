import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme';
import { loadPlayerProgress } from '../storage/playerProgressStorage';
import { getPlayerLevelInfo } from '../domain/player/levelSystem';
import { loadMistakes, getActiveMistakes } from '../storage/mistakeStorage';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';

export default function HomeScreen({ navigation }) {
  const [playerInfo, setPlayerInfo] = useState(null);
  const [mistakeCount, setMistakeCount] = useState(0);
  const { user, isSignedIn } = useAuth();
  const { t } = useTranslation();

  useFocusEffect(
    useCallback(() => {
      async function loadData() {
        const p = await loadPlayerProgress();
        setPlayerInfo(p);
        
        const mObj = await loadMistakes();
        const active = getActiveMistakes(mObj);
        setMistakeCount(active.length);
      }
      loadData();
    }, [])
  );

  if (!playerInfo) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  const { level, xpIntoCurrentLevel, xpRequiredForNextLevel, progressRatio } = getPlayerLevelInfo(playerInfo.totalXp);
  const { streak, missions } = playerInfo.daily;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Knowledge King</Text>

      {/* Level Card */}
      <View style={styles.levelCard}>
        <Text style={styles.identityText}>{isSignedIn ? user?.displayName : t('home.guest')}</Text>
        <Text style={styles.levelTitle}>{t('home.playerLevel')} {level}</Text>
        <Text style={styles.xpText}>{Math.floor(xpIntoCurrentLevel)} / {xpRequiredForNextLevel} {t('home.xp')}</Text>
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: `${progressRatio * 100}%` }]} />
        </View>
        <Text style={styles.streakText}>🔥 {t('home.streak')}: {streak}</Text>
      </View>

      {/* Quick Actions */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Adventure')}>
          <Text style={styles.actionBtnText}>{t('home.continueAdventure')}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.actionBtn, mistakeCount === 0 && styles.actionBtnDisabled]}
          onPress={() => mistakeCount > 0 && navigation.navigate('MistakeReview')}
          disabled={mistakeCount === 0}
        >
          <Text style={styles.actionBtnText}>{t('home.mistakeReview')} ({mistakeCount})</Text>
        </TouchableOpacity>
      </View>

      {/* Daily Missions */}
      <View style={styles.missionsCard}>
        <Text style={styles.sectionTitle}>{t('home.dailyMissions')}</Text>
        
        <MissionRow 
          title={t('dailyMissions.answer20')}
          progress={missions.m1.progress} 
          target={20} 
          claimed={missions.m1.claimed} 
          reward="+30 XP" 
        />
        <MissionRow 
          title={t('dailyMissions.win2')}
          progress={missions.m2.progress} 
          target={2} 
          claimed={missions.m2.claimed} 
          reward="+40 XP" 
        />
        <MissionRow 
          title={t('dailyMissions.perfectVictory')}
          progress={missions.m3.progress} 
          target={1} 
          claimed={missions.m3.claimed} 
          reward="+50 XP" 
        />
      </View>
    </ScrollView>
  );
}

function MissionRow({ title, progress, target, claimed, reward }) {
  const isDone = claimed || progress >= target;
  return (
    <View style={styles.missionRow}>
      <View style={styles.missionInfo}>
        <Text style={[styles.missionTitle, isDone && styles.missionDone]}>{title}</Text>
        <Text style={styles.missionProgress}>{isDone ? 'COMPLETED' : `${progress} / ${target}`}</Text>
      </View>
      <View style={styles.missionReward}>
        <Text style={styles.rewardText}>{isDone ? '✓' : reward}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.large,
    paddingTop: 60,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: theme.spacing.large,
  },
  levelCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.large,
  },
  identityText: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  levelTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: 4,
  },
  xpText: {
    fontSize: 16,
    color: theme.colors.textMuted,
    marginBottom: 12,
  },
  progressBarBg: {
    height: 12,
    backgroundColor: theme.colors.border,
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: theme.colors.primary,
  },
  streakText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#DD6B20', // Orange
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.large,
  },
  actionBtn: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.medium,
    borderRadius: 8,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  actionBtnDisabled: {
    backgroundColor: theme.colors.border,
  },
  actionBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  missionsCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: theme.spacing.medium,
  },
  missionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  missionInfo: {
    flex: 1,
  },
  missionTitle: {
    fontSize: 16,
    color: theme.colors.textMain,
  },
  missionDone: {
    color: theme.colors.textMuted,
    textDecorationLine: 'line-through',
  },
  missionProgress: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginTop: 4,
  },
  missionReward: {
    paddingLeft: theme.spacing.medium,
  },
  rewardText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.success,
  }
});
