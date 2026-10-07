import { listenConnectionState } from '../firebase/firebaseDatabase';

export const ConnectionState = {
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE'
};

let connectionListeners = [];
let isConnected = false;
let isListening = false;
let unsubscribeFirebase = null;

function notifyListeners() {
  for (const listener of connectionListeners) {
    try {
      listener(isConnected ? ConnectionState.ONLINE : ConnectionState.OFFLINE);
    } catch (e) {
      console.error('Error in connection listener', e);
    }
  }
}

export function subscribeToConnectionState(callback) {
  connectionListeners.push(callback);
  callback(isConnected ? ConnectionState.ONLINE : ConnectionState.OFFLINE);
  
  if (!isListening) {
    isListening = true;
    try {
      unsubscribeFirebase = listenConnectionState((status) => {
        isConnected = status;
        notifyListeners();
      });
    } catch (e) {
      console.error('Failed to listen to Firebase connection state', e);
      // Fails gracefully; remains OFFLINE
    }
  }

  return () => {
    connectionListeners = connectionListeners.filter(l => l !== callback);
    if (connectionListeners.length === 0) {
      isListening = false;
      if (unsubscribeFirebase) {
        unsubscribeFirebase();
        unsubscribeFirebase = null;
      }
    }
  };
}

export function getIsConnected() {
  return isConnected;
}
