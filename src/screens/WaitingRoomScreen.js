import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { usePvpRoom } from '../context/PvpRoomContext';
import { useOnline } from '../context/OnlineContext';
import { verifyRoomExists } from '../services/pvp/roomService';
import { PlayerRole, RoomStatus } from '../domain/pvp/roomConstants';
import { processRoomGone, processGuestSnapshot } from '../domain/pvp/departure';
import { theme } from '../theme';

const devLog = (msg) => { if (__DEV__) console.log(msg); };

export default function WaitingRoomScreen({ navigation }) {
  const { t } = useTranslation();
  const { roomId, room, role, isHost, isLoadingRoom, leaveRoom, status, getDepartureIntent, getDepartureSession } = usePvpRoom();
  const { isOnline } = useOnline();
  const [copied, setCopied] = useState(false);

  // isHost is derived from room data and becomes false once the room is
  // cleared, so remember the last known role while the room existed.
  const wasHostRef = useRef(false);
  if (room) wasHostRef.current = isHost;

  useEffect(() => {
    console.log('[PVP-TRACE] WAITING mount');
  }, []);

  useEffect(() => {
    console.log(`[PVP-TRACE] WAITING isLoadingRoom=${isLoadingRoom}`);
    // Wait until room loading finishes before checking deleted status
    if (isLoadingRoom) return;

    // Log diagnostic snapshot
    console.log('[PVP-TRACE] snapshot:\n' + JSON.stringify({
      exists: !!room,
      hostUid: room?.meta?.hostUid || null,
      status: room?.meta?.status || null,
      players: Object.keys(room?.players || {}),
      hostPlayerExists: !!(room?.meta?.hostUid && room?.players?.[room.meta.hostUid])
    }, null, 2));

    // If room is cancelled or deleted, kick guest back to Arena.
    // processRoomGone claims a per-session one-shot guard synchronously, so
    // repeated null/CANCELLED snapshots or effect reruns alert/navigate once.
    if (!room || status === RoomStatus.CANCELLED) {
      const departureIntent = getDepartureIntent();
      console.log(`[PVP-TRACE] WAITING reason for redirect: room=${!!room}, status=${status}, intent=${departureIntent}`);
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

  // Track Guest presence to alert Host when Guest leaves (transition-based,
  // stored in the room session so remounts/reruns cannot re-alert).
  useEffect(() => {
    if (isLoadingRoom || !room || !isHost || status !== RoomStatus.WAITING) return;
    
    // Find current Guest
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
      return true; // Prevent default back
    };
    BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => BackHandler.removeEventListener('hardwareBackPress', onBackPress);
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
              // Leave failed: stay in room (intent already reset by context).
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
  // Keep the hardware back handler pointed at the latest confirmLeave/leaveRoom.
  const confirmLeaveRef = useRef(confirmLeave);
  confirmLeaveRef.current = confirmLeave;

  const copyCode = async () => {
    if (!roomId) return;
    await Clipboard.setStringAsync(roomId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Find host and guest
  const hostUid = room?.meta?.hostUid;
  const hostPlayer = hostUid && room?.players?.[hostUid];
  const guestUid = Object.keys(room?.players || {}).find(uid => uid !== hostUid);
  const guestPlayer = guestUid ? room?.players?.[guestUid] : null;

  if (!room) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('arena.waitingRoom')}</Text>
      
      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>{t('arena.reconnecting')}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.label}>{t('arena.roomCode')}</Text>
        <TouchableOpacity style={styles.codeContainer} onPress={copyCode}>
          <Text style={styles.codeText}>{roomId}</Text>
        </TouchableOpacity>
        <Text style={styles.copyHint}>{copied ? t('arena.copied') : t('arena.tapToCopy')}</Text>
      </View>

      <View style={styles.playersContainer}>
        <View style={styles.playerSlot}>
          <Text style={styles.roleLabel}>HOST</Text>
          <Text style={styles.playerName}>{hostPlayer ? hostPlayer.displayName : '...'}</Text>
          <Text style={styles.playerStatus}>{hostPlayer ? t('arena.connected') : ''}</Text>
        </View>

        <View style={styles.vsContainer}>
          <Text style={styles.vsText}>VS</Text>
        </View>

        <View style={styles.playerSlot}>
          <Text style={styles.roleLabel}>GUEST</Text>
          <Text style={styles.playerName}>{guestPlayer ? guestPlayer.displayName : t('arena.waitingForPlayer')}</Text>
          <Text style={styles.playerStatus}>{guestPlayer ? t('arena.connected') : ''}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.leaveBtn} onPress={confirmLeave}>
        <Text style={styles.leaveBtnText}>{t('arena.leaveRoom')}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.large,
    backgroundColor: theme.colors.background,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: theme.spacing.medium,
    marginTop: 40,
  },
  offlineBanner: {
    backgroundColor: theme.colors.warning,
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
    alignItems: 'center',
  },
  offlineText: {
    color: theme.colors.textMain,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: theme.spacing.large,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    marginBottom: 24,
  },
  label: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 8,
  },
  codeContainer: {
    backgroundColor: theme.colors.background,
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: 8,
  },
  codeText: {
    fontSize: 40,
    fontWeight: 'bold',
    letterSpacing: 4,
    color: theme.colors.primary,
  },
  copyHint: {
    color: theme.colors.textMuted,
    fontSize: 14,
  },
  playersContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 32,
  },
  playerSlot: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    minHeight: 120,
    justifyContent: 'center',
  },
  roleLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.colors.textMuted,
    marginBottom: 8,
  },
  playerName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: 4,
  },
  playerStatus: {
    fontSize: 12,
    color: theme.colors.success,
  },
  vsContainer: {
    paddingHorizontal: 16,
  },
  vsText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textMuted,
  },
  leaveBtn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: theme.colors.danger,
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 'auto',
    marginBottom: 20,
  },
  leaveBtnText: {
    color: theme.colors.danger,
    fontSize: 18,
    fontWeight: 'bold',
  }
});
