import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged } from '../services/firebase/firebaseAuth';
import { signInWithGoogle, signOut } from '../services/auth/googleSignIn';

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

  useEffect(() => {
    // Observer for Firebase Auth state
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        if (firebaseUser) {
          // Map to minimal app-facing shape
          setUser({
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName,
            email: firebaseUser.email,
            photoURL: firebaseUser.photoURL
          });
          setStatus(AuthState.SIGNED_IN);
        } else {
          setUser(null);
          setStatus(AuthState.SIGNED_OUT);
        }
      },
      (error) => {
        console.error('Firebase Auth state error:', error);
        setStatus(AuthState.ERROR);
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
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
