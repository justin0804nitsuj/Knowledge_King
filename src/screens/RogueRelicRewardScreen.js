/**
 * ROGUE EXPEDITION V0.1 — RELIC REWARD SCREEN
 *
 * Dedicated reward drafting UI:
 * - Displays deterministic 3-relic draft from ELITE node victory
 * - Persists chosen relic to run state before navigating back
 * - Idempotent selection with double-tap protection
 * - Safe fallback for unknown relic IDs
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
import { selectRelicReward } from '../services/rogue/rogueRunService';
import { getRelic } from '../domain/rogue/relic/relicRegistry';
import RogueContextualHint from '../components/RogueContextualHint';
import { hasSeenHint, markHintSeen } from '../services/rogue/rogueTutorialService';

export default function RogueRelicRewardScreen() {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [run, setRun] = useState(null);
  const [reward, setReward] = useState(null);
  const [activeHintKey, setActiveHintKey] = useState(null);

  const loadData = useCallback(async () => {
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

      if (!activeRun.pendingReward || activeRun.pendingReward.type !== 'RELIC_DRAFT') {
        navigation.navigate('RogueMap');
        return;
      }

      setRun(activeRun);
      setReward(activeRun.pendingReward);
    } catch (err) {
      Alert.alert('Reward Error', err.message || 'Failed to load relic reward');
      navigation.navigate('RogueMap');
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    let isMounted = true;
    async function checkRelicHint() {
      const seen = await hasSeenHint('first_relic_draft');
      if (!seen && isMounted) {
        setActiveHintKey('first_relic_draft');
      }
    }
    checkRelicHint();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleDismissHint = async () => {
    await markHintSeen('first_relic_draft');
    setActiveHintKey(null);
  };

  const handleBackToMainHome = () => {
    navigation.navigate('MainTabs', { screen: 'Home' });
  };

  const handleSelectRelic = async (relicId) => {
    if (claiming || !reward) return;

    try {
      setClaiming(true);
      const result = await selectRelicReward({
        rewardId: reward.rewardId,
        relicId,
      });

      if (result.success) {
        navigation.navigate('RogueMap');
      } else {
        Alert.alert('Reward Error', result.reason || 'Failed to claim relic');
      }
    } catch (err) {
      Alert.alert('Error', err.message || 'Failed to claim relic reward');
    } finally {
      setClaiming(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#F59E0B" />
      </View>
    );
  }

  const options = reward?.options || [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={handleBackToMainHome}
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

      {/* Contextual Hint */}
      {activeHintKey && (
        <RogueContextualHint
          hintKey={activeHintKey}
          onDismiss={handleDismissHint}
        />
      )}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.titleIcon}>🏺</Text>
        <Text style={styles.title}>
          {t('rogue.relics.chooseTitle', 'Choose a Relic')}
        </Text>
        <Text style={styles.subtitle}>
          {t('rogue.relics.chooseDesc', 'Claim an artifact to empower your expedition.')}
        </Text>
      </View>

      {/* Relic Options */}
      {options.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>
            {t('rogue.relics.noRelicsAvailable', 'All relics collected!')}
          </Text>
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => handleSelectRelic(null)}
            disabled={claiming}
            accessibilityRole="button"
          >
            <Text style={styles.continueBtnText}>
              {t('rogue.relics.continueReward', 'Continue Expedition')}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.optionsList}>
          {options.map((relicId) => {
            const def = getRelic(relicId);
            const name = def
              ? t(def.nameKey, def.defaultName)
              : String(relicId);
            const desc = def
              ? t(def.descriptionKey, def.defaultDesc)
              : 'Unknown mysterious relic.';
            const icon = def?.icon || '✨';
            const rarity = def?.rarity || 'COMMON';

            return (
              <TouchableOpacity
                key={relicId}
                style={styles.relicCard}
                onPress={() => handleSelectRelic(relicId)}
                disabled={claiming}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Select ${name}`}
              >
                <View style={styles.cardHeader}>
                  <Text style={styles.relicIcon}>{icon}</Text>
                  <View style={styles.relicMeta}>
                    <Text style={styles.relicName}>{name}</Text>
                    <View style={styles.rarityBadge}>
                      <Text style={styles.rarityText}>{rarity}</Text>
                    </View>
                  </View>
                </View>
                <Text style={styles.relicDesc}>{desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {claiming && (
        <View style={styles.claimingOverlay}>
          <ActivityIndicator size="small" color="#F59E0B" />
          <Text style={styles.claimingText}>Claiming Relic...</Text>
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
    fontSize: 42,
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
  optionsList: {
    gap: 16,
  },
  relicCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#F59E0B60',
    shadowColor: '#F59E0B',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  relicIcon: {
    fontSize: 32,
    marginRight: 14,
  },
  relicMeta: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  relicName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#F8FAFC',
    flex: 1,
  },
  rarityBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  rarityText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FBBF24',
    letterSpacing: 0.5,
  },
  relicDesc: {
    fontSize: 14,
    color: '#CBD5E1',
    lineHeight: 20,
  },
  emptyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E2E8F0',
    marginBottom: 16,
  },
  continueBtn: {
    backgroundColor: '#F59E0B',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  continueBtnText: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '800',
  },
  claimingOverlay: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  claimingText: {
    color: '#FBBF24',
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
