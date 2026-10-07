import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { usePvpRoom } from '../context/PvpRoomContext';
import { useOnline } from '../context/OnlineContext';
import { useTranslation } from 'react-i18next';
import { theme } from '../theme';

export default function ArenaScreen({ navigation }) {
  const { isSignedIn, signInWithGoogle } = useAuth();
  const { isOnline } = useOnline();
  const { createRoom } = usePvpRoom();
  const { t } = useTranslation();
  const [isCreating, setIsCreating] = useState(false);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      console.warn('Arena Sign In failed:', e);
    }
  };

  const handleCreateRoom = async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      await createRoom();
      navigation.navigate('WaitingRoom');
    } catch (e) {
      console.error(e);
      alert(e.message || t('arena.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = () => {
    navigation.navigate('JoinRoom');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('navigation.arena')}</Text>
      
      <View style={styles.card}>
        {!isOnline ? (
          <Text style={styles.message}>{t('arena.offlineMessage')}</Text>
        ) : !isSignedIn ? (
          <>
            <Text style={styles.message}>{t('arena.googleRequirement')}</Text>
            <TouchableOpacity style={styles.googleBtn} onPress={handleSignIn}>
              <Text style={styles.googleBtnText}>{t('profile.signInWithGoogle')}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity 
              style={[styles.primaryBtn, isCreating && styles.disabledBtn]} 
              onPress={handleCreateRoom}
              disabled={isCreating}
            >
              <Text style={styles.btnText}>{isCreating ? t('arena.creating') : t('arena.createRoom')}</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.secondaryBtn} onPress={handleJoinRoom} disabled={isCreating}>
              <Text style={styles.btnText}>{t('arena.joinRoom')}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.large,
    backgroundColor: theme.colors.background,
    justifyContent: 'center'
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: theme.spacing.large
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 12,
    padding: theme.spacing.large,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center'
  },
  message: {
    fontSize: 18,
    color: theme.colors.textMain,
    textAlign: 'center',
    marginBottom: theme.spacing.large
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
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: theme.colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.7,
  },
  btnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  }
});
