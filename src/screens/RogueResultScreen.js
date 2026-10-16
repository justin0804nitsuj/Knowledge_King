/**
 * ROGUE EXPEDITION V0.1 — RUN RESULT SCREEN
 *
 * Displays the final expedition summary for VICTORY and DEFEAT runs:
 * - Victory / Defeat header
 * - Stable snapshot statistics (HP, Seed, Nodes, Battles, Accuracy, Relics, Curses)
 * - Safe zero-accuracy handling
 * - Action to start a clean New Expedition or return to Expedition Home
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { loadActiveRun, createNewRun } from '../services/rogue/rogueRunService';
import { createRunSummary, ROGUE_RUN_STATUS } from '../domain/rogue/rogueRun';
import { getRelic } from '../domain/rogue/relic/relicRegistry';

export default function RogueResultScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [run, setRun] = useState(null);
  const [summary, setSummary] = useState(null);

  const fetchRun = useCallback(async () => {
    try {
      setLoading(true);
      const activeRun = await loadActiveRun();
      if (!activeRun) {
        navigation.navigate('RogueHome');
        return;
      }

      setRun(activeRun);
      const stableSummary = activeRun.finalSummary || createRunSummary(activeRun);
      setSummary(stableSummary);
    } catch (err) {
      console.warn('[RogueResultScreen] Error loading run summary:', err);
      navigation.navigate('RogueHome');
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useFocusEffect(
    useCallback(() => {
      fetchRun();
    }, [fetchRun])
  );

  const handleStartNewRun = async () => {
    try {
      setSubmitting(true);
      await createNewRun();
      navigation.navigate('RogueMap');
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to start new expedition');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnHome = () => {
    navigation.navigate('RogueHome');
  };

  if (loading || !summary) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  const isVictory = summary.result === ROGUE_RUN_STATUS.VICTORY;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.navigate('MainTabs', { screen: 'Home' })}
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
        >
          <Ionicons name="arrow-back" size={20} color="#E2E8F0" />
          <Text style={styles.backBtnLabel}>
            {t('rogue.backToMainHome', '← Home')}
          </Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
      </View>

      {/* Header Banner */}
      <View style={[styles.resultCard, isVictory ? styles.victoryCard : styles.defeatCard]}>
        <Text style={styles.resultIcon}>{isVictory ? '🏆' : '💀'}</Text>
        <Text style={styles.resultTitle}>
          {isVictory
            ? t('rogue.result.victoryTitle', 'Expedition Complete')
            : t('rogue.result.defeatTitle', 'Expedition Failed')}
        </Text>
        <Text style={styles.resultSubtitle}>
          {isVictory
            ? t('rogue.result.victorySubtitle', 'The Labyrinth Overlord has been vanquished!')
            : t('rogue.result.defeatSubtitle', 'Your expedition ended in the depths of the labyrinth.')}
        </Text>
      </View>

      {/* Statistics Card */}
      <View style={styles.statsCard}>
        <Text style={styles.statsCardTitle}>
          {t('rogue.result.summaryTitle', 'Expedition Summary')}
        </Text>

        <View style={styles.grid}>
          {/* Seed */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('rogue.result.seed', 'Seed')}</Text>
            <Text style={styles.statValue}>#{summary.seed}</Text>
          </View>

          {/* Final HP */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('rogue.result.finalHp', 'Final HP')}</Text>
            <Text style={[styles.statValue, isVictory ? styles.hpVictory : styles.hpDefeat]}>
              ❤️ {summary.finalHp} / {summary.maxHp}
            </Text>
          </View>

          {/* Nodes Visited */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('rogue.result.nodesVisited', 'Nodes Visited')}</Text>
            <Text style={styles.statValue}>🧭 {summary.nodesVisited}</Text>
          </View>

          {/* Battles Won */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('rogue.result.battlesWon', 'Battles Won')}</Text>
            <Text style={styles.statValue}>⚔️ {summary.battlesWon}</Text>
          </View>

          {/* Correct Answers */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('rogue.result.correctAnswers', 'Correct Answers')}</Text>
            <Text style={styles.statValue}>✅ {summary.correctAnswers}</Text>
          </View>

          {/* Wrong Answers */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('rogue.result.wrongAnswers', 'Wrong Answers')}</Text>
            <Text style={styles.statValue}>❌ {summary.wrongAnswers}</Text>
          </View>

          {/* Accuracy */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('rogue.result.accuracy', 'Accuracy')}</Text>
            <Text style={styles.statValue}>🎯 {summary.accuracy}%</Text>
          </View>

          {/* Curses Remaining */}
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>
              {t('rogue.result.cursesRemaining', 'Cursed Words Remaining')}
            </Text>
            <Text style={styles.statValue}>☠️ {summary.cursesRemaining}</Text>
          </View>
        </View>

        {/* Relics Section */}
        <View style={styles.relicsSection}>
          <Text style={styles.relicsSectionTitle}>
            {t('rogue.result.relicsCollected', 'Relics Collected')} ({summary.relics?.length || 0})
          </Text>
          {summary.relics && summary.relics.length > 0 ? (
            <View style={styles.relicsList}>
              {summary.relics.map((relicId) => {
                const relic = getRelic(relicId);
                return (
                  <View key={relicId} style={styles.relicPill}>
                    <Text style={styles.relicPillIcon}>{relic?.icon || '🏺'}</Text>
                    <Text style={styles.relicPillText}>
                      {relic?.nameKey ? t(relic.nameKey, relic.defaultName) : relicId}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyRelicsText}>
              {t('rogue.result.noRelics', 'No relics were collected during this run.')}
            </Text>
          )}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={handleStartNewRun}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Start New Expedition"
        >
          {submitting ? (
            <ActivityIndicator color="#0F172A" />
          ) : (
            <Text style={styles.primaryBtnText}>
              {t('rogue.result.newExpedition', 'New Expedition')}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryBtn}
          onPress={handleReturnHome}
          disabled={submitting}
          accessibilityRole="button"
          accessibilityLabel="Return to Expedition Menu"
        >
          <Text style={styles.secondaryBtnText}>
            {t('rogue.result.returnHome', 'Expedition Menu')}
          </Text>
        </TouchableOpacity>
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
    paddingTop: 45,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  resultCard: {
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
  },
  victoryCard: {
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#F59E0B',
  },
  defeatCard: {
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#EF4444',
  },
  resultIcon: {
    fontSize: 54,
    marginBottom: 10,
  },
  resultTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: '#F8FAFC',
    marginBottom: 6,
    textAlign: 'center',
  },
  resultSubtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
  },
  statsCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statsCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statBox: {
    width: '48%',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statLabel: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 4,
  },
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  hpVictory: {
    color: '#34D399',
  },
  hpDefeat: {
    color: '#EF4444',
  },
  relicsSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 16,
  },
  relicsSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E2E8F0',
    marginBottom: 10,
  },
  relicsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  relicPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#475569',
  },
  relicPillIcon: {
    fontSize: 16,
    marginRight: 6,
  },
  relicPillText: {
    fontSize: 13,
    color: '#CBD5E1',
    fontWeight: '500',
  },
  emptyRelicsText: {
    fontSize: 13,
    color: '#64748B',
    fontStyle: 'italic',
  },
  actions: {
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryBtn: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  backBtnLabel: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 4,
  },
});
