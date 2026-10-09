import React, { useEffect, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, BackHandler } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { useTranslation } from 'react-i18next';
import { subscribeToMatchState } from '../services/pvp/pvpBattleService';
import { leaveRoom } from '../services/pvp/roomService';
import { gameFeedback } from '../services/feedback/gameFeedback';
import { PVP_ITEMS } from '../domain/pvp/pvpItems';

export default function PvpResultScreen({ navigation }) {
  const { roomId, room, user } = usePvpRoom();
  const { t } = useTranslation();
  const [matchState, setMatchState] = useState(null);
  const animValue = useRef(new Animated.Value(0)).current;
  const playedResultRef = useRef(null);
  const leavingRef = useRef(false);

  const handleLeave = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    try {
      if (roomId && user?.uid) await leaveRoom(roomId, user);
    } catch (e) {
      console.error('Failed to leave room:', e);
    } finally {
      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs', params: { screen: 'Arena' } }]
      });
    }
  }, [roomId, user, navigation]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      handleLeave();
      return true;
    });
    return () => subscription.remove();
  }, [handleLeave]);

  useEffect(() => {
    gameFeedback.init();
    return () => gameFeedback.cleanup();
  }, []);

  useEffect(() => {
    if (roomId) {
      const unsubscribe = subscribeToMatchState(roomId, (data) => {
        setMatchState(data);
      });
      return unsubscribe;
    }
  }, [roomId]);

  const result = matchState?.result;
  const myUid = user?.uid;
  const hostUid = room?.meta?.hostUid;
  const guestUid = Object.keys(room?.players || {}).find(uid => uid !== hostUid);
  const opponentUid = myUid === hostUid ? guestUid : hostUid;
  const matchId = room?.match?.matchId;

  useEffect(() => {
    if (!result || !matchId || !myUid || !opponentUid) return;

    const eventKey = `${matchId}:${result.winnerUid ?? 'DRAW'}`;

    if (playedResultRef.current === eventKey) return;

    playedResultRef.current = eventKey;

    if (result.winnerUid === myUid) {
      gameFeedback.playVictory();
    } else if (result.winnerUid === opponentUid) {
      gameFeedback.playDefeat();
    } else {
      gameFeedback.playDraw();
    }
  }, [result, matchId, myUid, opponentUid]);
  
  useEffect(() => {
    if (!result) return;
    const anim = Animated.timing(animValue, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [result, animValue]);

  if (!matchState || !matchState.result) {
    return (
      <View style={styles.container}>
        <Text style={styles.loadingText}>Loading match result...</Text>
      </View>
    );
  }

  const { players } = matchState;
  const myState = players?.[myUid];
  const oppState = players?.[opponentUid];

  let outcomeText = t('pvp.draw');
  let outcomeStyle = styles.drawText;
  if (result.winnerUid === myUid) {
    outcomeText = t('pvp.victory');
    outcomeStyle = styles.victoryText;
  } else if (result.winnerUid === opponentUid) {
    outcomeText = t('pvp.defeat');
    outcomeStyle = styles.defeatText;
  }
  
  const myFinalHp = result.finalHp?.[myUid] || 0;
  const oppFinalHp = result.finalHp?.[opponentUid] || 0;
  
  const calculateItemsUsed = (state) => {
    if (!state?.items) return 0;
    return Object.keys(state.items).reduce((acc, itemId) => {
      const starting = PVP_ITEMS[itemId]?.startingCount || 0;
      const remaining = state.items[itemId]?.remaining || 0;
      return acc + (starting - remaining);
    }, 0);
  };

  const myItemsUsed = calculateItemsUsed(myState);
  const oppItemsUsed = calculateItemsUsed(oppState);

  const scaleAnim = animValue.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.5, 1.2, 1]
  });

  return (
    <View style={styles.container}>
      <Animated.Text style={[styles.outcomeTitle, outcomeStyle, { opacity: animValue, transform: [{ scale: scaleAnim }] }]}>
        {outcomeText}
      </Animated.Text>
      
      <Animated.View style={[styles.card, { opacity: animValue }]}>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('pvp.you')}</Text>
            <Text style={styles.statHp}>{t('pvp.finalHp')}: {myFinalHp}</Text>
            <Text style={styles.statSub}>{t('battle.score')}: {myState?.score || 0}</Text>
            <Text style={styles.statSub}>{t('pvp.correct')}: {myState?.correct || 0}</Text>
            <Text style={styles.statSub}>{t('pvp.wrong')}: {myState?.wrong || 0}</Text>
            <Text style={styles.statSub}>{t('pvp.itemsUsed')}: {myItemsUsed}</Text>
          </View>
          
          <View style={styles.vsBox}>
            <Text style={styles.vsText}>VS</Text>
          </View>
          
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>{t('pvp.opponent')}</Text>
            <Text style={styles.statHp}>{t('pvp.finalHp')}: {oppFinalHp}</Text>
            <Text style={styles.statSub}>{t('battle.score')}: {oppState?.score || 0}</Text>
            <Text style={styles.statSub}>{t('pvp.correct')}: {oppState?.correct || 0}</Text>
            <Text style={styles.statSub}>{t('pvp.wrong')}: {oppState?.wrong || 0}</Text>
            <Text style={styles.statSub}>{t('pvp.itemsUsed')}: {oppItemsUsed}</Text>
          </View>
        </View>
      </Animated.View>

      <Text style={styles.matchIdText}>Match ID: {room?.match?.matchId}</Text>

      <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
        <Text style={styles.leaveButtonText}>{t('arena.leaveRoom')}</Text>
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
  statHp: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.success,
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
