import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { theme } from '../theme';
import { resetCampaignProgress } from '../storage/campaignStorage';
import { loadPlayerProgress } from '../storage/playerProgressStorage';
import { loadBattleHistory } from '../storage/battleHistoryStorage';
import { getPlayerLevelInfo } from '../domain/player/levelSystem';
import { useAuth } from '../context/AuthContext';

export default function ProfileScreen({ navigation }) {
  const [playerInfo, setPlayerInfo] = useState(null);
  const [recentBattles, setRecentBattles] = useState([]);
  const { user, isSignedIn, signInWithGoogle, signOut, isInitializing } = useAuth();
  
  useFocusEffect(
    useCallback(() => {
      async function loadData() {
        const p = await loadPlayerProgress();
        setPlayerInfo(p);
        
        const hObj = await loadBattleHistory();
        setRecentBattles(hObj.records.slice(0, 5));
      }
      loadData();
    }, [])
  );

  const handleReset = () => {
    Alert.alert(
      "Reset Adventure Progress",
      "Are you sure you want to completely wipe all campaign progress? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Reset", 
          style: "destructive",
          onPress: async () => {
            await resetCampaignProgress();
            Alert.alert("Success", "Adventure progress has been reset.");
          }
        }
      ]
    );
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

  if (!playerInfo || isInitializing) {
    return <View style={styles.container}><Text>Loading...</Text></View>;
  }

  const { level } = getPlayerLevelInfo(playerInfo.totalXp);
  const st = playerInfo.stats;
  
  const accuracy = st.totalQuestions > 0 ? Math.round((st.totalCorrect / st.totalQuestions) * 100) : 0;
  const winRate = st.battlesPlayed > 0 ? Math.round((st.battlesWon / st.battlesPlayed) * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Player Profile</Text>

      <View style={styles.headerCard}>
        <View style={styles.avatarPlaceholder}><Text style={styles.avatarText}>L{level}</Text></View>
        <View style={styles.headerInfo}>
          <Text style={styles.playerName}>{isSignedIn ? user?.displayName : 'Local Player'}</Text>
          {isSignedIn && <Text style={styles.playerEmail}>{user?.email}</Text>}
          <Text style={styles.playerXp}>Total XP: {playerInfo.totalXp}</Text>
          <Text style={styles.playerStreak}>Streak: {playerInfo.daily.streak} Days</Text>
        </View>
      </View>

      <View style={styles.authCard}>
        {isSignedIn ? (
          <>
            <Text style={styles.authStatus}>Signed in with Google</Text>
            <TouchableOpacity style={styles.signOutBtn} onPress={handleLogout}>
              <Text style={styles.signOutBtnText}>Sign Out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.authStatus}>You are currently a Guest.</Text>
            <TouchableOpacity style={styles.googleBtn} onPress={handleLogin}>
              <Text style={styles.googleBtnText}>Sign in with Google</Text>
            </TouchableOpacity>
            <Text style={styles.guestHelpText}>Continue as Guest to play offline.</Text>
          </>
        )}
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.sectionTitle}>Lifetime Statistics</Text>
        <StatRow label="Battles Played" value={st.battlesPlayed} />
        <StatRow label="Wins / Losses" value={`${st.battlesWon} / ${st.battlesLost}`} />
        <StatRow label="Win Rate" value={`${winRate}%`} />
        <StatRow label="Total Questions" value={st.totalQuestions} />
        <StatRow label="Overall Accuracy" value={`${accuracy}%`} />
        <StatRow label="Best Combo" value={st.bestCombo} />
        <StatRow label="Bosses Defeated" value={st.bossWins} />
        <StatRow label="Perfect Victories" value={st.perfectVictories} />
      </View>

      {recentBattles.length > 0 && (
        <View style={styles.historyCard}>
          <Text style={styles.sectionTitle}>Recent Battles</Text>
          {recentBattles.map((b, i) => (
            <View key={b.id || i} style={styles.historyRow}>
              <Text style={styles.historyDate}>{new Date(b.timestamp).toLocaleDateString()}</Text>
              <Text style={styles.historyStage}>{b.stageId}</Text>
              <Text style={[styles.historyResult, { color: b.result === 'VICTORY' ? theme.colors.success : theme.colors.danger }]}>
                {b.result}
              </Text>
              <Text style={styles.historyScore}>{b.score} pts</Text>
            </View>
          ))}
        </View>
      )}
      
      <View style={styles.devSection}>
        <Text style={styles.devTitle}>Developer / Local Data</Text>
        <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
          <Text style={styles.resetBtnText}>Reset Adventure Progress</Text>
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
  resetBtn: {
    backgroundColor: theme.colors.danger,
    padding: theme.spacing.medium,
    borderRadius: 8,
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  }
});
