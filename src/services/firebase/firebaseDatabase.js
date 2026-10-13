import { getDatabase, ref, onValue, off, serverTimestamp } from 'firebase/database';
import { app } from './firebaseApp';

// Export singleton database instance
export const db = getDatabase(app);

// Helper for native Firebase connection state
export function listenConnectionState(callback) {
  const connectedRef = ref(db, '.info/connected');
  const unsubscribe = onValue(connectedRef, (snap) => {
    callback(snap.val() === true);
  });
  return () => off(connectedRef, 'value', unsubscribe);
}

export function getServerTimestamp() {
  return serverTimestamp();
}
