import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { useTranslation } from 'react-i18next';
import { subscribeToMatchState } from '../services/pvp/pvpBattleService';
import { leaveRoom } from '../services/pvp/roomService';

export default function PvpResultScreen({ navigation }) {
  const { roomId, room, user, isHost } = usePvpRoom();
  const { t } = useTranslation();
  const [matchState, setMatchState] = useState(null);

  useEffect(() => {
    if (roomId) {
      const unsubscribe = subscribeToMatchState(roomId, (data) => {
        setMatchState(data);
      });
      return unsubscribe;
    }
  }, [roomId]);

  if (!matchState || !matchState.result) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading match result...</Text>
      </View>
    );
  }

  const { result, players } = matchState;
  const myUid = user.uid;
  const hostUid = room?.meta?.hostUid;
  const guestUid = Object.keys(room?.players || {}).find(uid => uid !== hostUid);
  const opponentUid = myUid === hostUid ? guestUid : hostUid;

  const myState = players?.[myUid];
  const oppState = players?.[opponentUid];

  let outcomeText = 'DRAW';
  let outcomeStyle = styles.drawText;
  if (result.winnerUid === myUid) {
    outcomeText = 'VICTORY';
    outcomeStyle = styles.victoryText;
  } else if (result.winnerUid === opponentUid) {
    outcomeText = 'DEFEAT';
    outcomeStyle = styles.defeatText;
  }

  const handleLeave = async () => {
    try {
      if (roomId && user?.uid) {
        await leaveRoom(roomId, user.uid, isHost);
      }
    } catch (e) {
      console.error('Failed to leave room:', e);
    } finally {
      navigation.replace('Arena');
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.outcomeTitle, outcomeStyle]}>{outcomeText}</Text>
      
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Match Result</Text>
        
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>You</Text>
            <Text style={styles.statScore}>{myState?.score || 0}</Text>
            <Text style={styles.statSub}>Correct: {myState?.correct || 0}</Text>
            <Text style={styles.statSub}>Wrong: {myState?.wrong || 0}</Text>
          </View>
          
          <View style={styles.vsBox}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Opponent</Text>
            <Text style={styles.statScore}>{oppState?.score || 0}</Text>
            <Text style={styles.statSub}>Correct: {oppState?.correct || 0}</Text>
            <Text style={styles.statSub}>Wrong: {oppState?.wrong || 0}</Text>
          </View>
        </View>
      </View>

      <Text style={styles.matchIdText}>Match ID: {room?.match?.matchId}</Text>

      <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
        <Text style={styles.leaveButtonText}>Back to Arena</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.large,
    justifyContent: 'center',
  },
  loadingText: {
    color: theme.colors.textMain,
    fontSize: 18,
    textAlign: 'center',
  },
  outcomeTitle: {
    fontSize: 48,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 40,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  victoryText: {
    color: theme.colors.success,
  },
  defeatText: {
    color: theme.colors.danger,
  },
  drawText: {
    color: theme.colors.secondary,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: theme.spacing.large,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: 24,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 16,
    color: theme.colors.textMuted,
    marginBottom: 8,
  },
  statScore: {
    fontSize: 36,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: 8,
  },
  statSub: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 4,
  },
  vsBox: {
    paddingHorizontal: 16,
  },
  vsText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textMuted,
  },
  matchIdText: {
    fontSize: 12,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 40,
  },
  leaveButton: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.large,
    borderRadius: 8,
    alignItems: 'center',
  },
  leaveButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
