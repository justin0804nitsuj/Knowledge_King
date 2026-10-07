import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, BackHandler } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { usePvpRoom } from '../context/PvpRoomContext';
import { useOnline } from '../context/OnlineContext';
import { PlayerRole, RoomStatus } from '../domain/pvp/roomConstants';
import { theme } from '../theme';

export default function WaitingRoomScreen({ navigation }) {
  const { t } = useTranslation();
  const { roomId, room, role, isHost, isLoadingRoom, leaveRoom, status } = usePvpRoom();
  const { isOnline } = useOnline();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    console.log('[PvP Lifecycle] WaitingRoom mount');
  }, []);

  useEffect(() => {
    // Wait until room loading finishes before checking deleted status
    if (isLoadingRoom) return;

    // If room is cancelled or deleted, kick guest back to Arena
    if (!room || status === RoomStatus.CANCELLED) {
      if (!isHost) {
        Alert.alert('', t('arena.roomClosed'));
      }
      navigation.navigate('MainTabs', { screen: 'Arena' });
    }
  }, [room, status, isHost, navigation, t, isLoadingRoom]);

  useEffect(() => {
    const onBackPress = () => {
      confirmLeave();
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
            await leaveRoom();
            navigation.navigate('MainTabs', { screen: 'Arena' });
          }
        }
      ]
    );
  };

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
