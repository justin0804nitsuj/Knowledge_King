import { db, getServerTimestamp } from '../firebase/firebaseDatabase';
import { ref, get, set } from 'firebase/database';

/**
 * Creates or updates the minimal online profile for a user.
 * This is idempotent.
 */
export async function syncOnlineProfile(user) {
  if (!user || !user.uid) return false;
  
  const userRef = ref(db, `users/${user.uid}`);
  
  try {
    const snapshot = await get(userRef);
    const existing = snapshot.val();
    
    if (existing) {
      // Update identity fields while preserving createdAt
      await set(userRef, {
        ...existing,
        displayName: user.displayName || existing.displayName || 'Player',
        photoURL: user.photoURL || existing.photoURL || null,
        updatedAt: getServerTimestamp()
      });
    } else {
      // Create new profile
      await set(userRef, {
        displayName: user.displayName || 'Player',
        photoURL: user.photoURL || null,
        createdAt: getServerTimestamp(),
        updatedAt: getServerTimestamp()
      });
    }
    return true;
  } catch (error) {
    console.error('Failed to sync online profile', error);
    return false; // Graceful failure
  }
}
