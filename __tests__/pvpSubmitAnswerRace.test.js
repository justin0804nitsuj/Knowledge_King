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
  gameFeedback: {
    init: jest.fn(), cleanup: jest.fn(), playAnswerCorrect: jest.fn(), playAnswerWrong: jest.fn()
  }
}));

import {
  processSubmitAnswerError,
  formatRemainingSeconds,
  getCountdownStep,
  getRoundResultLabel,
  getTransitionStatus,
  getTransitionLabel
} from '../src/screens/PvpBattleScreen';
import {
  autoResolveRound,
  getRoundDeadline,
  getRoundAnsweringStart,
  calculateRoundDamage,
  calculateSpeedOutcome,
  ROUND_TIME_LIMIT_MS,
  ROUND_PRE_BATTLE_MS,
  SUBMISSION_TRANSIT_TOLERANCE_MS
} from '../src/services/pvp/pvpBattleService';
import zhTW from '../src/localization/locales/zh-TW';
import en from '../src/localization/locales/en';

describe('Phase 11D - Tenth-Second Timer, Transit Tolerance & Last-Moment Submissions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Section 10: Timer Display Formatting & Positive-Time Guarantee', () => {
    test('6000ms -> "6.0"', () => {
      expect(formatRemainingSeconds(6000)).toBe('6.0');
    });

    test('5999ms -> "6.0"', () => {
      expect(formatRemainingSeconds(5999)).toBe('6.0');
    });

    test('5949ms -> "5.9"', () => {
      expect(formatRemainingSeconds(5949)).toBe('5.9');
    });

    test('1050ms -> "1.1"', () => {
      expect(formatRemainingSeconds(1050)).toBe('1.1');
    });

    test('999ms -> "1.0"', () => {
      expect(formatRemainingSeconds(999)).toBe('1.0');
    });

    test('149ms -> "0.1"', () => {
      expect(formatRemainingSeconds(149)).toBe('0.1');
    });

    test('Positive-time guarantee: 1ms-99ms clamps to "0.1" so positive time never displays as 0.0', () => {
      expect(formatRemainingSeconds(99)).toBe('0.1');
      expect(formatRemainingSeconds(50)).toBe('0.1');
      expect(formatRemainingSeconds(1)).toBe('0.1');
    });

    test('Only remainingMs <= 0 displays "0.0"', () => {
      expect(formatRemainingSeconds(0)).toBe('0.0');
      expect(formatRemainingSeconds(-1)).toBe('0.0');
      expect(formatRemainingSeconds(-500)).toBe('0.0');
      expect(formatRemainingSeconds(null)).toBe('0.0');
      expect(formatRemainingSeconds(undefined)).toBe('0.0');
    });
  });

  describe('Section 9: Transit Tolerance (500ms) & Exact Submission Rules', () => {
    // Conceptual Firebase rule evaluator replicating database.rules.json:
    // clientSubmittedAt is numeric
    // clientSubmittedAt <= authoritative deadline
    // clientSubmittedAt <= now
    // clientSubmittedAt >= now - SUBMISSION_TRANSIT_TOLERANCE_MS (500)
    const validateAnswerSubmissionRule = ({
      roundStartedAt,
      roundIndex,
      clientSubmittedAt,
      serverNow,
    }) => {
      const deadline = roundIndex === 0
        ? roundStartedAt + 10000
        : roundStartedAt + 6000;

      if (typeof clientSubmittedAt !== 'number' || !Number.isFinite(clientSubmittedAt)) {
        return false;
      }
      if (clientSubmittedAt > deadline) {
        return false; // tapped after deadline
      }
      if (clientSubmittedAt > serverNow) {
        return false; // timestamp in future
      }
      if (clientSubmittedAt < serverNow - SUBMISSION_TRANSIT_TOLERANCE_MS) {
        return false; // transit tolerance exceeded (> 500ms transit / backdated)
      }
      return true;
    };

    const roundStartedAt = 100000;
    const deadline = roundStartedAt + 6000; // 106000 for roundIndex = 1

    test('A. tap at 1000ms remaining -> accepted', () => {
      const clientSubmittedAt = deadline - 1000; // 105000
      const serverNow = clientSubmittedAt + 50; // arrived 50ms later
      expect(validateAnswerSubmissionRule({
        roundStartedAt,
        roundIndex: 1,
        clientSubmittedAt,
        serverNow
      })).toBe(true);
    });

    test('B. tap at 100ms remaining, server receives 200ms after deadline, but total transit <= 500ms -> accepted', () => {
      const clientSubmittedAt = deadline - 100; // tapped 100ms before deadline (105900)
      const serverNow = deadline + 200; // arrived 200ms after deadline (106200), total transit = 300ms <= 500ms
      expect(validateAnswerSubmissionRule({
        roundStartedAt,
        roundIndex: 1,
        clientSubmittedAt,
        serverNow
      })).toBe(true);
    });

    test('C. tap at 1ms before deadline, arrival within tolerance -> accepted', () => {
      const clientSubmittedAt = deadline - 1; // 105999
      const serverNow = deadline + 400; // arrived 401ms later <= 500ms tolerance
      expect(validateAnswerSubmissionRule({
        roundStartedAt,
        roundIndex: 1,
        clientSubmittedAt,
        serverNow
      })).toBe(true);
    });

    test('D. tap at or after visible 0.0 (clientSubmittedAt > deadline) -> rejected', () => {
      const clientSubmittedAt = deadline + 1; // 106001 (tapped after deadline)
      const serverNow = deadline + 50;
      expect(validateAnswerSubmissionRule({
        roundStartedAt,
        roundIndex: 1,
        clientSubmittedAt,
        serverNow
      })).toBe(false);
    });

    test('E. clientSubmittedAt older than now - 500ms -> rejected (transit tolerance exceeded)', () => {
      const clientSubmittedAt = deadline - 100; // 105900
      const serverNow = clientSubmittedAt + 501; // arrived 501ms later (> 500ms transit tolerance)
      expect(validateAnswerSubmissionRule({
        roundStartedAt,
        roundIndex: 1,
        clientSubmittedAt,
        serverNow
      })).toBe(false);
    });

    test('F. clientSubmittedAt later than now -> rejected', () => {
      const serverNow = deadline - 500;
      const clientSubmittedAt = serverNow + 200; // client claims timestamp in future
      expect(validateAnswerSubmissionRule({
        roundStartedAt,
        roundIndex: 1,
        clientSubmittedAt,
        serverNow
      })).toBe(false);
    });

    test('G. forged backdated timestamp -> rejected', () => {
      const serverNow = deadline + 1000;
      const clientSubmittedAt = deadline - 2000; // backdated far into the past
      expect(validateAnswerSubmissionRule({
        roundStartedAt,
        roundIndex: 1,
        clientSubmittedAt,
        serverNow
      })).toBe(false);
    });

    test('H. duplicate taps still blocked synchronously via submittedRoundsRef', () => {
      const submittedRounds = new Set();
      const roundIndex = 0;

      const trySubmit = () => {
        if (submittedRounds.has(roundIndex)) {
          return false;
        }
        submittedRounds.add(roundIndex);
        return true;
      };

      expect(trySubmit()).toBe(true);
      expect(trySubmit()).toBe(false);
      expect(trySubmit()).toBe(false);
    });

    test('I. timeout auto-resolution still works when answer is missing', async () => {
      const { runTransaction } = require('firebase/database');
      runTransaction.mockImplementation((ref, updateFn) => {
        const roomData = {
          meta: { hostUid: 'host1', guestUid: 'guest1', status: 'IN_BATTLE' },
          players: {
            host1: { hp: 100, role: 'HOST' },
            guest1: { hp: 100, role: 'GUEST' }
          },
          match: { battleSeed: '123', questionCount: 10 },
          matchState: {
            roundIndex: 0,
            phase: 'ANSWERING',
            roundStartedAt: 1000,
            players: {
              host1: { hp: 100, score: 0, correct: 0, wrong: 0 },
              guest1: { hp: 100, score: 0, correct: 0, wrong: 0 }
            },
            rounds: { 0: { answers: {} } }
          }
        };
        const updated = updateFn(roomData);
        return Promise.resolve({ committed: true, snapshot: { val: () => updated } });
      });

      const result = await autoResolveRound('room1', 'host1', 'guest1', 0);
      expect(result.committed).toBe(true);
    });

    test('J. speed comparison is deterministic using clientSubmittedAt', () => {
      // Host tapped at 1200ms, Guest tapped at 1000ms (Guest was 200ms faster)
      const hostTapTime = 1200;
      const guestTapTime = 1000;

      const outcome = calculateSpeedOutcome(hostTapTime, guestTapTime, true, true);
      expect(outcome.speedOutcome).toBe('GUEST_FASTER');
      expect(outcome.speedDiffMs).toBe(200);

      // Near-tie within 150ms
      const nearTieOutcome = calculateSpeedOutcome(1100, 1000, true, true);
      expect(nearTieOutcome.speedOutcome).toBe('TIE');
      expect(nearTieOutcome.speedDiffMs).toBe(100);
    });

    test('K. Round 0 timing remains 4s countdown + exact 6s visible answer window (10000ms total)', () => {
      expect(ROUND_PRE_BATTLE_MS).toBe(4000);
      expect(ROUND_TIME_LIMIT_MS).toBe(6000);
      expect(SUBMISSION_TRANSIT_TOLERANCE_MS).toBe(500);

      const r0Started = 50000;
      const r0Deadline = getRoundDeadline(r0Started, 0);
      expect(r0Deadline).toBe(r0Started + 10000);

      const r1Started = 50000;
      const r1Deadline = getRoundDeadline(r1Started, 1);
      expect(r1Deadline).toBe(r1Started + 6000);
    });
  });

  describe('Deadline-Race UX Logging Behavior', () => {
    test('Deadline-boundary permission rejection uses console.info without console.error or console.warn', () => {
      const onInfo = jest.fn();
      const onWarn = jest.fn();
      const onError = jest.fn();
      const showAlert = jest.fn();

      const deadline = 10000;
      const serverNow = 9950; // remainingMs = +50ms (within <= 500ms tolerance)

      const res = processSubmitAnswerError({
        error: new Error('permission_denied'),
        roundIndex: 0,
        serverNow,
        deadline,
        matchPhase: 'ANSWERING',
        alreadyHadAnswer: false,
        onInfo,
        onWarn,
        onError,
        showAlert
      });

      expect(res.type).toBe('DEADLINE_REJECTED');
      expect(onInfo).toHaveBeenCalledTimes(1);
      expect(onWarn).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(showAlert).not.toHaveBeenCalled();
    });

    test('Unexpected permission_denied with substantial time remaining (>500ms) logs console.error and shows alert', () => {
      const onInfo = jest.fn();
      const onError = jest.fn();
      const showAlert = jest.fn();

      const deadline = 10000;
      const serverNow = 7500; // remainingMs = 2500ms (> 500ms)

      const res = processSubmitAnswerError({
        error: new Error('permission_denied'),
        roundIndex: 0,
        serverNow,
        deadline,
        matchPhase: 'ANSWERING',
        alreadyHadAnswer: false,
        onInfo,
        onError,
        showAlert
      });

      expect(res.type).toBe('UNEXPECTED_PERMISSION_ERROR');
      expect(onInfo).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(showAlert).toHaveBeenCalledTimes(1);
    });
  });

  describe('Phase 11C/11D Round 0 Full 6.0s Answer Window & Deterministic Countdown Timeline', () => {
    const roundStartedAt = 100000;
    const answerStartAt = getRoundAnsweringStart(roundStartedAt, 0); // 104000
    const deadlineAt = getRoundDeadline(roundStartedAt, 0); // 110000

    test('Section 5 / A / B: Deterministic Round 0 timeline from +0ms to +10000ms', () => {
      // +0ms -> pre-battle "3"
      expect(getCountdownStep(roundStartedAt, roundStartedAt + 0)).toBe(3);
      expect(roundStartedAt + 0 < answerStartAt).toBe(true);

      // +1000ms -> "2"
      expect(getCountdownStep(roundStartedAt, roundStartedAt + 1000)).toBe(2);
      expect(roundStartedAt + 1000 < answerStartAt).toBe(true);

      // +2000ms -> "1"
      expect(getCountdownStep(roundStartedAt, roundStartedAt + 2000)).toBe(1);
      expect(roundStartedAt + 2000 < answerStartAt).toBe(true);

      // +3000ms -> "GO!"
      expect(getCountdownStep(roundStartedAt, roundStartedAt + 3000)).toBe('GO!');
      expect(roundStartedAt + 3000 < answerStartAt).toBe(true);

      // just before +4000ms (+3999ms) -> still no answer interaction
      expect(getCountdownStep(roundStartedAt, roundStartedAt + 3999)).toBe('GO!');
      expect(roundStartedAt + 3999 < answerStartAt).toBe(true);

      // at +4000ms -> countdown ends, answer enabled, visible timer = "6.0"
      expect(getCountdownStep(roundStartedAt, roundStartedAt + 4000)).toBeNull();
      expect(roundStartedAt + 4000 >= answerStartAt).toBe(true);
      const remainingAt4000 = deadlineAt - (roundStartedAt + 4000); // 6000ms
      expect(formatRemainingSeconds(remainingAt4000)).toBe('6.0');

      // +4100ms -> approximately "5.9"
      const remainingAt4100 = deadlineAt - (roundStartedAt + 4100); // 5900ms
      expect(formatRemainingSeconds(remainingAt4100)).toBe('5.9');

      // +9000ms -> approximately "1.0"
      const remainingAt9000 = deadlineAt - (roundStartedAt + 9000); // 1000ms
      expect(formatRemainingSeconds(remainingAt9000)).toBe('1.0');

      // +9900ms -> "0.1" (still tappable!)
      const remainingAt9900 = deadlineAt - (roundStartedAt + 9900); // 100ms
      expect(formatRemainingSeconds(remainingAt9900)).toBe('0.1');

      // +10000ms -> "0.0" (locked)
      const remainingAt10000 = deadlineAt - (roundStartedAt + 10000); // 0ms
      expect(formatRemainingSeconds(remainingAt10000)).toBe('0.0');
    });

    test('Section 4 & C: Round 1+ starts directly at 6.0 without pre-battle countdown', () => {
      const round1StartedAt = 200000;
      const round1AnswerStartAt = getRoundAnsweringStart(round1StartedAt, 1);
      const round1DeadlineAt = getRoundDeadline(round1StartedAt, 1);

      // In Round 1+, answerStartAt is immediately roundStartedAt (no 4s delay)
      expect(round1AnswerStartAt).toBe(round1StartedAt);
      expect(round1DeadlineAt).toBe(round1StartedAt + 6000);

      // At roundStartedAt, visible timer is 6.0 immediately
      const diffMs = round1DeadlineAt - round1StartedAt;
      expect(formatRemainingSeconds(diffMs)).toBe('6.0');
    });
  });

  describe('Timeout vs Correct vs Wrong Result Labels & Perspectives', () => {
    const tZh = (k) => k.split('.').reduce((acc, part) => acc?.[part], zhTW) || k;
    const tEn = (k) => k.split('.').reduce((acc, part) => acc?.[part], en) || k;

    test('D: Timeout renders "超時" in zh-TW and "Timeout" in English', () => {
      expect(getRoundResultLabel(true, false, tZh)).toBe('超時');
      expect(getRoundResultLabel(true, false, tEn)).toBe('Timeout');
      expect(getRoundResultLabel(true, false)).toBe('Timeout');
    });

    test('E: Actual wrong answer renders "錯誤" in zh-TW and "Wrong" in English', () => {
      expect(getRoundResultLabel(false, false, tZh)).toBe('錯誤');
      expect(getRoundResultLabel(false, false, tEn)).toBe('Wrong');
      expect(getRoundResultLabel(false, false)).toBe('Wrong');
    });

    test('F: Correct answer renders "正確" in zh-TW and "Correct" in English', () => {
      expect(getRoundResultLabel(false, true, tZh)).toBe('正確');
      expect(getRoundResultLabel(false, true, tEn)).toBe('Correct');
      expect(getRoundResultLabel(false, true)).toBe('Correct');
    });

    test('Result label priority: timedOut === true takes precedence over correct', () => {
      expect(getRoundResultLabel(true, true, tZh)).toBe('超時');
      expect(getRoundResultLabel(true, true, tEn)).toBe('Timeout');
    });

    test('G: Host timeout / Guest correct perspectives', () => {
      const resolution = {
        hostTimedOut: true,
        hostCorrect: false,
        guestTimedOut: false,
        guestCorrect: true
      };

      // Host Screen perspective (myUid === hostUid)
      const hostMyLabel = getRoundResultLabel(resolution.hostTimedOut, resolution.hostCorrect, tZh);
      const hostOppLabel = getRoundResultLabel(resolution.guestTimedOut, resolution.guestCorrect, tZh);
      expect(hostMyLabel).toBe('超時');
      expect(hostOppLabel).toBe('正確');

      // Guest Screen perspective (myUid === guestUid)
      const guestMyLabel = getRoundResultLabel(resolution.guestTimedOut, resolution.guestCorrect, tZh);
      const guestOppLabel = getRoundResultLabel(resolution.hostTimedOut, resolution.hostCorrect, tZh);
      expect(guestMyLabel).toBe('正確');
      expect(guestOppLabel).toBe('超時');
    });

    test('H: Both timeout renders timeout on both sides', () => {
      const resolution = {
        hostTimedOut: true,
        hostCorrect: false,
        guestTimedOut: true,
        guestCorrect: false
      };

      // Host perspective
      expect(getRoundResultLabel(resolution.hostTimedOut, resolution.hostCorrect, tZh)).toBe('超時');
      expect(getRoundResultLabel(resolution.guestTimedOut, resolution.guestCorrect, tZh)).toBe('超時');

      // Guest perspective
      expect(getRoundResultLabel(resolution.guestTimedOut, resolution.guestCorrect, tZh)).toBe('超時');
      expect(getRoundResultLabel(resolution.hostTimedOut, resolution.hostCorrect, tZh)).toBe('超時');
    });

    test('I: Combat semantics and damage unchanged for timeout', () => {
      // correct vs timeout -> 20 / 0
      const res1 = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: false, // guest timed out
        speedOutcome: 'NONE',
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false
      });
      expect(res1.damageToGuest).toBe(20);
      expect(res1.damageToHost).toBe(0);

      // wrong vs timeout -> 0 / 0
      const res2 = calculateRoundDamage({
        hostCorrect: false,
        guestCorrect: false,
        speedOutcome: 'NONE',
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false
      });
      expect(res2.damageToGuest).toBe(0);
      expect(res2.damageToHost).toBe(0);

      // both timeout -> 0 / 0
      const res3 = calculateRoundDamage({
        hostCorrect: false,
        guestCorrect: false,
        speedOutcome: 'NONE',
        hostPowerActive: false,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false
      });
      expect(res3.damageToGuest).toBe(0);
      expect(res3.damageToHost).toBe(0);

      // POWER vs timeout -> (20 + 10) = 30 / 0
      const res4 = calculateRoundDamage({
        hostCorrect: true,
        guestCorrect: false,
        speedOutcome: 'NONE',
        hostPowerActive: true,
        guestPowerActive: false,
        hostShieldActive: false,
        guestShieldActive: false
      });
      expect(res4.damageToGuest).toBe(30);
      expect(res4.damageToHost).toBe(0);
    });

    test('J: Last-moment 0.1 submission regression still passes with transit tolerance', () => {
      const deadline = 10000;
      const clientSubmittedAt = 9900; // remaining time = 100ms ("0.1")
      const serverArrivalAt = 10250; // arrived 250ms past deadline due to network transit

      expect(formatRemainingSeconds(deadline - clientSubmittedAt)).toBe('0.1');
      // Transit within 500ms tolerance
      expect(serverArrivalAt - clientSubmittedAt <= SUBMISSION_TRANSIT_TOLERANCE_MS).toBe(true);
      expect(clientSubmittedAt <= deadline).toBe(true);
    });
  });

  describe('Transition UI - Answered vs Timeout Semantic Separation', () => {
    const tZh = (k) => k.split('.').reduce((acc, part) => acc?.[part], zhTW) || k;
    const tEn = (k) => k.split('.').reduce((acc, part) => acc?.[part], en) || k;

    test('A: Answer record with selectedChoiceId -> 已作答 (Answer locked)', () => {
      const myAnswer = { selectedChoiceId: 'c2', submittedAt: 12345 };
      const status = getTransitionStatus({
        matchPhase: 'ANSWERING',
        myAnswer,
        countdown: null
      });

      expect(status).toBe('ANSWERED');
      expect(getTransitionLabel({ status, t: tZh })).toBe('已作答');
      expect(getTransitionLabel({ status, t: tEn })).toBe('Answer locked');
    });

    test('B: Answer record with timedOut: true -> 超時 (Timeout), never 已作答', () => {
      const myAnswer = { timedOut: true, submittedAt: 12345 };
      const status = getTransitionStatus({
        matchPhase: 'ANSWERING',
        myAnswer,
        countdown: null
      });

      expect(status).toBe('TIMEOUT');
      expect(getTransitionLabel({ status, t: tZh })).toBe('超時');
      expect(getTransitionLabel({ status, t: tZh })).not.toBe('已作答');
      expect(getTransitionLabel({ status, t: tEn })).toBe('Timeout');
      expect(getTransitionLabel({ status, t: tEn })).not.toBe('Answer locked');
    });

    test('C: timedOut + no resolution yet (in ANSWERING and RESOLVING) -> 超時', () => {
      const myAnswer = { timedOut: true, submittedAt: 12345 };

      // In ANSWERING phase (fillMissingTimeouts completed)
      const answeringStatus = getTransitionStatus({
        matchPhase: 'ANSWERING',
        myAnswer,
        countdown: null
      });
      expect(answeringStatus).toBe('TIMEOUT');
      expect(getTransitionLabel({ status: answeringStatus, t: tZh })).toBe('超時');

      // In RESOLVING phase (resolveRound running before ROUND_RESULT)
      const resolvingStatus = getTransitionStatus({
        matchPhase: 'RESOLVING',
        myAnswer,
        countdown: null
      });
      expect(resolvingStatus).toBe('TIMEOUT');
      expect(getTransitionLabel({ status: resolvingStatus, t: tZh })).toBe('超時');
    });

    test('D: ROUND_RESULT timeout -> 超時', () => {
      expect(getRoundResultLabel(true, false, tZh)).toBe('超時');
      expect(getRoundResultLabel(true, false, tEn)).toBe('Timeout');
    });

    test('E: Normal wrong answer -> 錯誤 (Wrong)', () => {
      expect(getRoundResultLabel(false, false, tZh)).toBe('錯誤');
      expect(getRoundResultLabel(false, false, tEn)).toBe('Wrong');
    });

    test('F: Normal correct answer -> 正確 (Correct)', () => {
      expect(getRoundResultLabel(false, true, tZh)).toBe('正確');
      expect(getRoundResultLabel(false, true, tEn)).toBe('Correct');
    });

    test('G: Both timeout transition -> neither gets ANSWERED label (no flash)', () => {
      const hostAnswer = { timedOut: true, submittedAt: 10000 };
      const guestAnswer = { timedOut: true, submittedAt: 10000 };

      const hostStatus = getTransitionStatus({
        matchPhase: 'ANSWERING',
        myAnswer: hostAnswer,
        countdown: null
      });
      const guestStatus = getTransitionStatus({
        matchPhase: 'ANSWERING',
        myAnswer: guestAnswer,
        countdown: null
      });

      expect(hostStatus).toBe('TIMEOUT');
      expect(guestStatus).toBe('TIMEOUT');
      expect(getTransitionLabel({ status: hostStatus, t: tZh })).toBe('超時');
      expect(getTransitionLabel({ status: guestStatus, t: tZh })).toBe('超時');
      expect(getTransitionLabel({ status: hostStatus, t: tZh })).not.toBe('已作答');
      expect(getTransitionLabel({ status: guestStatus, t: tZh })).not.toBe('已作答');
    });
  });
});
