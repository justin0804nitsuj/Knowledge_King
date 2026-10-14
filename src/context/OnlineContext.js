import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { subscribeToConnectionState, ConnectionState } from '../services/online/connectionService';
import { syncOnlineProfile } from '../services/online/onlineProfileService';
import { flushLiveProgress, isCloudSyncReady } from '../services/sync/liveProgressSync';
import { coordinateAccountProgress } from '../services/sync/accountProgressCoordinator';
import { useAuth, AuthState } from './AuthContext';

const OnlineContext = createContext(null);

export function OnlineProvider({ children }) {
  const { status, user, authReady, progressReady } = useAuth();
  const [connectionState, setConnectionState] = useState(ConnectionState.OFFLINE);
  
  // Ref to track if we have already successfully synced the profile for the current user session
  const syncedForUid = useRef(null);

  useEffect(() => {
    const unsubscribe = subscribeToConnectionState((state) => {
      setConnectionState(state);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (status === AuthState.SIGNED_IN && user && connectionState === ConnectionState.ONLINE) {
      if (syncedForUid.current !== user.uid) {
        syncOnlineProfile(user).then((success) => {
          if (success) {
            syncedForUid.current = user.uid;
          }
        });
      }
    } else {
      // If signed out, reset the sync tracker
      if (status === AuthState.SIGNED_OUT) {
        syncedForUid.current = null;
      }
    }
  }, [status, user, connectionState]);

  // Phase 5B.1: Flush live gameplay sync when online connection is established
  useEffect(() => {
    let isCancelled = false;

    async function handleOnlineSync() {
      if (
        connectionState === ConnectionState.ONLINE &&
        status === AuthState.SIGNED_IN &&
        authReady &&
        progressReady &&
        user?.uid
      ) {
        const targetIdentity = `uid:${user.uid}`;

        // Conceptual ordering:
        // ONLINE -> authReady? -> progressReady? -> cloudSyncReady?
        if (!isCloudSyncReady(targetIdentity)) {
          try {
            const coordRes = await coordinateAccountProgress(user);
            if (isCancelled) return;
            if (!coordRes || !coordRes.cloudSyncSuccess) {
              // Bootstrap/restore failed again: keep local gameplay available,
              // leave staged progress untouched, DO NOT transmit live SyncOps
              return;
            }
          } catch (err) {
            console.warn('[OnlineContext] Coordinator retry failed on reconnect:', err);
            return;
          }
        }

        if (isCancelled) return;
        flushLiveProgress(targetIdentity).catch(() => {});
      }
    }

    handleOnlineSync();

    return () => {
      isCancelled = true;
    };
  }, [connectionState, status, authReady, progressReady, user]);

  const value = {
    connectionState,
    isOnline: connectionState === ConnectionState.ONLINE
  };

  return (
    <OnlineContext.Provider value={value}>
      {children}
    </OnlineContext.Provider>
  );
}

export function useOnline() {
  const context = useContext(OnlineContext);
  if (context === null) {
    throw new Error('useOnline must be used within an OnlineProvider');
  }
  return context;
}
