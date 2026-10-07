import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';

export default function JoinRoomScreen({ navigation }) {
  const { t } = useTranslation();
  const { joinRoom } = usePvpRoom();
  const [code, setCode] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleJoin = async () => {
    if (code.length !== 5) return;
    
    setIsJoining(true);
    setErrorMsg('');
    try {
      await joinRoom(code);
      navigation.replace('WaitingRoom');
    } catch (e) {
      console.error(e);
      let localizedError = t('arena.joinError');
      if (e.message === 'Room not found') localizedError = t('arena.roomNotFound');
      else if (e.message === 'Room is full') localizedError = t('arena.roomFull');
      else if (e.message.includes('incompatible')) localizedError = t('arena.incompatible');
      
      setErrorMsg(localizedError);
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('arena.joinRoom')}</Text>
      
      <View style={styles.card}>
        <Text style={styles.label}>{t('arena.enterCode')}</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          maxLength={5}
          value={code}
          onChangeText={(text) => setCode(text.replace(/[^0-9]/g, ''))}
          editable={!isJoining}
          autoFocus
        />
        
        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <TouchableOpacity 
          style={[styles.primaryBtn, (isJoining || code.length !== 5) && styles.disabledBtn]} 
          onPress={handleJoin}
          disabled={isJoining || code.length !== 5}
        >
          <Text style={styles.btnText}>{isJoining ? t('arena.joining') : t('arena.join')}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.secondaryBtn} 
          onPress={() => navigation.goBack()}
          disabled={isJoining}
        >
          <Text style={styles.secondaryBtnText}>{t('profile.cancel')}</Text>
        </TouchableOpacity>
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
  label: {
    fontSize: 16,
    color: theme.colors.textMain,
    marginBottom: 8
  },
  input: {
    backgroundColor: theme.colors.background,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    padding: 16,
    fontSize: 32,
    letterSpacing: 8,
    textAlign: 'center',
    width: '100%',
    color: theme.colors.textMain,
    marginBottom: 16,
  },
  errorText: {
    color: theme.colors.danger,
    marginBottom: 16,
    textAlign: 'center',
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
    paddingVertical: 14,
    width: '100%',
    alignItems: 'center',
  },
  disabledBtn: {
    opacity: 0.5,
  },
  btnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  secondaryBtnText: {
    color: theme.colors.textMain,
    fontSize: 16,
  }
});
