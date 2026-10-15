/**
 * ROGUE EXPEDITION V0.1 — REST NODE SCREEN
 *
 * Provides the strategic choice at a REST node:
 * - RECOVER: Restore 30 HP (clamped to max HP).
 * - CLEANSE: Reduce 1 stack from highest-priority Cursed Word (or fully purify if 1 stack).
 *
 * Persists immediately and resolves the node before returning to RogueMap.
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
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { loadActiveRogueRun } from '../storage/rogueRunStorage';
import { submitRestAction } from '../services/rogue/rogueRunService';
import { REST_ACTIONS, REST_HEAL_AMOUNT } from '../domain/rogue/rest/restResolver';
import { selectCursedWordForReview } from '../domain/rogue/curse/cursedWordModel';
import { RELIC_IDS } from '../domain/rogue/relic/relicRegistry';

export default function RogueRestScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [run, setRun] = useState(null);

  const fetchRun = useCallback(async () => {
    try {
      setLoading(true);
      const activeRun = await loadActiveRogueRun();
      if (!activeRun) {
        navigation.navigate('RogueHome');
        return;
      }

      if (
        activeRun.status === 'VICTORY' ||
        activeRun.status === 'DEFEAT'
      ) {
        navigation.navigate('RogueResult');
        return;
      }

      if (
        !activeRun.pendingInteraction ||
        activeRun.pendingInteraction.type !== 'REST'
      ) {
        navigation.navigate('RogueMap');
        return;
      }

      setRun(activeRun);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to load Rest site');
      navigation.navigate('RogueMap');
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  const handleAction = async (actionType) => {
    if (submitting || !run) return;

    try {
      setSubmitting(true);
      const result = await submitRestAction({ actionType });

      if (result.success) {
        navigation.navigate('RogueMap');
      } else {
        Alert.alert('Action Error', result.reason || 'Failed to resolve Rest choice');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to submit Rest choice');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !run) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10B981" />
      </View>
    );
  }

  const playerHp = run.player.hp;
  const playerMaxHp = run.player.maxHp;
  const hpPercent = Math.max(0, Math.min(100, (playerHp / playerMaxHp) * 100));

  const cursedWords = run.cursedWords || [];
  const highestCurse = selectCursedWordForReview(cursedWords);
  const hasCurses = cursedWords.length > 0 && highestCurse !== null;
  const hasPurifyingInk = run.relics?.includes(RELIC_IDS.PURIFYING_INK);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.titleIcon}>🌿</Text>
        <Text style={styles.title}>
          {t('rogue.rest.title', 'Rest Site')}
        </Text>
        <Text style={styles.subtitle}>
          {t(
            'rogue.rest.desc',
            'A quiet sanctuary to tend wounds or cleanse lingering verbal curses.'
          )}
        </Text>
      </View>

      {/* Player Status Card */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>
            {t('rogue.hp', 'HP')}: {playerHp} / {playerMaxHp}
          </Text>
          <Text style={styles.curseCountText}>
            ☠️ {cursedWords.length} {t('rogue.curse.cursedCountLabel', 'Curses')}
          </Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${hpPercent}%` }]} />
        </View>
      </View>

      {/* Choices */}
      <View style={styles.choicesList}>
        {/* RECOVER OPTION */}
        <TouchableOpacity
          style={styles.choiceCard}
          onPress={() => handleAction(REST_ACTIONS.RECOVER)}
          disabled={submitting}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Recover HP"
        >
          <View style={styles.choiceHeader}>
            <Text style={styles.choiceIcon}>💖</Text>
            <View style={styles.choiceMeta}>
              <Text style={styles.choiceTitle}>
                {t('rogue.rest.recoverTitle', 'Recover')}
              </Text>
              <Text style={styles.choiceBadge}>+{REST_HEAL_AMOUNT} HP</Text>
            </View>
          </View>
          <Text style={styles.choiceDesc}>
            {t(
              'rogue.rest.recoverDesc',
              'Tend to your wounds and restore up to 30 HP.'
            )}
          </Text>
        </TouchableOpacity>

        {/* CLEANSE OPTION */}
        <TouchableOpacity
          style={[styles.choiceCard, !hasCurses && styles.choiceCardDisabled]}
          onPress={() => handleAction(REST_ACTIONS.CLEANSE)}
          disabled={submitting || !hasCurses}
          activeOpacity={hasCurses ? 0.7 : 1}
          accessibilityRole="button"
          accessibilityLabel="Cleanse Curse"
        >
          <View style={styles.choiceHeader}>
            <Text style={styles.choiceIcon}>✨</Text>
            <View style={styles.choiceMeta}>
              <Text style={[styles.choiceTitle, !hasCurses && styles.choiceTitleDisabled]}>
                {t('rogue.rest.cleanseTitle', 'Cleanse')}
              </Text>
              {hasCurses ? (
                <Text style={styles.cleanseBadge}>
                  -1 {t('rogue.curse.curseLevelShort', 'Level')}
                </Text>
              ) : (
                <Text style={styles.disabledBadge}>
                  {t('rogue.rest.noCurses', 'No Curses')}
                </Text>
              )}
            </View>
          </View>

          {hasCurses ? (
            <View>
              <Text style={styles.choiceDesc}>
                {t('rogue.rest.cleanseTarget', 'Reduce 1 curse stack from "{{word}}" (Level {{level}}).', {
                  word: highestCurse.word || highestCurse.wordId,
                  level: highestCurse.stacks,
                })}
              </Text>
              {highestCurse.stacks === 1 && (
                <Text style={styles.purifyHighlight}>
                  {hasPurifyingInk
                    ? '✨ Will fully purify! Purifying Ink will restore +10 HP.'
                    : '✨ Will fully purify and remove this curse!'}
                </Text>
              )}
            </View>
          ) : (
            <Text style={styles.choiceDescDisabled}>
              {t('rogue.rest.cleanseDisabledDesc', 'You have no cursed words to cleanse.')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {submitting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#10B981" />
          <Text style={styles.loadingText}>Resting...</Text>
        </View>
      )}
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
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  titleIcon: {
    fontSize: 44,
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: '#F8FAFC',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 18,
  },
  statusCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  curseCountText: {
    color: '#CBD5E1',
    fontSize: 13,
    fontWeight: '600',
  },
  barTrack: {
    height: 8,
    backgroundColor: '#334155',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#10B981',
  },
  choicesList: {
    gap: 16,
  },
  choiceCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#10B98160',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  choiceCardDisabled: {
    borderColor: '#334155',
    opacity: 0.5,
  },
  choiceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  choiceIcon: {
    fontSize: 30,
    marginRight: 14,
  },
  choiceMeta: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  choiceTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  choiceTitleDisabled: {
    color: '#64748B',
  },
  choiceBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#10B981',
    fontSize: 11,
    fontWeight: '800',
    color: '#34D399',
  },
  cleanseBadge: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#A855F7',
    fontSize: 11,
    fontWeight: '800',
    color: '#C084FC',
  },
  disabledBadge: {
    backgroundColor: '#334155',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  choiceDesc: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
  choiceDescDisabled: {
    fontSize: 13,
    color: '#64748B',
  },
  purifyHighlight: {
    fontSize: 12,
    color: '#34D399',
    fontWeight: '700',
    marginTop: 6,
  },
  loadingOverlay: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#34D399',
    fontSize: 14,
    fontWeight: '600',
  },
});
