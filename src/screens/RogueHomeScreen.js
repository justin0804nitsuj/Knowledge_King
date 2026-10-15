import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { loadActiveRun, createNewRun, abandonRun } from '../services/rogue/rogueRunService';
import { isRunActive, ROGUE_RUN_STATUS } from '../domain/rogue/rogueRun';

export default function RogueHomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [activeRun, setActiveRun] = useState(null);
  const [customSeed, setCustomSeed] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const fetchRun = useCallback(async () => {
    try {
      setLoading(true);
      const run = await loadActiveRun();
      setActiveRun(run);
    } catch (err) {
      console.warn('[RogueHomeScreen] Error loading run:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchRun();
    }, [fetchRun])
  );

  const handleStartNewRun = async (overrideSeed) => {
    try {
      setActionLoading(true);
      const seedToUse = overrideSeed || (customSeed.trim() ? customSeed.trim() : Date.now());
      const newRun = await createNewRun({ seed: seedToUse });
      setActiveRun(newRun);
      navigation.navigate('RogueMap');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to start new expedition');
    } finally {
      setActionLoading(false);
    }
  };

  const handleContinueRun = () => {
    if (
      activeRun?.status === ROGUE_RUN_STATUS.VICTORY ||
      activeRun?.status === ROGUE_RUN_STATUS.DEFEAT
    ) {
      navigation.navigate('RogueResult');
    } else if (activeRun?.pendingReward && activeRun.pendingReward.type === 'RELIC_DRAFT') {
      navigation.navigate('RogueRelicReward');
    } else if (activeRun?.encounter && activeRun.encounter.status === 'ACTIVE') {
      navigation.navigate('RogueBattle');
    } else if (activeRun?.pendingInteraction && !activeRun.pendingInteraction.resolved) {
      if (activeRun.pendingInteraction.type === 'REST') {
        navigation.navigate('RogueRest');
      } else if (activeRun.pendingInteraction.type === 'EVENT') {
        navigation.navigate('RogueEvent');
      } else {
        navigation.navigate('RogueMap');
      }
    } else {
      navigation.navigate('RogueMap');
    }
  };

  const handleAbandonRun = () => {
    Alert.alert(
      t('rogue.abandonExpedition', 'Abandon Expedition'),
      t('rogue.confirmAbandon', 'Are you sure you want to abandon this expedition?'),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('rogue.abandonExpedition', 'Abandon'),
          style: 'destructive',
          onPress: async () => {
            try {
              setActionLoading(true);
              const updated = await abandonRun();
              setActiveRun(updated);
            } catch (err) {
              Alert.alert('Error', err.message || 'Failed to abandon run');
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  const hasActiveRun = isRunActive(activeRun);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color="#E2E8F0" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('rogue.title', 'Rogue Expedition')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <Text style={styles.subtitle}>
        {t('rogue.subtitle', 'Branching Roguelike Vocabulary Adventure')}
      </Text>

      {/* Active Run Card */}
      {hasActiveRun ? (
        <View style={styles.activeCard}>
          <View style={styles.badgeRow}>
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>ACTIVE EXPEDITION</Text>
            </View>
            <Text style={styles.seedText}>Seed: #{activeRun.seed}</Text>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>HP</Text>
              <Text style={styles.statValue}>
                {activeRun.player.hp} / {activeRun.player.maxHp}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Nodes Visited</Text>
              <Text style={styles.statValue}>
                {activeRun.route.visitedNodeIds?.length || 1}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Current Node</Text>
              <Text style={styles.statValue}>{activeRun.currentNodeId}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>{t('rogue.curse.cursedCountLabel', 'Curses')}</Text>
              <Text style={styles.statValue}>☠️ {activeRun.cursedWords?.length || 0}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>{t('rogue.relics.relicsCountLabel', 'Relics')}</Text>
              <Text style={styles.statValue}>🏺 {activeRun.relics?.length || 0}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={handleContinueRun}
            disabled={actionLoading}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>
              {t('rogue.continueExpedition', 'Continue Expedition')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => handleStartNewRun()}
            disabled={actionLoading}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryBtnText}>
              {t('rogue.startNewRun', 'Restart New Run')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.dangerBtn}
            onPress={handleAbandonRun}
            disabled={actionLoading}
            accessibilityRole="button"
          >
            <Text style={styles.dangerBtnText}>
              {t('rogue.abandonExpedition', 'Abandon Expedition')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.newRunCard}>
          {activeRun && activeRun.status !== ROGUE_RUN_STATUS.ACTIVE && (
            <View style={styles.priorRunBanner}>
              <Text style={styles.priorRunText}>
                Prior Run: {activeRun.status} (Seed: #{activeRun.seed})
              </Text>
              {(activeRun.status === ROGUE_RUN_STATUS.VICTORY ||
                activeRun.status === ROGUE_RUN_STATUS.DEFEAT) && (
                <TouchableOpacity
                  style={styles.viewSummaryBtn}
                  onPress={() => navigation.navigate('RogueResult')}
                  accessibilityRole="button"
                >
                  <Text style={styles.viewSummaryBtnText}>
                    {t('rogue.result.viewSummaryBtn', 'View Results')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={styles.cardTitle}>
            {t('rogue.newExpedition', 'Start New Expedition')}
          </Text>
          <Text style={styles.cardDesc}>
            Venture into procedural labyrinth rows. Choose your route carefully to reach the
            Expedition Boss!
          </Text>

          <View style={styles.seedInputContainer}>
            <Text style={styles.inputLabel}>Custom Seed (Optional):</Text>
            <TextInput
              style={styles.seedInput}
              value={customSeed}
              onChangeText={setCustomSeed}
              placeholder="e.g. 12345 or adventure-seed"
              placeholderTextColor="#64748B"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => handleStartNewRun()}
            disabled={actionLoading}
            accessibilityRole="button"
          >
            <Text style={styles.primaryBtnText}>
              {t('rogue.startNewRun', 'Begin Expedition')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Rules & Architecture Summary */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Expedition Mechanics</Text>
        <Text style={styles.infoText}>• Single-player offline branching run</Text>
        <Text style={styles.infoText}>• Deterministic seeded map generation</Text>
        <Text style={styles.infoText}>• Forward-only navigation towards the Boss</Text>
        <Text style={styles.infoText}>• Local account-scoped run persistence</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  content: {
    padding: 20,
    paddingTop: 50,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
  },
  activeCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#3B82F6',
    marginBottom: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  activeBadge: {
    backgroundColor: '#10B981',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  activeBadgeText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  seedText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 11,
    marginBottom: 4,
  },
  statValue: {
    color: '#F8FAFC',
    fontWeight: 'bold',
    fontSize: 14,
  },
  primaryBtn: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  secondaryBtn: {
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryBtnText: {
    color: '#E2E8F0',
    fontSize: 14,
    fontWeight: '600',
  },
  dangerBtn: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  dangerBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
  },
  newRunCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  priorRunBanner: {
    backgroundColor: '#334155',
    borderRadius: 8,
    padding: 10,
    marginBottom: 16,
  },
  priorRunText: {
    color: '#CBD5E1',
    fontSize: 12,
    textAlign: 'center',
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  cardDesc: {
    color: '#94A3B8',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  seedInputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    color: '#CBD5E1',
    fontSize: 13,
    marginBottom: 6,
  },
  seedInput: {
    backgroundColor: '#0F172A',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#475569',
    color: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  infoCard: {
    backgroundColor: '#1E293B80',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  infoTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  infoText: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 4,
  },
  priorRunBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F172A',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  priorRunText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '500',
  },
  viewSummaryBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  viewSummaryBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
