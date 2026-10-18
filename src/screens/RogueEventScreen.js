/**
 * ROGUE EXPEDITION V0.1 — EVENT NODE SCREEN
 *
 * Dedicated UI for narrative and choice-driven Mystery Events (Phase R6).
 * Renders data-driven event options with clear effect previews and affordability checks.
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
import { Ionicons } from '@expo/vector-icons';
import { loadActiveRogueRun } from '../storage/rogueRunStorage';
import { submitEventAction } from '../services/rogue/rogueRunService';
import { getEvent, EVENT_EFFECT_TYPES } from '../domain/rogue/event/eventRegistry';
import { selectCursedWordForReview } from '../domain/rogue/curse/cursedWordModel';

export default function RogueEventScreen() {
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
        activeRun.pendingInteraction.type !== 'EVENT'
      ) {
        navigation.navigate('RogueMap');
        return;
      }

      setRun(activeRun);
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to load Event');
      navigation.navigate('RogueMap');
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  const handleSelectOption = async (optionId) => {
    if (submitting || !run) return;

    try {
      setSubmitting(true);
      const result = await submitEventAction({ optionId });

      if (result.success) {
        navigation.navigate('RogueMap');
      } else {
        Alert.alert('Action Error', result.reason || 'Failed to resolve event choice');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to submit event choice');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !run) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  const eventDef = getEvent(run.pendingInteraction?.eventId);
  const eventName = eventDef
    ? t(eventDef.nameKey, eventDef.defaultName)
    : 'Unknown Mystery';
  const eventDesc = eventDef
    ? t(eventDef.descriptionKey, eventDef.defaultDesc)
    : 'An enigmatic presence lingers here.';
  const eventIcon = eventDef?.icon || '❓';
  const options = eventDef?.options || [];

  const playerHp = run.player.hp;
  const playerMaxHp = run.player.maxHp;
  const hpPercent = Math.max(0, Math.min(100, (playerHp / playerMaxHp) * 100));

  const cursedWords = run.cursedWords || [];
  const highestCurse = selectCursedWordForReview(cursedWords);
  const hasCurses = cursedWords.length > 0;

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
            {t('rogue.backToMainHome', 'Home')}
          </Text>
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
      </View>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.titleIcon}>{eventIcon}</Text>
        <Text style={styles.title}>{eventName}</Text>
        <Text style={styles.subtitle}>{eventDesc}</Text>
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

      {/* Event Options */}
      <View style={styles.optionsList}>
        {options.map((opt) => {
          const requiresCurse = Boolean(opt.requiresCurse);
          const curseUnavailable = requiresCurse && !hasCurses;

          const hpCostEffect = opt.effects.find((e) => e.type === EVENT_EFFECT_TYPES.HP_COST);
          const hpCost = hpCostEffect ? hpCostEffect.value : 0;
          const hpCostUnavailable = hpCost > 0 && playerHp <= hpCost;

          const isDisabled = curseUnavailable || hpCostUnavailable;

          let disabledReason = '';
          if (curseUnavailable) {
            disabledReason = t('rogue.events.requiresCurse', 'Requires an active Curse');
          } else if (hpCostUnavailable) {
            disabledReason = t('rogue.events.notEnoughHp', 'Cannot afford HP cost (HP must be > {{cost}})', {
              cost: hpCost,
            });
          }

          const label = t(opt.labelKey, opt.defaultLabel);

          return (
            <TouchableOpacity
              key={opt.id}
              style={[styles.optionCard, isDisabled && styles.optionCardDisabled]}
              onPress={() => handleSelectOption(opt.id)}
              disabled={submitting || isDisabled}
              activeOpacity={isDisabled ? 1 : 0.7}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <View style={styles.optionHeader}>
                <Text style={[styles.optionTitle, isDisabled && styles.optionTitleDisabled]}>
                  {label}
                </Text>
              </View>

              {/* Effects description */}
              <View style={styles.effectsContainer}>
                {opt.effects.map((eff, idx) => {
                  if (eff.type === EVENT_EFFECT_TYPES.HEAL) {
                    return (
                      <Text key={idx} style={styles.effectHealText}>
                        💖 +{eff.value} {t('rogue.hp', 'HP')}
                      </Text>
                    );
                  }
                  if (eff.type === EVENT_EFFECT_TYPES.HP_COST) {
                    return (
                      <Text key={idx} style={styles.effectCostText}>
                        🩸 -{eff.value} {t('rogue.hp', 'HP')}
                      </Text>
                    );
                  }
                  if (eff.type === EVENT_EFFECT_TYPES.PURIFY_HIGHEST_CURSE) {
                    return (
                      <Text key={idx} style={styles.effectPurifyText}>
                        ✨ {t('rogue.events.cleanseHighest', 'Cleanse 1 Curse level')}
                        {highestCurse ? ` (${highestCurse.word || highestCurse.wordId})` : ''}
                      </Text>
                    );
                  }
                  if (eff.type === EVENT_EFFECT_TYPES.NONE) {
                    return (
                      <Text key={idx} style={styles.effectNoneText}>
                        🚪 {t('rogue.events.noEffect', 'Continue without effect')}
                      </Text>
                    );
                  }
                  return null;
                })}
              </View>

              {isDisabled && (
                <Text style={styles.disabledReasonText}>⚠️ {disabledReason}</Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {submitting && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="small" color="#8B5CF6" />
          <Text style={styles.loadingText}>Resolving choice...</Text>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
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
    backgroundColor: '#8B5CF6',
  },
  optionsList: {
    gap: 16,
  },
  optionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#8B5CF660',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  optionCardDisabled: {
    borderColor: '#334155',
    opacity: 0.5,
  },
  optionHeader: {
    marginBottom: 8,
  },
  optionTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  optionTitleDisabled: {
    color: '#64748B',
  },
  effectsContainer: {
    gap: 4,
  },
  effectHealText: {
    fontSize: 13,
    color: '#34D399',
    fontWeight: '700',
  },
  effectCostText: {
    fontSize: 13,
    color: '#F87171',
    fontWeight: '700',
  },
  effectPurifyText: {
    fontSize: 13,
    color: '#C084FC',
    fontWeight: '700',
  },
  effectNoneText: {
    fontSize: 13,
    color: '#94A3B8',
    fontWeight: '600',
  },
  disabledReasonText: {
    fontSize: 12,
    color: '#FBBF24',
    fontWeight: '700',
    marginTop: 8,
  },
  loadingOverlay: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#8B5CF6',
    fontSize: 14,
    fontWeight: '600',
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
