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
  selectCombatAction,
} from '../services/rogue/rogueRunService';
import { ENCOUNTER_STATUS } from '../domain/rogue/combat/rogueCombat';
import { PLAYER_ACTION_IDS } from '../domain/rogue/combat/playerActions';
import RogueTutorialModal from '../components/RogueTutorialModal';
import RogueContextualHint from '../components/RogueContextualHint';
import { hasSeenHint, markHintSeen } from '../services/rogue/rogueTutorialService';

export default function RogueBattleScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();

  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState(null);
  const [encounter, setEncounter] = useState(null);
  const [selectedAction, setSelectedAction] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [activeHintKey, setActiveHintKey] = useState(null);

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
      setSelectedAction(
        activeRun.encounter.selectedAction ||
        activeRun.encounter.player?.selectedAction ||
        null
      );
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

  useEffect(() => {
    let isMounted = true;
    async function checkHints() {
      if (!encounter) return;
      const seenActionHint = await hasSeenHint('first_action_select');
      if (!seenActionHint && isMounted) {
        setActiveHintKey('first_action_select');
        return;
      }
      if (feedback?.curseResult?.type === 'CURSE_APPLIED') {
        const seen = await hasSeenHint('first_curse');
        if (!seen && isMounted) {
          setActiveHintKey('first_curse');
          return;
        }
      }
      if (encounter.enemy?.intent?.type === 'GUARD') {
        const seen = await hasSeenHint('first_guard');
        if (!seen && isMounted) {
          setActiveHintKey('first_guard');
          return;
        }
      }
      if (encounter.enemy?.intent?.type === 'HEAVY_ATTACK') {
        const seen = await hasSeenHint('first_heavy_attack');
        if (!seen && isMounted) {
          setActiveHintKey('first_heavy_attack');
          return;
        }
      }
    }
    checkHints();
    return () => {
      isMounted = false;
    };
  }, [encounter?.enemy?.intent?.type, feedback?.curseResult?.type]);

  const handleDismissHint = async () => {
    if (activeHintKey) {
      await markHintSeen(activeHintKey);
      setActiveHintKey(null);
    }
  };

  const handleSelectAction = async (actionId) => {
    if (submitting || !encounter || encounter.status !== ENCOUNTER_STATUS.ACTIVE) {
      return;
    }
    const currentCd = encounter.recoverCooldown ?? encounter.player?.recoverCooldown ?? 0;
    if (actionId === PLAYER_ACTION_IDS.RECOVER && currentCd > 0) {
      return;
    }
    setSelectedAction(actionId);
    try {
      const res = await selectCombatAction({ actionId });
      if (res?.encounter) {
        setEncounter(res.encounter);
        setRun(res.run);
      }
    } catch (err) {
      console.warn('[RogueBattleScreen] Failed to persist action selection:', err);
    }
  };

  const handleSelectChoice = async (choiceId) => {
    if (submitting || !encounter || encounter.status !== ENCOUNTER_STATUS.ACTIVE) {
      return;
    }

    if (!selectedAction) {
      Alert.alert(
        t('rogue.actions.step1Prompt', 'Step 1: Choose Action'),
        t('rogue.actions.chooseActionFirst', 'Select an action above to unlock answer choices')
      );
      return;
    }

    try {
      setSubmitting(true);
      const result = await submitCombatAnswer({
        choiceId,
        token: encounter.question?.token,
        actionId: selectedAction,
      });

      if (result.resolved) {
        setRun(result.run);
        setEncounter(result.encounter);
        setFeedback(result.resolution);
        setSelectedAction(result.encounter.selectedAction || null);
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

  const handleBackToMainHome = () => {
    navigation.navigate('MainTabs', { screen: 'Home' });
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
          style={styles.backBtn}
          onPress={handleBackToMainHome}
          accessibilityRole="button"
          accessibilityLabel="Back to Home"
        >
          <Ionicons name="arrow-back" size={20} color="#E2E8F0" />
          <Text style={styles.backBtnLabel}>
            {t('rogue.backToMainHome', 'Home')}
          </Text>
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
        <TouchableOpacity
          style={styles.helpBtn}
          onPress={() => setTutorialVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="How to Play"
        >
          <Ionicons name="help-circle-outline" size={22} color="#60A5FA" />
        </TouchableOpacity>
      </View>

      {/* Contextual Hint */}
      {activeHintKey && (
        <RogueContextualHint
          hintKey={activeHintKey}
          onDismiss={handleDismissHint}
        />
      )}

      {/* Enemy Card */}
      <View style={styles.enemyCard}>
        <View style={styles.entityHeader}>
          <View>
            <Text style={styles.enemyName}>
              {encounter.nodeType === 'BOSS' ? '👑 ' : ''}
              {encounter.enemy.nameKey ? t(encounter.enemy.nameKey, encounter.enemy.name) : encounter.enemy.name}
            </Text>
            {(encounter.nodeType === 'BOSS' || encounter.archetypeId === 'OVERLORD') && (
              <View style={styles.phaseBadge}>
                <Text style={styles.phaseBadgeText}>
                  {encounter.bossPhase === 2
                    ? t('rogue.boss.phase2', 'Phase 2')
                    : t('rogue.boss.phase1', 'Phase 1')}
                </Text>
              </View>
            )}
          </View>
          {(() => {
            const intentDisplay = getIntentDisplay(encounter.enemy.intent, t);
            return (
              <View style={[styles.intentBadge, intentDisplay.badgeStyle]}>
                <Text style={[styles.intentText, intentDisplay.textStyle]}>
                  {intentDisplay.label}
                </Text>
              </View>
            );
          })()}
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

      {/* Boss Phase 2 Transition Banner */}
      {feedback?.bossPhaseTransition && (
        <View style={styles.bossPhaseTransitionBanner}>
          <Text style={styles.bossPhaseTransitionText}>
            ⚡ {t('rogue.boss.phase2Banner', 'The Overlord enters Phase 2!')}
          </Text>
        </View>
      )}

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
            {getFeedbackDescription(feedback, isVictory, t)}
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

      {/* Step 1: Action Selection */}
      {isOngoing && (
        <View style={styles.actionSelectionCard}>
          <View style={styles.actionSectionHeader}>
            <Text style={styles.actionSectionStep}>
              {t('rogue.actions.step1Prompt', 'Step 1: Choose Action')}
            </Text>
            {selectedAction && (
              <View style={styles.actionArmedBadge}>
                <Text style={styles.actionArmedText}>
                  ✓ {t(`rogue.actions.${selectedAction.toLowerCase()}`, selectedAction)}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.actionCardsRow}>
            {/* ATTACK */}
            <TouchableOpacity
              style={[
                styles.actionCard,
                styles.actionCardAttack,
                selectedAction === PLAYER_ACTION_IDS.ATTACK && styles.actionCardSelected,
                submitting && styles.actionCardDisabled,
              ]}
              onPress={() => handleSelectAction(PLAYER_ACTION_IDS.ATTACK)}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Action: Attack"
            >
              <Text style={styles.actionIcon}>⚔️</Text>
              <Text style={styles.actionTitle}>
                {t('rogue.actions.attack', 'Attack')}
              </Text>
              <Text style={styles.actionSubtitle}>
                {t('rogue.actions.attackDesc', '25 DMG')}
              </Text>
            </TouchableOpacity>

            {/* GUARD */}
            <TouchableOpacity
              style={[
                styles.actionCard,
                styles.actionCardGuard,
                selectedAction === PLAYER_ACTION_IDS.GUARD && styles.actionCardSelected,
                submitting && styles.actionCardDisabled,
              ]}
              onPress={() => handleSelectAction(PLAYER_ACTION_IDS.GUARD)}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Action: Guard"
            >
              <Text style={styles.actionIcon}>🛡️</Text>
              <Text style={styles.actionTitle}>
                {t('rogue.actions.guard', 'Guard')}
              </Text>
              <Text style={styles.actionSubtitle}>
                {t('rogue.actions.guardDesc', '20 Block')}
              </Text>
            </TouchableOpacity>

            {/* RECOVER */}
            {(() => {
              const recoverCd = encounter.recoverCooldown ?? encounter.player?.recoverCooldown ?? 0;
              const isRecoverAvailable = recoverCd === 0;
              return (
                <TouchableOpacity
                  style={[
                    styles.actionCard,
                    styles.actionCardRecover,
                    selectedAction === PLAYER_ACTION_IDS.RECOVER && styles.actionCardSelected,
                    (!isRecoverAvailable || submitting) && styles.actionCardDisabled,
                  ]}
                  onPress={() => handleSelectAction(PLAYER_ACTION_IDS.RECOVER)}
                  disabled={!isRecoverAvailable || submitting}
                  accessibilityRole="button"
                  accessibilityLabel="Action: Recover"
                >
                  <Text style={styles.actionIcon}>❤️</Text>
                  <Text style={styles.actionTitle}>
                    {t('rogue.actions.recover', 'Recover')}
                  </Text>
                  <Text
                    style={[
                      styles.actionSubtitle,
                      !isRecoverAvailable && styles.actionCooldownText,
                    ]}
                  >
                    {isRecoverAvailable
                      ? t('rogue.actions.recoverDesc', '+15 HP')
                      : t('rogue.actions.cooldown', { turns: recoverCd, defaultValue: `CD: ${recoverCd}` })}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </View>
        </View>
      )}

      {/* Step 2: Question & Choices */}
      {isOngoing && encounter.question && (
        <View style={styles.questionCard}>
          <View style={styles.step2HeaderRow}>
            <Text style={styles.step2Label}>
              {t('rogue.actions.step2Prompt', 'Step 2: Answer Question')}
            </Text>
            {!selectedAction && (
              <Text style={styles.step2LockNotice}>
                🔒 {t('rogue.actions.chooseActionFirst', 'Select action above')}
              </Text>
            )}
          </View>

          {encounter.question.isCursed ? (
            <View style={styles.cursedBadgeContainer}>
              <Text style={styles.cursedBadgeText}>
                ☠️ {t('rogue.curse.cursedWord', 'Cursed Word')} • {t('rogue.curse.curseLevel', 'Curse Level {{level}}', { level: encounter.question.curseStacks || 1 })}
              </Text>
            </View>
          ) : null}

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
                style={[
                  styles.choiceBtn,
                  (!selectedAction || submitting) && styles.choiceBtnLocked,
                ]}
                onPress={() => handleSelectChoice(choice.id)}
                disabled={!selectedAction || submitting}
                accessibilityRole="button"
                accessibilityLabel={`Choice: ${choice.text}`}
              >
                <Text
                  style={[
                    styles.choiceBtnText,
                    (!selectedAction || submitting) && styles.choiceBtnTextLocked,
                  ]}
                >
                  {choice.text}
                </Text>
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
            {encounter.nodeType === 'ELITE'
              ? 'Elite trial conquered! A relic reward awaits.'
              : 'The enemy has fallen. Your remaining HP will carry forward into the expedition.'}
          </Text>
          {encounter.nodeType === 'ELITE' ? (
            <TouchableOpacity
              style={styles.primaryActionBtn}
              onPress={() => navigation.navigate('RogueRelicReward')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryActionBtnText}>
                🏺 Claim Relic Reward
              </Text>
            </TouchableOpacity>
          ) : encounter.nodeType === 'BOSS' || run?.status === 'VICTORY' ? (
            <TouchableOpacity
              style={styles.primaryActionBtn}
              onPress={() => navigation.navigate('RogueResult')}
              accessibilityRole="button"
            >
              <Text style={styles.primaryActionBtnText}>
                🏆 {t('rogue.result.viewSummaryBtn', 'View Expedition Summary')}
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.primaryActionBtn}
              onPress={handleReturnToMap}
              accessibilityRole="button"
            >
              <Text style={styles.primaryActionBtnText}>
                Return to Expedition Map
              </Text>
            </TouchableOpacity>
          )}
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
            onPress={() => navigation.navigate('RogueResult')}
            accessibilityRole="button"
          >
            <Text style={styles.primaryActionBtnText}>
              💀 {t('rogue.result.viewSummaryBtn', 'View Expedition Summary')}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <RogueTutorialModal
        visible={tutorialVisible}
        onClose={() => setTutorialVisible(false)}
      />
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
  helpBtn: {
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
  phaseBadge: {
    backgroundColor: '#7C2D12',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#EA580C',
  },
  phaseBadgeText: {
    color: '#FFEDD5',
    fontSize: 11,
    fontWeight: '700',
  },
  bossPhaseTransitionBanner: {
    backgroundColor: '#7C2D12',
    borderWidth: 1.5,
    borderColor: '#F97316',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
    marginBottom: 14,
  },
  bossPhaseTransitionText: {
    color: '#FED7AA',
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
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
  intentAttackBadge: {
    backgroundColor: '#7F1D1D',
  },
  intentAttackText: {
    color: '#FCA5A5',
  },
  intentHeavyBadge: {
    backgroundColor: '#991B1B',
    borderWidth: 1,
    borderColor: '#F87171',
  },
  intentHeavyText: {
    color: '#FEE2E2',
    fontWeight: '800',
  },
  intentGuardBadge: {
    backgroundColor: '#1E3A8A',
    borderWidth: 1,
    borderColor: '#60A5FA',
  },
  intentGuardText: {
    color: '#BFDBFE',
    fontWeight: '700',
  },
  actionSelectionCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  actionSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionSectionStep: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E2E8F0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  actionArmedBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3B82F6',
  },
  actionArmedText: {
    color: '#93C5FD',
    fontSize: 11,
    fontWeight: '700',
  },
  actionCardsRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  actionCard: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#334155',
  },
  actionCardAttack: {},
  actionCardGuard: {},
  actionCardRecover: {},
  actionCardSelected: {
    borderColor: '#F59E0B',
    backgroundColor: '#1E293B',
    transform: [{ scale: 1.02 }],
  },
  actionCardDisabled: {
    opacity: 0.45,
  },
  actionIcon: {
    fontSize: 22,
    marginBottom: 4,
  },
  actionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 2,
  },
  actionSubtitle: {
    fontSize: 11,
    color: '#94A3B8',
    fontWeight: '600',
  },
  actionCooldownText: {
    color: '#EF4444',
    fontWeight: '700',
  },
  step2HeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  step2Label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E2E8F0',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  step2LockNotice: {
    fontSize: 11,
    color: '#F59E0B',
    fontWeight: '600',
  },
  choiceBtnLocked: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    opacity: 0.6,
  },
  choiceBtnTextLocked: {
    color: '#64748B',
  },
  cursedBadgeContainer: {
    alignSelf: 'center',
    backgroundColor: 'rgba(126, 34, 206, 0.25)',
    borderWidth: 1,
    borderColor: '#A855F7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 8,
  },
  cursedBadgeText: {
    color: '#E9D5FF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});

function getIntentDisplay(intent, t) {
  if (!intent) {
    return {
      icon: '⚔️',
      label: '⚔️ Attack • 4 damage',
      badgeStyle: styles.intentAttackBadge,
      textStyle: styles.intentAttackText,
    };
  }

  switch (intent.type) {
    case 'HEAVY_ATTACK':
      return {
        icon: '💥',
        label: t('rogue.intents.heavyAttackDesc', {
          damage: intent.value,
          defaultValue: `💥 Heavy Attack • ${intent.value} damage`,
        }),
        badgeStyle: styles.intentHeavyBadge,
        textStyle: styles.intentHeavyText,
      };
    case 'GUARD':
      return {
        icon: '🛡️',
        label: t('rogue.intents.guardDesc', {
          mitigation: intent.value,
          defaultValue: `🛡 Guard • blocks ${intent.value} damage`,
        }),
        badgeStyle: styles.intentGuardBadge,
        textStyle: styles.intentGuardText,
      };
    case 'ATTACK':
    default:
      return {
        icon: '⚔️',
        label: t('rogue.intents.attackDesc', {
          damage: intent.value,
          defaultValue: `⚔ Attack • ${intent.value} damage`,
        }),
        badgeStyle: styles.intentAttackBadge,
        textStyle: styles.intentAttackText,
      };
  }
}

function getFeedbackDescription(feedback, isVictory, t) {
  const parts = [];

  if (feedback.actionId === 'ATTACK') {
    if (feedback.actionSucceeded) {
      if (feedback.guardMitigated > 0) {
        parts.push(
          t('rogue.feedback.guardMitigated', 'Enemy Guard absorbed {{amount}} damage! Dealt {{dealt}} damage.', {
            amount: feedback.guardMitigated,
            dealt: feedback.playerDamage,
          })
        );
      } else {
        parts.push(
          t('rogue.feedback.attackSuccess', '⚔ Attack succeeded! Dealt {{damage}} damage.', {
            damage: feedback.playerDamage,
          })
        );
      }
    } else {
      parts.push(t('rogue.feedback.attackFailed', '⚔ Attack failed! (0 damage dealt)'));
    }
  } else if (feedback.actionId === 'GUARD') {
    if (feedback.actionSucceeded) {
      parts.push(
        t('rogue.feedback.guardSuccess', '🛡 Guard succeeded! Gained {{block}} Block.', {
          block: 20,
        })
      );
    } else {
      parts.push(t('rogue.feedback.guardFailed', '🛡 Guard failed! (0 Block gained)'));
    }
  } else if (feedback.actionId === 'RECOVER') {
    if (feedback.actionSucceeded) {
      parts.push(
        t('rogue.feedback.recoverSuccess', '❤️ Recover succeeded! Restored {{heal}} HP.', {
          heal: feedback.recoveredHp,
        })
      );
    } else {
      parts.push(t('rogue.feedback.recoverFailed', '❤️ Recover failed! (0 HP restored)'));
    }
  } else if (feedback.correct) {
    parts.push(
      t('rogue.feedback.playerDealt', 'You dealt {{damage}} damage.', {
        damage: feedback.playerDamage,
      })
    );
  } else {
    parts.push(t('rogue.feedback.playerWrong', 'You dealt 0 damage.'));
  }

  if (feedback.blockedDamage > 0) {
    parts.push(
      t('rogue.feedback.blockedDamage', 'Blocked {{block}} incoming damage.', {
        block: feedback.blockedDamage,
      })
    );
  }

  if (feedback.curseResult) {
    const cr = feedback.curseResult;
    if (cr.type === 'CURSE_APPLIED') {
      parts.push(
        t('rogue.feedback.curseApplied', 'Wrong — "{{word}}" became Cursed (Level 1).', {
          word: cr.word,
        })
      );
    } else if (cr.type === 'CURSE_INTENSIFIED') {
      const prevLevel = Math.max(1, (cr.stacks || 2) - 1);
      parts.push(
        t('rogue.feedback.curseIntensified', 'Wrong — Curse Level {{prev}} → {{level}}! Backlash: {{backlash}} damage.', {
          prev: prevLevel,
          level: cr.stacks,
          backlash: cr.backlash || 0,
        })
      );
    } else if (cr.type === 'CURSE_WEAKENED') {
      const prevLevel = (cr.stacks || 1) + 1;
      parts.push(
        t('rogue.feedback.curseWeakened', 'Correct — Curse Level {{prev}} → {{level}}.', {
          prev: prevLevel,
          level: cr.stacks,
        })
      );
    } else if (cr.type === 'CURSE_PURIFIED') {
      parts.push(
        t('rogue.feedback.cursePurified', '✨ Purified — "{{word}}" is completely cleansed!', {
          word: cr.word,
        })
      );
    }
  }


  if (Array.isArray(feedback.relicTriggers)) {
    for (const trig of feedback.relicTriggers) {
      if (trig.relicId === 'SCHOLARS_LENS') {
        parts.push(t('rogue.feedback.scholarsLensBonus', "Scholar's Lens: Curse purified by 2 levels!"));
      } else if (trig.relicId === 'PIERCING_NIB') {
        parts.push(
          t('rogue.feedback.piercingNibPierced', 'Guard pierced (-{{amount}} mitigation)!', {
            amount: trig.value,
          })
        );
      } else if (trig.relicId === 'MNEMONIC_CHARM') {
        parts.push(t('rogue.feedback.mnemonicCharmPrevented', 'Mnemonic Charm prevented a new Curse!'));
      } else if (trig.relicId === 'PURIFYING_INK') {
        parts.push(
          t('rogue.feedback.purifyingInkHeal', 'Purified — Purifying Ink restored {{amount}} HP!', {
            amount: trig.value,
          })
        );
      } else if (trig.relicId === 'GLASS_QUILL' && trig.type === 'DAMAGE_BONUS') {
        parts.push(t('rogue.feedback.glassQuillBonus', 'Glass Quill: +10 damage dealt!'));
      } else if (trig.relicId === 'GLASS_QUILL' && trig.type === 'BACKLASH_BONUS') {
        parts.push(t('rogue.feedback.glassQuillBacklash', 'Glass Quill: +5 backlash damage taken!'));
      } else if (trig.relicId === 'SECOND_CHANCE') {
        parts.push(t('rogue.feedback.secondChanceTriggered', 'Second Chance activated — survived at 1 HP!'));
      }
    }
  }

  if (feedback.enemyDamage > 0) {
    if (feedback.executedIntent?.type === 'HEAVY_ATTACK') {
      parts.push(
        t('rogue.feedback.enemyHeavyAttack', 'Enemy used Heavy Attack for {{damage}} damage!', {
          damage: feedback.enemyDamage,
        })
      );
    } else {
      parts.push(
        t('rogue.feedback.enemyAttacked', 'Enemy attacked for {{damage}} damage.', {
          damage: feedback.enemyDamage,
        })
      );
    }
  } else if (feedback.executedIntent?.type === 'GUARD') {
    parts.push(t('rogue.feedback.enemyGuarded', 'Enemy guarded (no attack this turn).'));
  } else if (isVictory) {
    parts.push(t('rogue.feedback.enemyDefeated', 'Enemy defeated before striking back!'));
  }

  return parts.join(' ');
}
