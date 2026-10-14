import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { AuthProvider, useAuth, AuthState } from '../src/context/AuthContext';

let authCallback = null;
const mockUnsubscribe = jest.fn();

jest.mock('../src/services/firebase/firebaseAuth', () => ({
  auth: {},
  onAuthStateChanged: jest.fn((authInstance, callback) => {
    authCallback = callback;
    return mockUnsubscribe;
  })
}));

jest.mock('../src/services/auth/googleSignIn', () => ({
  signInWithGoogle: jest.fn(),
  signOut: jest.fn()
}));

const mockCoordinateAccountProgress = jest.fn();
jest.mock('../src/services/sync/accountProgressCoordinator', () => ({
  coordinateAccountProgress: (...args) => mockCoordinateAccountProgress(...args)
}));

jest.mock('../src/services/sync/liveProgressSync', () => ({
  flushLiveProgress: jest.fn().mockResolvedValue({ status: 'synced' }),
  getSyncStatus: jest.fn(() => 'idle'),
  subscribeSyncStatus: jest.fn(() => () => {}),
  isCloudSyncReady: jest.fn(() => false),
  setCloudSyncReady: jest.fn()
}));

function TestConsumer({ onContext }) {
  const ctx = useAuth();
  onContext(ctx);
  return null;
}

describe('AuthContext Phase 5A Initialization & Identity State', () => {
  beforeEach(() => {
    authCallback = null;
    jest.clearAllMocks();
  });

  test('auth unresolved does not choose guest (authReady is false, identity is null)', () => {
    let capturedContext = null;

    act(() => {
      renderer.create(
        <AuthProvider>
          <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
        </AuthProvider>
      );
    });

    // Before onAuthStateChanged fires:
    expect(capturedContext.authReady).toBe(false);
    expect(capturedContext.identity).toBeNull();
    expect(capturedContext.status).toBe(AuthState.INITIALIZING);
    expect(capturedContext.isInitializing).toBe(true);
    expect(capturedContext.user).toBeNull();
  });

  test('signed-out resolved chooses guest', async () => {
    let capturedContext = null;

    act(() => {
      renderer.create(
        <AuthProvider>
          <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
        </AuthProvider>
      );
    });

    // Simulate Firebase onAuthStateChanged resolving with null (signed out)
    await act(async () => {
      authCallback(null);
    });

    expect(capturedContext.authReady).toBe(true);
    expect(capturedContext.identity).toBe('guest');
    expect(capturedContext.status).toBe(AuthState.SIGNED_OUT);
    expect(capturedContext.isSignedIn).toBe(false);
    expect(capturedContext.user).toBeNull();
    expect(mockCoordinateAccountProgress).toHaveBeenCalledWith(null);
  });

  test('Account A chooses uid:AccountA', async () => {
    let capturedContext = null;

    act(() => {
      renderer.create(
        <AuthProvider>
          <TestConsumer onContext={(ctx) => { capturedContext = ctx; }} />
        </AuthProvider>
      );
    });

    // Simulate Firebase onAuthStateChanged resolving with authenticated user
    await act(async () => {
      authCallback({
        uid: 'AccountA',
        displayName: 'Account A Player',
        photoURL: 'https://example.com/a.png'
      });
    });

    expect(capturedContext.authReady).toBe(true);
    expect(capturedContext.identity).toBe('uid:AccountA');
    expect(capturedContext.status).toBe(AuthState.SIGNED_IN);
    expect(capturedContext.isSignedIn).toBe(true);
    expect(capturedContext.user).toEqual({
      uid: 'AccountA',
      displayName: 'Account A Player',
      photoURL: 'https://example.com/a.png'
    });
    expect(mockCoordinateAccountProgress).toHaveBeenCalledWith(expect.objectContaining({ uid: 'AccountA' }));
  });
});
