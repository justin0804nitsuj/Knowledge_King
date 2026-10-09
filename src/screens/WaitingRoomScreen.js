import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, BackHandler, Animated, Easing, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { usePvpRoom } from '../context/PvpRoomContext';
import { useOnline } from '../context/OnlineContext';
import { verifyRoomExists } from '../services/pvp/roomService';
import { PlayerRole, RoomStatus } from '../domain/pvp/roomConstants';
import { processRoomGone, processGuestSnapshot } from '../domain/pvp/departure';
import { theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';

const devLog = (msg) => { if (__DEV__) console.log(msg); };

export default function WaitingRoomScreen({ navigation }) {
  const { t } = useTranslation();
  const { roomId, room, role, isHost, isLoadingRoom, leaveRoom, status, getDepartureIntent, getDepartureSession, setReady, startMatch } = usePvpRoom();
  const { isOnline } = useOnline();
  const [copied, setCopied] = useState(false);
  
  const [startingMatch, setStartingMatch] = useState(false);

  // Animations
  const vsAnim = useRef(new Animated.Value(0)).current;
  const hostReadyAnim = useRef(new Animated.Value(0)).current;
  const guestReadyAnim = useRef(new Animated.Value(0)).current;

  // Previous ready states to trigger animation once
  const prevHostReady = useRef(false);
  const prevGuestReady = useRef(false);

  // isHost is derived from room data and becomes false once the room is
  // cleared, so remember the last known role while the room existed.
  const wasHostRef = useRef(false);
  if (room) wasHostRef.current = isHost;

  const navigatedMatchIdRef = useRef(null);

  useEffect(() => {
    let timer;
    if (status === RoomStatus.IN_BATTLE && room?.match) {
      if (navigatedMatchIdRef.current !== room.match.matchId) {
        navigatedMatchIdRef.current = room.match.matchId;
        setStartingMatch(true);
        // Short local delay for polish, Firebase remains authoritative
        timer = setTimeout(() => {
          navigation.navigate('PvpBattle');
        }, 800);
      }
    }
    return () => { if (timer) clearTimeout(timer); };
  }, [status, room?.match, navigation]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(vsAnim, { toValue: 1, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(vsAnim, { toValue: 0, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [vsAnim]);

  useEffect(() => {
    // Wait until room loading finishes before checking deleted status
    if (isLoadingRoom) return;

    if (!room || status === RoomStatus.CANCELLED) {
      const departureIntent = getDepartureIntent();
      processRoomGone({
        session: getDepartureSession(),
        getCurrentSession: getDepartureSession,
        departureIntent,
        wasHost: wasHostRef.current,
        verify: verifyRoomExists,
        showAlert: (key) => Alert.alert('', t(`arena.${key}`)),
        navigateToArena: () => navigation.navigate('MainTabs', { screen: 'Arena' }),
        log: devLog,
      });
    }
  }, [room, status, isHost, navigation, t, isLoadingRoom, roomId, getDepartureIntent, getDepartureSession]);

  useEffect(() => {
    if (isLoadingRoom || !room || !isHost || status !== RoomStatus.WAITING) return;
    
    const currentGuestUid = Object.keys(room.players || {}).find(
      uid => room.players[uid].role === PlayerRole.GUEST
    );
    
    processGuestSnapshot({
      session: getDepartureSession(),
      getCurrentSession: getDepartureSession,
      departureIntent: getDepartureIntent(),
      wasHost: true,
      currentGuestUid: currentGuestUid || null,
      showAlert: (key) => Alert.alert('', t(`arena.${key}`)),
      log: devLog,
    });
  }, [room, isHost, isLoadingRoom, status, t, getDepartureIntent, getDepartureSession]);

  useEffect(() => {
    const onBackPress = () => {
      confirmLeaveRef.current();
      return true;
    };
    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, []);

  const confirmLeave = () => {
    Alert.alert(
      t('arena.leaveConfirmTitle'),
      '',
      [
        { text: t('profile.cancel'), style: 'cancel' },
        { 
          text: t('profile.confirmReset'), 
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveRoom();
            } catch (e) {
              console.warn('[PVP-TRACE] leaveRoom failed', e?.code || e?.message);
              Alert.alert('', t('arena.leaveFailed'));
              return;
            }
            navigation.navigate('MainTabs', { screen: 'Arena' });
          }
        }
      ]
    );
  };
  const confirmLeaveRef = useRef(confirmLeave);
  confirmLeaveRef.current = confirmLeave;

  const copyCode = async () => {
    if (!roomId) return;
    await Clipboard.setStringAsync(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hostUid = room?.meta?.hostUid;
  const hostPlayer = hostUid && room?.players?.[hostUid];
  const guestUid = Object.keys(room?.players || {}).find(uid => uid !== hostUid);
  const guestPlayer = guestUid ? room?.players?.[guestUid] : null;

  const hostReady = hostPlayer?.ready === true;
  const guestReady = guestPlayer?.ready === true;
  const isBothReady = hostReady && guestReady;
  const myReady = isHost ? hostReady : guestReady;

  // Trigger local animation when ready state changes to true
  useEffect(() => {
    if (hostReady && !prevHostReady.current) {
      hostReadyAnim.setValue(0);
      Animated.spring(hostReadyAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();
    }
    prevHostReady.current = hostReady;
  }, [hostReady, hostReadyAnim]);

  useEffect(() => {
    if (guestReady && !prevGuestReady.current) {
      guestReadyAnim.setValue(0);
      Animated.spring(guestReadyAnim, { toValue: 1, friction: 3, tension: 40, useNativeDriver: true }).start();
    }
    prevGuestReady.current = guestReady;
  }, [guestReady, guestReadyAnim]);

  if (!room) return <View style={styles.container} />;

  // Determine messaging
  let statusMessage = t('arena.waitingForOpponent', 'Waiting for opponent...');
  if (guestPlayer) {
    if (isBothReady) {
      statusMessage = isHost ? t('arena.hostCanStart', 'Host can start the match') : t('arena.bothReady', 'Both players ready');
    } else {
      statusMessage = t('arena.waitingForReady', 'Waiting for both players to ready');
    }
  }

  const vsScale = vsAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });

  const renderPlayerCard = (isHostCard, player, isReady, animVal) => {
    const roleKey = isHostCard ? 'arena.host' : 'arena.guest';
    const iconName = isHostCard ? "shield-half" : "game-controller";
    const displayName = player ? player.displayName : (isHostCard ? '...' : t('arena.waitingChallenger', 'Waiting...'));
    
    const cardScale = animVal.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [1, 1.05, 1]
    });

    return (
      <Animated.View style={[styles.playerCard, { transform: [{ scale: cardScale }] }, isReady && styles.playerCardReady]}>
        <View style={styles.roleBadge}>
          <Ionicons name={iconName} size={14} color="#fff" />
          <Text style={styles.roleBadgeText}>{t(roleKey, isHostCard ? 'HOST' : 'GUEST')}</Text>
        </View>
        
        <Ionicons 
          name="person-circle" 
          size={56} 
          color={player ? (isHostCard ? theme.colors.primary : theme.colors.secondary) : theme.colors.textMuted} 
          style={styles.avatarIcon}
        />
        <Text style={styles.playerName} numberOfLines={1}>{displayName}</Text>
        
        {player && (
          <View style={styles.connectionStatus}>
            <View style={styles.onlineDot} />
            <Text style={styles.connectionText}>{t('arena.connected', 'Connected')}</Text>
          </View>
        )}
        
        {player && (
          <View style={[styles.readyBadge, isReady ? styles.readyBadgeActive : styles.readyBadgeInactive]}>
            {isReady && <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} style={{ marginRight: 4 }} />}
            <Text style={[styles.readyBadgeText, isReady && styles.readyBadgeTextActive]}>
              {isReady ? t('arena.ready', 'Ready') : t('arena.notReady', 'Not Ready')}
            </Text>
          </View>
        )}
      </Animated.View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('arena.waitingRoom', 'WAITING ROOM')}</Text>
        <Text style={styles.statusMessage}>{statusMessage}</Text>
      </View>
      
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="warning" size={16} color={theme.colors.textMain} style={{ marginRight: 8 }} />
          <Text style={styles.offlineText}>{t('arena.reconnecting', 'Reconnecting...')}</Text>
        </View>
      )}

      <View style={styles.codeSection}>
        <Text style={styles.codeLabel}>{t('arena.roomCode', 'ROOM CODE')}</Text>
        <TouchableOpacity style={styles.codeButton} onPress={copyCode}>
          <Text style={styles.codeText}>{roomId}</Text>
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={24} color={theme.colors.primary} />
        </TouchableOpacity>
        <Text style={styles.copyHint}>{copied ? t('arena.copied', 'Copied to clipboard!') : t('arena.tapToCopy', 'Tap to copy')}</Text>
      </View>

      <View style={styles.battleArena}>
        {renderPlayerCard(true, hostPlayer, hostReady, hostReadyAnim)}
        
        <Animated.View style={[styles.vsContainer, { transform: [{ scale: vsScale }] }]}>
          <Text style={styles.vsText}>VS</Text>
        </Animated.View>
        
        {renderPlayerCard(false, guestPlayer, guestReady, guestReadyAnim)}
      </View>

      <View style={styles.actionContainer}>
        {isHost && guestPlayer && isBothReady ? (
          <TouchableOpacity style={styles.startBtn} onPress={async () => {
            try {
              await startMatch();
            } catch (e) {
              console.warn("Start Match Failed:", e);
              Alert.alert('', t('arena.startFailed') || "Failed to start match.");
            }
          }}>
            <Ionicons name="play" size={24} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.startBtnText}>{t('arena.startMatch', 'START MATCH')}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity 
            style={[styles.readyBtn, myReady && styles.readyBtnActive]} 
            onPress={async () => {
              try {
                await setReady(!myReady);
              } catch (e) {
                console.warn("Set Ready Failed:", e);
                Alert.alert('', t('arena.readyFailed') || "Failed to update ready state.");
              }
            }}
          >
            <Ionicons name={myReady ? "close-circle" : "checkmark-circle"} size={24} color={myReady ? theme.colors.textMain : theme.colors.primary} style={{ marginRight: 8 }} />
            <Text style={[styles.readyBtnText, myReady && { color: theme.colors.textMain }]}>
              {myReady ? t('arena.cancelReady', 'CANCEL READY') : t('arena.ready', 'I AM READY')}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.leaveBtn} onPress={confirmLeave}>
        <Ionicons name="exit-outline" size={20} color={theme.colors.danger} style={{ marginRight: 8 }} />
        <Text style={styles.leaveBtnText}>{t('arena.leaveRoom', 'Leave Room')}</Text>
      </TouchableOpacity>

      {startingMatch && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>{t('arena.battleStarting', 'Battle Starting...')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.large,
    backgroundColor: theme.colors.background,
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: theme.colors.textMain,
    letterSpacing: 2,
    marginBottom: 8,
  },
  statusMessage: {
    fontSize: 16,
    color: theme.colors.primary,
    fontWeight: 'bold',
  },
  offlineBanner: {
    flexDirection: 'row',
    backgroundColor: theme.colors.warning,
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineText: {
    color: theme.colors.textMain,
    fontWeight: 'bold',
  },
  codeSection: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    marginBottom: 32,
  },
  codeLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.colors.textMuted,
    letterSpacing: 1,
    marginBottom: 8,
  },
  codeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.background,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    marginBottom: 8,
  },
  codeText: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: 8,
    color: theme.colors.primary,
    marginRight: 16,
  },
  copyHint: {
    color: theme.colors.textMuted,
    fontSize: 12,
  },
  battleArena: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
  },
  playerCard: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    minHeight: 180,
  },
  playerCardReady: {
    borderColor: theme.colors.success,
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.textMuted,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: 12,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#fff',
    marginLeft: 4,
  },
  avatarIcon: {
    marginBottom: 8,
  },
  playerName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: 8,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.success,
    marginRight: 4,
  },
  connectionText: {
    fontSize: 10,
    color: theme.colors.textMuted,
  },
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 'auto',
  },
  readyBadgeInactive: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  readyBadgeActive: {
    backgroundColor: 'transparent',
  },
  readyBadgeText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.colors.textMuted,
  },
  readyBadgeTextActive: {
    color: theme.colors.success,
  },
  vsContainer: {
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  vsText: {
    fontSize: 24,
    fontWeight: '900',
    color: theme.colors.textMuted,
    fontStyle: 'italic',
  },
  actionContainer: {
    marginBottom: 20,
  },
  readyBtn: {
    flexDirection: 'row',
    backgroundColor: theme.colors.card,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyBtnActive: {
    backgroundColor: theme.colors.primary,
  },
  readyBtnText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  startBtn: {
    flexDirection: 'row',
    backgroundColor: theme.colors.success,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.colors.success,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  startBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1,
  },
  leaveBtn: {
    flexDirection: 'row',
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 'auto',
    marginBottom: 10,
  },
  leaveBtnText: {
    color: theme.colors.danger,
    fontSize: 16,
    fontWeight: 'bold',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  overlayText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 16,
    letterSpacing: 1,
  },
});
