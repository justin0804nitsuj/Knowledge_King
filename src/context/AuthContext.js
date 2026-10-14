import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged } from '../services/firebase/firebaseAuth';
import { signInWithGoogle, signOut } from '../services/auth/googleSignIn';
import { coordinateAccountProgress } from '../services/sync/accountProgressCoordinator';
import { flushLiveProgress, getSyncStatus, subscribeSyncStatus } from '../services/sync/liveProgressSync';

export const AuthState = {
  INITIALIZING: 'INITIALIZING',
  SIGNED_OUT: 'SIGNED_OUT',
  SIGNED_IN: 'SIGNED_IN',
  ERROR: 'ERROR'
};

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(AuthState.INITIALIZING);
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [identity, setIdentity] = useState(null);
  const [progressReady, setProgressReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());

  useEffect(() => {
    const unsubSync = subscribeSyncStatus((s) => {
      setSyncStatus(s);
    });
    return () => unsubSync();
  }, []);

  useEffect(() => {
    // Observer for Firebase Auth state
    const unsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        if (firebaseUser) {
          const resolvedIdentity = `uid:${firebaseUser.uid}`;
          setUser({
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL
          });
          setIdentity(resolvedIdentity);
          setStatus(AuthState.SIGNED_IN);
          setAuthReady(true);

          try {
            await coordinateAccountProgress(firebaseUser);
          } catch (err) {
            console.warn('[AuthContext] Account coordination warning:', err);
          } finally {
            setProgressReady(true);
          }

          // Trigger live progress sync flush once account progress is ready
          flushLiveProgress(resolvedIdentity).catch(() => {});
        } else {
          setUser(null);
          setIdentity('guest');
          setStatus(AuthState.SIGNED_OUT);
          setAuthReady(true);

          try {
            await coordinateAccountProgress(null);
          } catch (err) {
            console.warn('[AuthContext] Guest coordination warning:', err);
          } finally {
            setProgressReady(true);
          }
        }
      },
      (error) => {
        console.error('Firebase Auth state error:', error);
        setStatus(AuthState.ERROR);
        setAuthReady(true);
        setProgressReady(true);
      }
    );

    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setStatus(AuthState.INITIALIZING);
    try {
      await signInWithGoogle();
      // The onAuthStateChanged listener will handle success and set status to SIGNED_IN
    } catch (error) {
      console.error('Sign in failed:', error);
      setStatus(AuthState.SIGNED_OUT);
      throw error;
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      // The onAuthStateChanged listener will handle success and set status to SIGNED_OUT
    } catch (error) {
      console.error('Sign out failed:', error);
      throw error;
    }
  };

  const value = {
    status,
    user,
    authReady,
    identity,
    progressReady,
    syncStatus,
    flushLiveProgress: () => flushLiveProgress(identity),
    isSignedIn: status === AuthState.SIGNED_IN,
    isInitializing: status === AuthState.INITIALIZING,
    signInWithGoogle: handleSignIn,
    signOut: handleSignOut
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
