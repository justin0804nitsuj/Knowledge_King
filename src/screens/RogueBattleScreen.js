import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import {
  loadActiveRun,
  submitCombatAnswer,
} from '../services/rogue/rogueRunService';
import { ENCOUNTER_STATUS } from '../domain/rogue/combat/rogueCombat';

export default function RogueBattleScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState(null);
  const [encounter, setEncounter] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const fetchCombatState = useCallback(async () => {
    try {
      setLoading(true);
      const activeRun = await loadActiveRun();
      if (!activeRun || !activeRun.encounter) {
        Alert.alert('No Battle', 'No active encounter found.', [
          { text: 'OK', onPress: () => navigation.navigate('RogueMap') },
        ]);
        return;
      }
      setRun(activeRun);
      setEncounter(activeRun.encounter);
      if (activeRun.encounter.lastResolution) {
        setFeedback(activeRun.encounter.lastResolution);
      }
    } catch (err) {
      console.warn('[RogueBattleScreen] Error loading combat state:', err);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    fetchCombatState();
  }, [fetchCombatState]);

  const handleSelectChoice = async (choiceId) => {
    if (submitting || !encounter || encounter.status !== ENCOUNTER_STATUS.ACTIVE) {
      return;
    }

    try {
      setSubmitting(true);
      const result = await submitCombatAnswer({
        choiceId,
        token: encounter.question?.token,
      });

      if (result.resolved) {
        setRun(result.run);
        setEncounter(result.encounter);
        setFeedback(result.resolution);
      }
    } catch (err) {
      Alert.alert('Combat Error', err.message || 'Failed to submit answer');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnToMap = () => {
    navigation.navigate('RogueMap');
  };

  const handleReturnToHome = () => {
    navigation.navigate('RogueHome');
  };

  if (loading || !encounter) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  const isVictory = encounter.status === ENCOUNTER_STATUS.VICTORY;
  const isDefeat = encounter.status === ENCOUNTER_STATUS.DEFEAT;
  const isOngoing = encounter.status === ENCOUNTER_STATUS.ACTIVE;

  const playerHp = encounter.player.hp;
  const playerMaxHp = encounter.player.maxHp;
  const enemyHp = encounter.enemy.hp;
  const enemyMaxHp = encounter.enemy.maxHp;

  const enemyHpPercent = Math.max(0, Math.min(100, (enemyHp / enemyMaxHp) * 100));
  const playerHpPercent = Math.max(0, Math.min(100, (playerHp / playerMaxHp) * 100));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={handleReturnToMap}
          disabled={isOngoing}
          accessibilityRole="button"
          accessibilityLabel="Back to Map"
        >
          <Ionicons
            name="arrow-back"
            size={22}
            color={isOngoing ? '#475569' : '#E2E8F0'}
          />
        </TouchableOpacity>
        <View style={styles.titleContainer}>
          <Text style={styles.headerTitle}>
            {encounter.nodeType === 'BOSS'
              ? '👑 BOSS BATTLE'
              : encounter.nodeType === 'ELITE'
              ? '🌟 ELITE TRIAL'
              : '⚔️ VOCABULARY BATTLE'}
          </Text>
          <Text style={styles.headerSubtitle}>
            Node {encounter.nodeId} • Turn {encounter.turn}
          </Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      {/* Enemy Card */}
      <View style={styles.enemyCard}>
        <View style={styles.entityHeader}>
          <Text style={styles.enemyName}>{encounter.enemy.name}</Text>
          <View style={styles.intentBadge}>
            <Text style={styles.intentText}>
              ⚔️ Intent: Attack {encounter.enemy.intent?.value || encounter.enemy.baseDamage}
            </Text>
          </View>
        </View>

        <View style={styles.hpBarBg}>
          <View
            style={[
              styles.hpBarFillEnemy,
              { width: `${enemyHpPercent}%` },
            ]}
          />
        </View>
        <Text style={styles.hpLabel}>
          Enemy HP: {enemyHp} / {enemyMaxHp}
        </Text>
      </View>

      {/* Combat Resolution Feedback Ribbon */}
      {feedback && (
        <View
          style={[
            styles.feedbackBanner,
            feedback.correct ? styles.feedbackCorrect : styles.feedbackWrong,
          ]}
        >
          <Text style={styles.feedbackTitle}>
            {feedback.correct ? '✅ CORRECT ANSWER!' : '❌ INCORRECT ANSWER'}
          </Text>
          <Text style={styles.feedbackDesc}>
            {feedback.correct
              ? `You dealt ${feedback.playerDamage} damage to the enemy.`
              : 'You dealt 0 damage.'}
            {feedback.enemyDamage > 0
              ? ` Enemy struck back for ${feedback.enemyDamage} damage!`
              : isVictory
              ? ' Enemy defeated before striking back!'
              : ''}
          </Text>
        </View>
      )}

      {/* Player HP Ribbon */}
      <View style={styles.playerCard}>
        <View style={styles.entityHeader}>
          <Text style={styles.playerName}>Hero</Text>
          <Text style={styles.hpText}>
            ❤️ {playerHp} / {playerMaxHp}
          </Text>
        </View>
        <View style={styles.hpBarBg}>
          <View
            style={[
              styles.hpBarFillPlayer,
              { width: `${playerHpPercent}%` },
            ]}
          />
        </View>
      </View>

      {/* Active Question & Choices */}
      {isOngoing && encounter.question && (
        <View style={styles.questionCard}>
          <View style={styles.wordContainer}>
            <Text style={styles.wordText}>{encounter.question.word}</Text>
            {encounter.question.partOfSpeech ? (
              <Text style={styles.posText}>
                ({encounter.question.partOfSpeech})
              </Text>
            ) : null}
          </View>

          <Text style={styles.instructionText}>
            Select the correct definition:
          </Text>

          <View style={styles.choicesGrid}>
            {encounter.question.choices.map((choice) => (
              <TouchableOpacity
                key={choice.id}
                style={styles.choiceBtn}
                onPress={() => handleSelectChoice(choice.id)}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel={`Choice: ${choice.text}`}
              >
                <Text style={styles.choiceBtnText}>{choice.text}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Victory Outcome */}
      {isVictory && (
        <View style={styles.victoryCard}>
          <Text style={styles.outcomeTitle}>👑 VICTORY!</Text>
          <Text style={styles.outcomeDesc}>
            The enemy has fallen. Your remaining HP will carry forward into the
            expedition.
          </Text>
          <TouchableOpacity
            style={styles.primaryActionBtn}
            onPress={handleReturnToMap}
            accessibilityRole="button"
          >
            <Text style={styles.primaryActionBtnText}>
              Return to Expedition Map
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Defeat Outcome */}
      {isDefeat && (
        <View style={styles.defeatCard}>
          <Text style={styles.outcomeTitle}>💀 DEFEATED</Text>
          <Text style={styles.outcomeDesc}>
            Your HP reached 0. This expedition has concluded.
          </Text>
          <TouchableOpacity
            style={styles.defeatActionBtn}
            onPress={handleReturnToHome}
            accessibilityRole="button"
          >
            <Text style={styles.primaryActionBtnText}>
              Return to Expedition Menu
            </Text>
          </TouchableOpacity>
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
    padding: 16,
    paddingTop: 45,
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0F172A',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  navBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  titleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
  },
  enemyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EF444460',
    marginBottom: 14,
  },
  playerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#3B82F660',
    marginBottom: 16,
  },
  entityHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  enemyName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FCA5A5',
  },
  playerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#93C5FD',
  },
  hpText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  intentBadge: {
    backgroundColor: '#7F1D1D',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  intentText: {
    color: '#FCA5A5',
    fontSize: 11,
    fontWeight: 'bold',
  },
  hpBarBg: {
    height: 10,
    backgroundColor: '#0F172A',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 6,
  },
  hpBarFillEnemy: {
    height: '100%',
    backgroundColor: '#EF4444',
  },
  hpBarFillPlayer: {
    height: '100%',
    backgroundColor: '#10B981',
  },
  hpLabel: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'right',
  },
  feedbackBanner: {
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
  },
  feedbackCorrect: {
    backgroundColor: '#064E3B',
    borderWidth: 1,
    borderColor: '#10B981',
  },
  feedbackWrong: {
    backgroundColor: '#7F1D1D',
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  feedbackTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  feedbackDesc: {
    fontSize: 12,
    color: '#E2E8F0',
  },
  questionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  wordContainer: {
    alignItems: 'center',
    marginBottom: 12,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingVertical: 14,
  },
  wordText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F8FAFC',
    letterSpacing: 0.5,
  },
  posText: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  instructionText: {
    fontSize: 12,
    color: '#94A3B8',
    marginBottom: 12,
    textAlign: 'center',
  },
  choicesGrid: {
    gap: 10,
  },
  choiceBtn: {
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  choiceBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  victoryCard: {
    backgroundColor: '#064E3B',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#10B981',
    alignItems: 'center',
  },
  defeatCard: {
    backgroundColor: '#7F1D1D',
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#EF4444',
    alignItems: 'center',
  },
  outcomeTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 6,
  },
  outcomeDesc: {
    fontSize: 13,
    color: '#E2E8F0',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  primaryActionBtn: {
    backgroundColor: '#10B981',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  defeatActionBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  primaryActionBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
