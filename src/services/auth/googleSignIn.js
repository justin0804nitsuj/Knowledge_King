import { GoogleOneTapSignIn, isSuccessResponse } from 'react-native-nitro-google-signin';
import { auth, GoogleAuthProvider, signInWithCredential, firebaseSignOut } from '../firebase/firebaseAuth';

// Initialize the native module. 
// autoDetect expects google-services.json (Android) and GoogleService-Info.plist (iOS) 
// to be placed in the project root and configured in app.json/eas.json.
try {
  GoogleOneTapSignIn.configure({
    webClientId: 'autoDetect', 
  });
} catch (error) {
  console.warn('GoogleOneTapSignIn configure failed. Native files may be missing:', error);
}

/**
 * Initiates the Google Sign-In flow, retrieves an ID token,
 * and signs into Firebase Auth.
 * @returns {Promise<User>} The authenticated Firebase User object.
 */
export async function signInWithGoogle() {
  try {
    await GoogleOneTapSignIn.checkPlayServices();
    
    // Try to restore or open account picker
    let response = await GoogleOneTapSignIn.signIn();
    
    if (!isSuccessResponse(response)) {
      response = await GoogleOneTapSignIn.createAccount();
    }

    if (isSuccessResponse(response)) {
      const { idToken } = response.data;
      if (!idToken) throw new Error("No ID token received from Google.");

      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, credential);
      return userCredential.user;
    }
    
    throw new Error('Google Sign-In cancelled or failed');
  } catch (error) {
    console.error('signInWithGoogle error:', error);
    throw error;
  }
}

/**
 * Signs the user out of both Firebase and Google.
 */
export async function signOut() {
  try {
    await firebaseSignOut(auth);
    await GoogleOneTapSignIn.signOut();
  } catch (error) {
    console.error('signOut error:', error);
    throw error;
  }
}
