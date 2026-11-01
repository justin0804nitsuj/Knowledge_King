import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme';
import { resetCampaignProgress } from '../storage/campaignStorage';
import { loadPlayerProgress } from '../storage/playerProgressStorage';
import { loadBattleHistory } from '../storage/battleHistoryStorage';
import { getPlayerLevelInfo } from '../domain/player/levelSystem';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '../localization/i18n';
import { LANGUAGE_PREF, loadSettings, saveSettings } from '../storage/settingsStorage';
import { gameFeedback } from '../services/feedback/gameFeedback';
import { auth } from '../services/firebase/firebaseAuth';
import { getGoogleCurrentUser } from '../services/auth/googleSignIn';

export default function ProfileScreen({ navigation }) {
  const [playerInfo, setPlayerInfo] = useState(null);
  const [recentBattles, setRecentBattles] = useState([]);
  const [currentLang, setCurrentLang] = useState(LANGUAGE_PREF.SYSTEM);
  const [soundEffects, setSoundEffects] = useState(true);
  const [haptics, setHaptics] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryStatusReport, setRetryStatusReport] = useState(null);
  const {
    user,
    isSignedIn,
    signInWithGoogle,
    signOut,
    isInitializing,
    syncStatus,
    cloudSyncReady,
    identity,
    lastSyncError,
    retrySync
  } = useAuth();
  const { t } = useTranslation();
  
  useFocusEffect(
    useCallback(() => {
      async function loadData() {
        const p = await loadPlayerProgress();
        setPlayerInfo(p);
        
        const hObj = await loadBattleHistory();
        setRecentBattles(hObj.records.slice(0, 5));

        const settings = await loadSettings();
        setCurrentLang(settings.language);
        setSoundEffects(settings.soundEffects !== false);
        setHaptics(settings.haptics !== false);
      }
      loadData();
    }, [])
  );

  const handleReset = () => {
    Alert.alert(
      t('profile.confirmReset'),
      t('profile.confirmResetMessage'),
      [
        { text: t('profile.cancel'), style: "cancel" },
        { 
          text: t('profile.reset'), 
          style: "destructive",
          onPress: async () => {
            await resetCampaignProgress();
          }
        }
      ]
    );
  };

  const handleLangChange = async (lang) => {
    await changeLanguage(lang);
    setCurrentLang(lang);
    await saveSettings({ language: lang });
  };

  const handleToggleSound = async () => {
    const nextVal = !soundEffects;
    setSoundEffects(nextVal);
    await saveSettings({ soundEffects: nextVal });
    gameFeedback.updateSettings({ soundEffects: nextVal });
  };

  const handleToggleHaptics = async () => {
    const nextVal = !haptics;
    setHaptics(nextVal);
    await saveSettings({ haptics: nextVal });
    gameFeedback.updateSettings({ haptics: nextVal });
  };

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      Alert.alert('Sign-In Error', e.message);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (e) {
      Alert.alert('Sign-Out Error', e.message);
    }
  };

  const handleRetrySync = async () => {
    setIsRetrying(true);
    setRetryStatusReport('Syncing...');
    try {
      const res = await retrySync();
      const st = res?.status || 'synced';
      setRetryStatusReport(st);
    } catch (err) {
      setRetryStatusReport('error');
    } finally {
      setIsRetrying(false);
    }
  };

  if (!playerInfo || isInitializing) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  const { level } = getPlayerLevelInfo(playerInfo.totalXp);
  const st = playerInfo.stats;
  
  const accuracy = st.totalQuestions > 0 ? Math.round((st.totalCorrect / st.totalQuestions) * 100) : 0;
  const winRate = st.battlesPlayed > 0 ? Math.round((st.battlesWon / st.battlesPlayed) * 100) : 0;

  const googleUser = getGoogleCurrentUser();
  const isGoogleConnected = Boolean(isSignedIn || googleUser);
  const isFirebaseAuthed = Boolean(auth?.currentUser);
  const isAuthInconsistent = isGoogleConnected && !isFirebaseAuthed;

  const authLabel = isGoogleConnected ? 'Google Signed In' : 'Guest';
  const firebaseAuthLabel = isFirebaseAuthed ? 'Authenticated' : 'Not Authenticated';
  const cloudIdentityLabel = formatShortUid(identity || (isFirebaseAuthed ? `uid:${auth.currentUser.uid}` : 'guest'));
  const cloudSyncState = resolveCloudSyncState(syncStatus, cloudSyncReady);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('navigation.profile')}</Text>

      <View style={styles.headerCard}>
        <View style={styles.avatarPlaceholder}><Text style={styles.avatarText}>L{level}</Text></View>
        <View style={styles.headerInfo}>
          <Text style={styles.playerName}>{isSignedIn ? user?.displayName : t('profile.guestPlayer')}</Text>
          {isSignedIn && <Text style={styles.playerEmail}>{user?.email}</Text>}
          {isSignedIn ? (
            <Text style={[styles.syncStatusText, { color: getSyncStatusColor(syncStatus) }]}>
              {getSyncStatusLabel(syncStatus)}
            </Text>
          ) : (
            <Text style={[styles.syncStatusText, { color: '#888888' }]}>
              Offline — saved on device
            </Text>
          )}
          <Text style={styles.playerXp}>{t('home.xp')}: {playerInfo.totalXp}</Text>
          <Text style={styles.playerStreak}>{t('home.streak')}: {playerInfo.daily.streak}</Text>
        </View>
      </View>

      <View style={styles.authCard}>
        {isSignedIn ? (
          <>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleLogout}>
              <Text style={styles.signOutBtnText}>{t('profile.signOut')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.googleBtn} onPress={handleLogin}>
              <Text style={styles.googleBtnText}>{t('profile.signInWithGoogle')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Cloud Sync Diagnostic Section */}
      <View style={styles.diagnosticCard}>
        <Text style={styles.diagnosticTitle}>Cloud Sync Diagnostics</Text>

        {isAuthInconsistent && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              Google account connected, but Firebase authentication is not active.
            </Text>
          </View>
        )}

        <View style={styles.diagnosticRow}>
          <Text style={styles.diagnosticLabel}>Authentication:</Text>
          <Text style={styles.diagnosticValue}>{authLabel}</Text>
        </View>

        <View style={styles.diagnosticRow}>
          <Text style={styles.diagnosticLabel}>Firebase Auth:</Text>
          <Text style={[styles.diagnosticValue, { color: isFirebaseAuthed ? '#22c55e' : '#ef4444' }]}>
            {firebaseAuthLabel}
          </Text>
        </View>

        <View style={styles.diagnosticRow}>
          <Text style={styles.diagnosticLabel}>Cloud Identity:</Text>
          <Text style={styles.diagnosticValue}>{cloudIdentityLabel}</Text>
        </View>

        <View style={styles.diagnosticRow}>
          <Text style={styles.diagnosticLabel}>Cloud Sync State:</Text>
          <Text style={[styles.diagnosticValue, { color: getCloudSyncStateColor(cloudSyncState) }]}>
            {cloudSyncState}
          </Text>
        </View>

        {lastSyncError ? (
          <View style={styles.diagnosticRow}>
            <Text style={styles.diagnosticLabel}>Sync Error:</Text>
            <Text style={[styles.diagnosticValue, { color: '#ef4444' }]}>{lastSyncError}</Text>
          </View>
        ) : null}

        {retryStatusReport ? (
          <View style={styles.diagnosticRow}>
            <Text style={styles.diagnosticLabel}>Retry Status:</Text>
            <Text style={styles.diagnosticValue}>{retryStatusReport}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.retrySyncBtn, isRetrying && styles.retrySyncBtnDisabled]}
          onPress={handleRetrySync}
          disabled={isRetrying}
        >
          <Text style={styles.retrySyncBtnText}>
            {isRetrying ? 'Syncing...' : 'Retry Cloud Sync'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.sectionTitle}>{t('profile.localStats')}</Text>
        <StatRow label={t('profile.battles')} value={st.battlesPlayed} />
        <StatRow label={t('profile.wins')} value={`${st.battlesWon} / ${st.battlesLost}`} />
        <StatRow label={t('profile.accuracy')} value={`${accuracy}%`} />
        <StatRow label={t('profile.bestCombo')} value={st.bestCombo} />
        <StatRow label={t('profile.bossesDefeated')} value={st.bossWins} />
      </View>

      {recentBattles.length > 0 && (
        <View style={styles.historyCard}>
          <Text style={styles.sectionTitle}>{t('profile.recentBattles')}</Text>
          {recentBattles.map((b, i) => (
            <View key={b.id || i} style={styles.historyRow}>
              <Text style={styles.historyDate}>{new Date(b.timestamp).toLocaleDateString()}</Text>
              <Text style={styles.historyStage}>{b.stageId}</Text>
              <Text style={[styles.historyResult, { color: b.result === 'VICTORY' ? theme.colors.success : theme.colors.danger }]}>
                {b.result === 'VICTORY' ? t('battleResult.victory') : t('battleResult.defeat')}
              </Text>
              <Text style={styles.historyScore}>{b.score}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.devSection}>
        <Text style={styles.devTitle}>{t('profile.settings')}</Text>
        <Text style={styles.statLabel}>{t('profile.language')}</Text>
        <View style={styles.langRow}>
          <TouchableOpacity
            style={[styles.langBtn, currentLang === LANGUAGE_PREF.SYSTEM && styles.langBtnActive]}
            onPress={() => handleLangChange(LANGUAGE_PREF.SYSTEM)}>
            <Text style={[styles.langBtnText, currentLang === LANGUAGE_PREF.SYSTEM && styles.langBtnTextActive]}>{t('profile.languageSystem')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, currentLang === LANGUAGE_PREF.ZH_TW && styles.langBtnActive]}
            onPress={() => handleLangChange(LANGUAGE_PREF.ZH_TW)}>
            <Text style={[styles.langBtnText, currentLang === LANGUAGE_PREF.ZH_TW && styles.langBtnTextActive]}>{t('profile.languageZhTw')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.langBtn, currentLang === LANGUAGE_PREF.EN && styles.langBtnActive]}
            onPress={() => handleLangChange(LANGUAGE_PREF.EN)}>
            <Text style={[styles.langBtnText, currentLang === LANGUAGE_PREF.EN && styles.langBtnTextActive]}>{t('profile.languageEn')}</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.toggleRow}>
          <Text style={styles.statLabel}>{t('profile.soundEffects')}</Text>
          <TouchableOpacity
            style={[styles.langBtn, soundEffects && styles.langBtnActive]}
            onPress={handleToggleSound}>
            <Text style={[styles.langBtnText, soundEffects && styles.langBtnTextActive]}>
              {soundEffects ? t('profile.on') : t('profile.off')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.statLabel}>{t('profile.haptics')}</Text>
          <TouchableOpacity
            style={[styles.langBtn, haptics && styles.langBtnActive]}
            onPress={handleToggleHaptics}>
            <Text style={[styles.langBtnText, haptics && styles.langBtnTextActive]}>
              {haptics ? t('profile.on') : t('profile.off')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      
      <View style={[styles.devSection, { marginTop: theme.spacing.large }]}>
        <Text style={styles.devTitle}>{t('profile.developerOptions')}</Text>
        <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
          <Text style={styles.resetBtnText}>{t('profile.resetAdventure')}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function StatRow({ label, value }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function formatShortUid(rawId) {
  if (!rawId || rawId === 'guest') return 'guest';
  if (rawId.startsWith('uid:')) {
    const val = rawId.slice(4);
    if (val.length <= 10) return rawId;
    return `uid:${val.slice(0, 6)}...${val.slice(-4)}`;
  }
  return rawId;
}

function resolveCloudSyncState(status, isReady) {
  if (status === 'syncing') return 'SYNCING';
  if (status === 'error') return 'ERROR';
  if (status === 'offline') return 'OFFLINE';
  if (isReady) return 'READY';
  return 'NOT READY';
}

function getCloudSyncStateColor(state) {
  switch (state) {
    case 'READY':
      return '#22c55e'; // Green
    case 'SYNCING':
      return '#3b82f6'; // Blue
    case 'OFFLINE':
      return '#eab308'; // Amber
    case 'ERROR':
      return '#ef4444'; // Red
    case 'NOT READY':
    default:
      return '#94a3b8'; // Slate/gray
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.large,
    paddingTop: 60,
    paddingBottom: 80,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: theme.spacing.large,
  },
  headerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.large,
  },
  avatarPlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.large,
  },
  avatarText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: 4,
  },
  playerXp: {
    fontSize: 16,
    color: theme.colors.textMuted,
  },
  playerStreak: {
    fontSize: 16,
    color: '#DD6B20',
    fontWeight: 'bold',
    marginTop: 4,
  },
  playerEmail: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  authCard: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: theme.spacing.large,
    marginBottom: theme.spacing.large,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  diagnosticCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.primary,
    marginBottom: theme.spacing.large,
  },
  diagnosticTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: 10,
  },
  diagnosticRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  diagnosticLabel: {
    fontSize: 13,
    color: theme.colors.textMuted,
  },
  diagnosticValue: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.colors.textMain,
  },
  warningBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
    padding: theme.spacing.small,
    borderRadius: 4,
    marginBottom: 10,
  },
  warningText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 16,
  },
  retrySyncBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 12,
  },
  retrySyncBtnDisabled: {
    opacity: 0.6,
  },
  retrySyncBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  authStatus: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: 12,
  },
  googleBtn: {
    backgroundColor: '#DB4437',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  googleBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  guestHelpText: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 8,
  },
  signOutBtn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: theme.colors.danger,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  signOutBtnText: {
    color: theme.colors.danger,
    fontSize: 16,
    fontWeight: 'bold',
  },
  statsCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.large,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: theme.spacing.medium,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  statLabel: {
    fontSize: 16,
    color: theme.colors.textMuted,
  },
  statValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
  },
  historyCard: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.large,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  historyDate: { fontSize: 14, color: theme.colors.textMuted, flex: 1 },
  historyStage: { fontSize: 14, color: theme.colors.textMain, flex: 1, textAlign: 'center' },
  historyResult: { fontSize: 14, fontWeight: 'bold', flex: 1, textAlign: 'center' },
  historyScore: { fontSize: 14, color: theme.colors.textMain, flex: 1, textAlign: 'right' },
  devSection: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.danger,
  },
  devTitle: {
    fontSize: 16,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.medium,
  },
  langRow: {
    flexDirection: 'row',
    marginTop: theme.spacing.small,
    marginBottom: theme.spacing.medium,
  },
  langBtn: {
    flex: 1,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    marginRight: 8,
    borderRadius: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
  },
  langBtnActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  langBtnText: {
    color: theme.colors.textMain,
    fontSize: 14,
  },
  langBtnTextActive: {
    color: '#fff',
    fontWeight: 'bold',
  },
  resetBtn: {
    backgroundColor: theme.colors.danger,
    padding: theme.spacing.medium,
    borderRadius: 8,
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  syncStatusText: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    marginBottom: 4,
  }
});

function getSyncStatusLabel(status) {
  switch (status) {
    case 'synced':
      return 'Cloud Sync: Synced';
    case 'syncing':
      return 'Cloud Sync: Syncing...';
    case 'offline':
      return 'Offline — saved on device';
    case 'error':
      return 'Sync error — will retry';
    default:
      return 'Saved on device';
  }
}

function getSyncStatusColor(status) {
  switch (status) {
    case 'synced':
      return '#22c55e'; // green
    case 'syncing':
      return '#3b82f6'; // blue
    case 'offline':
      return '#eab308'; // yellow/amber
    case 'error':
      return '#ef4444'; // red
    default:
      return '#888888';
  }
}
