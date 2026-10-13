import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { usePvpRoom } from '../context/PvpRoomContext';
import { useOnline } from '../context/OnlineContext';
import { useTranslation } from 'react-i18next';
import { theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import LoadoutEditorModal from '../components/pvp/LoadoutEditorModal';
import { loadoutToCardList, TOTAL_DECK_SIZE } from '../domain/pvp/pvpLoadout';
import { ITEM_TYPES, PVP_ITEMS } from '../domain/pvp/pvpItems';

function getSkillMeta(skill, t) {
  switch (skill) {
    case ITEM_TYPES.HEAL:
      return { icon: 'medkit', color: '#10B981', name: t('pvpItems.healName', 'Heal') };
    case ITEM_TYPES.SHIELD:
      return { icon: 'shield', color: '#3B82F6', name: t('pvpItems.shieldName', 'Shield') };
    case ITEM_TYPES.POWER:
      return { icon: 'flash', color: '#F59E0B', name: t('pvpItems.powerName', 'Power') };
    default:
      return { icon: 'help-circle', color: '#9CA3AF', name: skill };
  }
}

export default function ArenaScreen({ navigation }) {
  const { isSignedIn, signInWithGoogle } = useAuth();
  const { isOnline } = useOnline();
  const { createRoom, joinRoom, currentLoadout, saveLoadout } = usePvpRoom();
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  
  // Join Room State
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      console.warn('Arena Sign In failed:', e);
    }
  };

  const handleCreateRoom = async () => {
    if (isCreating || isJoining) return;
    setIsCreating(true);
    try {
      await createRoom();
      console.log('[PvP Lifecycle] CREATE success');
      navigation.navigate('WaitingRoom');
    } catch (e) {
      console.error(e);
      let errorMsg = t('arena.createError');
      if (e.code === 'AUTH_REQUIRED') {
        errorMsg = t('arena.authRequired');
      } else if (e.code === 'PERMISSION_DENIED' || (e.message && e.message.includes('permission_denied'))) {
        errorMsg = t('arena.permissionDenied');
      } else if (e.code === 'ROOM_CODE_EXHAUSTED') {
        errorMsg = t('arena.roomCodeExhausted');
      } else if (!isOnline || e.message?.includes('network')) {
        errorMsg = t('arena.networkError');
      }
      alert(errorMsg);
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async () => {
    if (code.length !== 5 || isJoining || isCreating) return;
    setIsJoining(true);
    setJoinError('');
    try {
      await joinRoom(code);
      console.log('[PvP Lifecycle] JOIN success');
      navigation.navigate('WaitingRoom');
    } catch (e) {
      console.error(e);
      let localizedError = t('arena.joinError');
      if (e.code === 'ROOM_NOT_FOUND') localizedError = t('arena.roomNotFound');
      else if (e.code === 'ROOM_FULL') localizedError = t('arena.roomFull');
      else if (e.code === 'SELF_JOIN') localizedError = t('arena.selfJoin');
      else if (e.code === 'AUTH_REQUIRED') localizedError = t('arena.authRequired');
      else if (e.code === 'INCOMPATIBLE') localizedError = t('arena.incompatible');
      else if (e.code === 'ROOM_NOT_JOINABLE') localizedError = t('arena.roomNotJoinable');
      else if (e.code === 'PERMISSION_DENIED' || e.message?.includes('permission_denied')) localizedError = t('arena.permissionDenied');
      else if (!isOnline || e.message?.includes('network')) localizedError = t('arena.networkError');
      
      setJoinError(localizedError);
    } finally {
      setIsJoining(false);
    }
  };

  React.useEffect(() => {
    return () => console.log('[PvP Lifecycle] Arena unmount');
  }, []);

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Ionicons name="shield-checkmark" size={48} color={theme.colors.primary} style={styles.headerIcon} />
          <Text style={styles.title}>{t('navigation.arena')}</Text>
          <Text style={styles.subtitle}>{t('arena.subtitle', 'Battle against players online')}</Text>
        </View>
        
        {!isOnline ? (
          <View style={styles.card}>
            <Ionicons name="cloud-offline" size={32} color={theme.colors.warning} />
            <Text style={[styles.message, { marginTop: 12 }]}>{t('arena.offlineMessage')}</Text>
          </View>
        ) : !isSignedIn ? (
          <View style={styles.card}>
            <Ionicons name="person-circle-outline" size={48} color={theme.colors.textMuted} />
            <Text style={[styles.message, { marginTop: 12 }]}>{t('arena.googleRequirement')}</Text>
            <TouchableOpacity style={styles.googleBtn} onPress={handleSignIn}>
              <Ionicons name="logo-google" size={20} color="#fff" style={{ marginRight: 8 }} />
              <Text style={styles.googleBtnText}>{t('profile.signInWithGoogle')}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={[styles.card, styles.loadoutCard]}>
              <View style={styles.loadoutHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="layers" size={22} color={theme.colors.secondary} style={{ marginRight: 8 }} />
                  <Text style={styles.loadoutTitle}>{t('pvpLoadout.title', 'Battle Loadout')}</Text>
                </View>
                <Text style={styles.loadoutCount}>
                  {t('pvpLoadout.deckCount', { count: TOTAL_DECK_SIZE, total: TOTAL_DECK_SIZE })}
                </Text>
              </View>

              <View style={styles.loadoutSlotsRow}>
                {loadoutToCardList(currentLoadout).map((card, idx) => {
                  const meta = getSkillMeta(card, t);
                  return (
                    <View key={`arena-card-${idx}`} style={[styles.loadoutSlot, { borderColor: meta.color, backgroundColor: `${meta.color}15` }]}>
                      <Ionicons name={meta.icon} size={18} color={meta.color} />
                      <Text style={[styles.loadoutSlotText, { color: meta.color }]}>{meta.name.split(' ')[0]}</Text>
                    </View>
                  );
                })}
              </View>

              <TouchableOpacity
                style={styles.editLoadoutBtn}
                onPress={() => setEditorVisible(true)}
                testID="arenaEditLoadoutBtn"
              >
                <Ionicons name="create-outline" size={18} color={theme.colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.editLoadoutBtnText}>{t('pvpLoadout.edit', 'Edit Deck')}</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.card, styles.createCard]}>
              <View style={styles.cardHeader}>
                <Ionicons name="add-circle" size={24} color={theme.colors.primary} />
                <Text style={styles.cardTitle}>{t('arena.createRoom')}</Text>
              </View>
              <Text style={styles.cardDesc}>{t('arena.createDesc', 'Host a new match and invite a friend')}</Text>
              <TouchableOpacity 
                style={[styles.primaryBtn, (isCreating || isJoining) && styles.disabledBtn]} 
                onPress={handleCreateRoom}
                disabled={isCreating || isJoining}
              >
                {isCreating ? (
                  <View style={styles.btnContent}>
                    <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.btnText}>{t('arena.creating', 'Creating room...')}</Text>
                  </View>
                ) : (
                  <Text style={styles.btnText}>{t('arena.createRoomAction', 'CREATE ROOM')}</Text>
                )}
              </TouchableOpacity>
            </View>
            
            <View style={[styles.card, styles.joinCard]}>
              <View style={styles.cardHeader}>
                <Ionicons name="enter" size={24} color={theme.colors.secondary} />
                <Text style={styles.cardTitle}>{t('arena.joinRoom')}</Text>
              </View>
              <Text style={styles.cardDesc}>{t('arena.joinDesc', 'Enter a 5-digit code to join a match')}</Text>
              
              <TextInput
                style={styles.input}
                keyboardType="numeric"
                maxLength={5}
                value={code}
                onChangeText={(text) => {
                  setCode(text.toUpperCase().replace(/[^0-9]/g, ''));
                  setJoinError('');
                }}
                editable={!isJoining && !isCreating}
                placeholder="12345"
                placeholderTextColor={theme.colors.border}
                autoCapitalize="characters"
              />
              
              {!!joinError && (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={16} color={theme.colors.danger} />
                  <Text style={styles.errorText}>{joinError}</Text>
                </View>
              )}

              <TouchableOpacity 
                style={[styles.secondaryBtn, (isJoining || isCreating || code.length !== 5) && styles.disabledBtn]} 
                onPress={handleJoinRoom}
                disabled={isJoining || isCreating || code.length !== 5}
              >
                {isJoining ? (
                  <View style={styles.btnContent}>
                    <ActivityIndicator color={theme.colors.primary} style={{ marginRight: 8 }} />
                    <Text style={styles.secondaryBtnText}>{t('arena.joining', 'Joining room...')}</Text>
                  </View>
                ) : (
                  <Text style={styles.secondaryBtnText}>{t('arena.joinRoomAction', 'JOIN ROOM')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
      </ScrollView>

      <LoadoutEditorModal
        visible={editorVisible}
        initialLoadout={currentLoadout}
        onSave={saveLoadout}
        onClose={() => setEditorVisible(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.large,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
  },
  headerIcon: {
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '900',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  createCard: {
    borderColor: theme.colors.primary,
    borderWidth: 2,
  },
  joinCard: {
    borderColor: theme.colors.secondary,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginLeft: 8,
  },
  cardDesc: {
    fontSize: 14,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: 20,
  },
  message: {
    fontSize: 16,
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: 20,
  },
  googleBtn: {
    flexDirection: 'row',
    backgroundColor: '#DB4437',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.5,
  },
  btnContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  secondaryBtnText: {
    color: theme.colors.primary,
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  input: {
    backgroundColor: theme.colors.background,
    borderWidth: 2,
    borderColor: theme.colors.border,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    fontSize: 32,
    letterSpacing: 12,
    textAlign: 'center',
    width: '100%',
    color: theme.colors.textMain,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    padding: 8,
    borderRadius: 8,
    width: '100%',
    justifyContent: 'center',
  },
  errorText: {
    color: theme.colors.danger,
    marginLeft: 6,
    fontSize: 14,
    fontWeight: 'bold',
  },
  loadoutCard: {
    borderLeftWidth: 4,
    borderLeftColor: theme.colors.secondary,
  },
  loadoutHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  loadoutTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: theme.colors.textMain,
  },
  loadoutCount: {
    fontSize: 13,
    fontWeight: 'bold',
    color: theme.colors.secondary,
  },
  loadoutSlotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  loadoutSlot: {
    flex: 1,
    height: 58,
    borderRadius: 10,
    borderWidth: 1.5,
    marginHorizontal: 3,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 2,
  },
  loadoutSlotText: {
    fontSize: 11,
    fontWeight: 'bold',
    marginTop: 2,
  },
  editLoadoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    borderWidth: 1,
    borderColor: theme.colors.primary,
    borderRadius: 10,
    paddingVertical: 10,
  },
  editLoadoutBtnText: {
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: 'bold',
  },
});
