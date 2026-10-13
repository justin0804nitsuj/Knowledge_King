import { initializeAuth, getReactNativePersistence, onAuthStateChanged, GoogleAuthProvider, signInWithCredential, signOut as firebaseSignOut } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { app } from './firebaseApp';

// React Native requires a custom persistence implementation backed by AsyncStorage
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage)
});

export { 
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithCredential,
  firebaseSignOut 
};
