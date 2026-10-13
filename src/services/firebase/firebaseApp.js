import { initializeApp, getApps } from 'firebase/app';

// Config copied from legacy-web/index.html
// NOTE: For full native Google Sign-In, we will also need `google-services.json` (Android)
// and `GoogleService-Info.plist` (iOS) placed at the root of the project.
const firebaseConfig = {
  apiKey: "AIzaSyA4UGz3hd-WosEGuhCF3bmHs52JJOhZGts",
  authDomain: "gsat-battle-992b8.firebaseapp.com",
  databaseURL: "https://gsat-battle-992b8-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "gsat-battle-992b8",
  storageBucket: "gsat-battle-992b8.firebasestorage.app",
  messagingSenderId: "880103499727",
  appId: "1:880103499727:web:0f3540fc8e7ed7d26c14ba",
  measurementId: "G-550T1J7C40"
};

// Initialize Firebase App only once
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
