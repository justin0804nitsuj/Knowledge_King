jest.mock('firebase/database', () => ({
  ref: jest.fn(), onValue: jest.fn(), off: jest.fn(), get: jest.fn(), set: jest.fn(),
  update: jest.fn(), runTransaction: jest.fn(), serverTimestamp: jest.fn(), remove: jest.fn(), onDisconnect: jest.fn(),
  getDatabase: jest.fn()
}));
jest.mock('../src/services/firebase/firebaseApp', () => ({}));
jest.mock('../src/services/firebase/firebaseDatabase', () => ({
  db: {}
}));
jest.mock('firebase/auth', () => ({
  initializeAuth: jest.fn(),
  getReactNativePersistence: jest.fn(),
  onAuthStateChanged: jest.fn(),
  GoogleAuthProvider: jest.fn(),
  signInWithCredential: jest.fn(),
  signOut: jest.fn()
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(), getItem: jest.fn(), removeItem: jest.fn()
}));
jest.mock('react-native-nitro-google-signin', () => ({
  GoogleOneTapSignIn: { configure: jest.fn() },
  isSuccessResponse: jest.fn()
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k, d) => d || k })
}));
jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'Ionicons'
}));
jest.mock('../src/context/PvpRoomContext', () => ({
  usePvpRoom: () => ({})
}));
jest.mock('../src/services/feedback/gameFeedback', () => ({
  gameFeedback: { init: jest.fn(), cleanup: jest.fn() }
}));

import { executeHostDeadlineAutoResolve } from '../src/screens/PvpBattleScreen';

describe('Phase 11C - Host Deadline Auto-Resolve Retry & Error Classification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('A. first failure with permission_denied schedules one retry and does NOT call console.error', async () => {
    const onWarn = jest.fn();
    const onError = jest.fn();
    let retryScheduled = false;

    const autoResolveFn = jest.fn().mockRejectedValueOnce(new Error('permission_denied'));

    const matchState = {
      phase: 'ANSWERING',
      rounds: { 0: { answers: {} } }
    };

    await executeHostDeadlineAutoResolve({
      roomId: 'room1',
      hostUid: 'host1',
      guestUid: 'guest1',
      roundIndex: 0,
      isHost: true,
      getMatchState: () => matchState,
      autoResolveFn,
      onWarn,
      onError,
      scheduleRetry: (fn, delayMs) => {
        retryScheduled = true;
        expect(delayMs).toBe(400);
        return setTimeout(fn, delayMs);
      }
    });

    expect(autoResolveFn).toHaveBeenCalledTimes(1);
    expect(retryScheduled).toBe(true);
    expect(onWarn).toHaveBeenCalledTimes(1);
    expect(onWarn).toHaveBeenCalledWith(
      expect.stringContaining('boundary race'),
      expect.any(String)
    );
    expect(onError).not.toHaveBeenCalled();
  });

  test('B. retry succeeds silently without final error', async () => {
    const onWarn = jest.fn();
    const onError = jest.fn();

    const autoResolveFn = jest.fn()
      .mockRejectedValueOnce(new Error('permission_denied'))
      .mockResolvedValueOnce({ committed: true });

    const matchState = {
      phase: 'ANSWERING',
      rounds: { 0: { answers: {} } }
    };

    await executeHostDeadlineAutoResolve({
      roomId: 'room1',
      hostUid: 'host1',
      guestUid: 'guest1',
      roundIndex: 0,
      isHost: true,
      getMatchState: () => matchState,
      autoResolveFn,
      onWarn,
      onError
    });

    expect(autoResolveFn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    // Fast forward 400ms to trigger the retry
    await jest.advanceTimersByTimeAsync(400);

    expect(autoResolveFn).toHaveBeenCalledTimes(2);
    expect(onError).not.toHaveBeenCalled();
  });

  test('C. retry also fails -> calls console.error exactly once', async () => {
    const onWarn = jest.fn();
    const onError = jest.fn();

    const autoResolveFn = jest.fn()
      .mockRejectedValueOnce(new Error('permission_denied'))
      .mockRejectedValueOnce(new Error('permission_denied retry failed'));

    const matchState = {
      phase: 'ANSWERING',
      rounds: { 0: { answers: {} } }
    };

    await executeHostDeadlineAutoResolve({
      roomId: 'room1',
      hostUid: 'host1',
      guestUid: 'guest1',
      roundIndex: 0,
      isHost: true,
      getMatchState: () => matchState,
      autoResolveFn,
      onWarn,
      onError
    });

    expect(autoResolveFn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(400);

    expect(autoResolveFn).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('retry failed'),
      expect.any(Error)
    );
  });

  test('D. first failure is unexpected non-permission error -> calls console.error immediately', async () => {
    const onWarn = jest.fn();
    const onError = jest.fn();

    const autoResolveFn = jest.fn().mockRejectedValueOnce(new Error('Network disconnected'));

    const matchState = {
      phase: 'ANSWERING',
      rounds: { 0: { answers: {} } }
    };

    await executeHostDeadlineAutoResolve({
      roomId: 'room1',
      hostUid: 'host1',
      guestUid: 'guest1',
      roundIndex: 0,
      isHost: true,
      getMatchState: () => matchState,
      autoResolveFn,
      onWarn,
      onError
    });

    expect(autoResolveFn).toHaveBeenCalledTimes(1);
    expect(onWarn).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('unexpected failure'),
      expect.any(Error)
    );

    // Ensure no retry was scheduled
    await jest.advanceTimersByTimeAsync(1000);
    expect(autoResolveFn).toHaveBeenCalledTimes(1);
  });

  test('E. round resolves or phase transitions before retry fires -> retry is cancelled / safe no-op', async () => {
    const onWarn = jest.fn();
    const onError = jest.fn();

    const autoResolveFn = jest.fn().mockRejectedValueOnce(new Error('permission_denied'));

    const matchState = {
      phase: 'ANSWERING',
      rounds: { 0: { answers: {} } }
    };

    await executeHostDeadlineAutoResolve({
      roomId: 'room1',
      hostUid: 'host1',
      guestUid: 'guest1',
      roundIndex: 0,
      isHost: true,
      getMatchState: () => matchState,
      autoResolveFn,
      onWarn,
      onError
    });

    expect(autoResolveFn).toHaveBeenCalledTimes(1);

    // Simulate round resolving before the 400ms timer completes
    matchState.phase = 'ROUND_RESULT';
    matchState.rounds[0].resolution = { resolvedAt: 12345 };

    await jest.advanceTimersByTimeAsync(400);

    // autoResolveFn should not have been called a second time
    expect(autoResolveFn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  test('F. cancelled flag halts retry before invocation', async () => {
    const onWarn = jest.fn();
    const onError = jest.fn();

    const autoResolveFn = jest.fn().mockRejectedValueOnce(new Error('permission_denied'));

    let cancelled = false;
    const matchState = {
      phase: 'ANSWERING',
      rounds: { 0: { answers: {} } }
    };

    await executeHostDeadlineAutoResolve({
      roomId: 'room1',
      hostUid: 'host1',
      guestUid: 'guest1',
      roundIndex: 0,
      isHost: true,
      getMatchState: () => matchState,
      autoResolveFn,
      onWarn,
      onError,
      isCancelled: () => cancelled
    });

    expect(autoResolveFn).toHaveBeenCalledTimes(1);

    // Effect unmounts / cancels
    cancelled = true;

    await jest.advanceTimersByTimeAsync(400);

    expect(autoResolveFn).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });
});
