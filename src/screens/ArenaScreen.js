import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { usePvpRoom } from '../context/PvpRoomContext';
import { useOnline } from '../context/OnlineContext';
import { useTranslation } from 'react-i18next';
import { theme } from '../theme';
import { Ionicons } from '@expo/vector-icons';

export default function ArenaScreen({ navigation }) {
  const { isSignedIn, signInWithGoogle } = useAuth();
  const { isOnline } = useOnline();
  const { createRoom, joinRoom } = usePvpRoom();
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  
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
});
