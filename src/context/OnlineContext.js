import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { subscribeToConnectionState, ConnectionState } from '../services/online/connectionService';
import { syncOnlineProfile } from '../services/online/onlineProfileService';
import { useAuth, AuthState } from './AuthContext';

const OnlineContext = createContext(null);

export function OnlineProvider({ children }) {
  const { status, user } = useAuth();
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
