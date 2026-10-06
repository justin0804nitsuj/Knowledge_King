import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { useAuth } from '../context/AuthContext';
import { theme } from '../theme';

export default function ArenaScreen({ navigation }) {
  const { isSignedIn, signInWithGoogle } = useAuth();
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsOffline(state.isConnected === false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
    } catch (e) {
      console.warn('Arena Sign In failed:', e);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Arena</Text>
      
      <View style={styles.card}>
        {isOffline ? (
          <Text style={styles.message}>Online Arena requires Internet.</Text>
        ) : isSignedIn ? (
          <Text style={styles.message}>Online Arena — coming in Phase 8</Text>
        ) : (
          <>
            <Text style={styles.message}>Sign in with Google to challenge players.</Text>
            <TouchableOpacity style={styles.googleBtn} onPress={handleSignIn}>
              <Text style={styles.googleBtnText}>Sign in with Google</Text>
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
  }
});
