import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged } from '../services/firebase/firebaseAuth';
import { signInWithGoogle, signOut } from '../services/auth/googleSignIn';
import { coordinateAccountProgress } from '../services/sync/accountProgressCoordinator';
import { flushLiveProgress, getSyncStatus, subscribeSyncStatus, setCloudSyncReady } from '../services/sync/liveProgressSync';
import { initServerTimeOffset } from '../services/firebase/serverTimeService';

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
  const [cloudSyncReady, setCloudSyncReadyState] = useState(false);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  const [lastSyncError, setLastSyncError] = useState(null);
  const [lastSyncResult, setLastSyncResult] = useState(null);

  useEffect(() => {
    initServerTimeOffset();
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
          // Reset cloud sync readiness for new identity/session
          setCloudSyncReadyState(false);

          let coordResult = null;
          try {
            coordResult = await coordinateAccountProgress(firebaseUser);
          } catch (err) {
            console.warn('[AuthContext] Account coordination warning:', err);
            const errStr = err?.code || err?.message || 'COORDINATION_FAILED';
            setLastSyncError(String(errStr).slice(0, 50));
          } finally {
            setProgressReady(true);
          }

          if (coordResult && coordResult.cloudSyncSuccess) {
            setCloudSyncReadyState(true);
            setLastSyncError(null);
            // Trigger live progress sync flush once cloud progress is confirmed ready
            flushLiveProgress(resolvedIdentity).then((res) => {
              if (res?.error) {
                const errStr = res.error.code || res.error.message || 'FLUSH_FAILED';
                setLastSyncError(String(errStr).slice(0, 50));
              }
            }).catch((err) => {
              const errStr = err?.code || err?.message || 'FLUSH_FAILED';
              setLastSyncError(String(errStr).slice(0, 50));
            });
          } else if (coordResult && coordResult.error) {
            const errStr = coordResult.error.code || coordResult.error.message || 'COORDINATION_FAILED';
            setLastSyncError(String(errStr).slice(0, 50));
          }
        } else {
          setUser(null);
          setIdentity('guest');
          setStatus(AuthState.SIGNED_OUT);
          setAuthReady(true);
          setCloudSyncReadyState(false);
          setLastSyncError(null);
          setLastSyncResult(null);
          if (typeof setCloudSyncReady === 'function') {
            setCloudSyncReady('guest', false);
          }

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
        setCloudSyncReadyState(false);
        setProgressReady(true);
        const errStr = error?.code || error?.message || 'AUTH_ERROR';
        setLastSyncError(String(errStr).slice(0, 50));
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
      const errStr = error?.code || error?.message || 'SIGN_IN_FAILED';
      setLastSyncError(String(errStr).slice(0, 50));
      throw error;
    }
  };

  const handleSignOut = async () => {
    try {
      setCloudSyncReadyState(false);
      setLastSyncError(null);
      setLastSyncResult(null);
      if (identity && typeof setCloudSyncReady === 'function') {
        setCloudSyncReady(identity, false);
      }
      await signOut();
      // The onAuthStateChanged listener will handle success and set status to SIGNED_OUT
    } catch (error) {
      console.error('Sign out failed:', error);
      throw error;
    }
  };

  const retrySync = async () => {
    try {
      const currentAuthUser = auth?.currentUser;
      if (!currentAuthUser) {
        const res = await flushLiveProgress('guest');
        const st = res?.status || 'skipped_guest';
        setLastSyncResult(st);
        return res || { status: 'skipped_guest' };
      }

      const targetId = `uid:${currentAuthUser.uid}`;

      if (!cloudSyncReady) {
        const coordRes = await coordinateAccountProgress(currentAuthUser);
        if (coordRes?.cloudSyncSuccess) {
          setCloudSyncReadyState(true);
          setLastSyncError(null);
        } else {
          const rawErr = coordRes?.error?.code || coordRes?.error?.message || 'CLOUD_SYNC_NOT_READY';
          setLastSyncError(String(rawErr).slice(0, 50));
          const st = coordRes?.status || 'skipped_not_ready';
          setLastSyncResult(st);
          return coordRes || { status: 'skipped_not_ready' };
        }
      }

      const flushRes = await flushLiveProgress(targetId);
      const st = flushRes?.status || 'synced';
      setLastSyncResult(st);
      if (flushRes?.error) {
        const rawErr = flushRes.error.code || flushRes.error.message || 'SYNC_ERROR';
        setLastSyncError(String(rawErr).slice(0, 50));
      } else {
        setLastSyncError(null);
      }
      return flushRes;
    } catch (err) {
      const rawErr = err?.code || err?.message || 'UNKNOWN_ERROR';
      setLastSyncError(String(rawErr).slice(0, 50));
      setLastSyncResult('error');
      return { status: 'error', error: err };
    }
  };

  const value = {
    status,
    user,
    authReady,
    identity,
    progressReady,
    cloudSyncReady,
    syncStatus,
    lastSyncError,
    lastSyncResult,
    retrySync,
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
