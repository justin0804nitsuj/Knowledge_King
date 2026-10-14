import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  GUEST_IDENTITY,
  ACTIVE_IDENTITY_KEY,
  DEVICE_ID_KEY,
  ACCOUNT_DATA_CATEGORIES,
  DEVICE_WIDE_DATA_CATEGORIES,
  generateUuidV4,
  isValidIdentity,
  normalizeIdentity,
  getScopedKey,
  getActiveIdentity,
  setActiveIdentity,
  getActiveScopedKey,
  getDeviceId,
  _resetCachedDeviceIdForTests,
  getLocalSyncSeq,
  setLocalSyncSeq,
  reconcileSyncSequence,
  computeSafeNextSequence,
  reconcileAndSaveLocalSyncSeq
} from '../src/storage/storageIdentity';

// In-memory mock storage for AsyncStorage
let mockStore = {};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key) => mockStore[key] || null),
  setItem: jest.fn(async (key, value) => {
    mockStore[key] = String(value);
  }),
  removeItem: jest.fn(async (key) => {
    delete mockStore[key];
  }),
  clear: jest.fn(async () => {
    mockStore = {};
  })
}));

describe('Storage Identity & Scoping Foundation (Phase 1)', () => {
  beforeEach(() => {
    mockStore = {};
    jest.clearAllMocks();
    _resetCachedDeviceIdForTests();
  });

  describe('1. Identity Normalization and Validation', () => {
    test('validates canonical guest and uid identities correctly', () => {
      expect(isValidIdentity('guest')).toBe(true);
      expect(isValidIdentity('uid:user_12345')).toBe(true);
      expect(isValidIdentity('uid:google_abc_def')).toBe(true);
    });

    test('rejects malformed or empty identities', () => {
      expect(isValidIdentity('')).toBe(false);
      expect(isValidIdentity(null)).toBe(false);
      expect(isValidIdentity(undefined)).toBe(false);
      expect(isValidIdentity(123)).toBe(false);
      expect(isValidIdentity('uid:')).toBe(false);
      expect(isValidIdentity('uid:   ')).toBe(false);
      expect(isValidIdentity('uid:a:b:c')).toBe(false);
      expect(isValidIdentity('random_string_without_prefix')).toBe(false);
    });

    test('normalizes various input formats into canonical identity strings', () => {
      // Guest
      expect(normalizeIdentity('guest')).toBe('guest');
      expect(normalizeIdentity('  guest  ')).toBe('guest');
      expect(normalizeIdentity(null)).toBe('guest');
      expect(normalizeIdentity(undefined)).toBe('guest');
      expect(normalizeIdentity('')).toBe('guest');

      // Canonical uid prefix
      expect(normalizeIdentity('uid:firebase_999')).toBe('uid:firebase_999');

      // Raw Firebase UID string without 'uid:' prefix
      expect(normalizeIdentity('firebase_999')).toBe('uid:firebase_999');

      // Object containing uid property
      expect(normalizeIdentity({ uid: 'user_456' })).toBe('uid:user_456');

      // Malformed inputs fall back safely to guest
      expect(normalizeIdentity('uid:bad:colon')).toBe('guest');
      expect(normalizeIdentity({ foo: 'bar' })).toBe('guest');
    });
  });

  describe('2. Active Identity Pointer', () => {
    test('default active identity is guest when storage is empty', async () => {
      const active = await getActiveIdentity();
      expect(active).toBe(GUEST_IDENTITY);
    });

    test('set guest identity safely persists to ACTIVE_IDENTITY_KEY', async () => {
      const saved = await setActiveIdentity('guest');
      expect(saved).toBe('guest');
      expect(mockStore[ACTIVE_IDENTITY_KEY]).toBe('guest');

      const read = await getActiveIdentity();
      expect(read).toBe('guest');
    });

    test('set uid:A identity persists and reads correctly', async () => {
      const saved = await setActiveIdentity('uid:player_alpha');
      expect(saved).toBe('uid:player_alpha');
      expect(mockStore[ACTIVE_IDENTITY_KEY]).toBe('uid:player_alpha');

      const read = await getActiveIdentity();
      expect(read).toBe('uid:player_alpha');
    });

    test('switch uid:A -> uid:B updates active identity pointer without data corruption', async () => {
      await setActiveIdentity('uid:player_alpha');
      expect(await getActiveIdentity()).toBe('uid:player_alpha');

      await setActiveIdentity('uid:player_beta');
      expect(await getActiveIdentity()).toBe('uid:player_beta');
      expect(mockStore[ACTIVE_IDENTITY_KEY]).toBe('uid:player_beta');
    });

    test('malformed identity falls back safely to guest on setActiveIdentity', async () => {
      const saved = await setActiveIdentity('invalid:with:too:many:colons');
      expect(saved).toBe(GUEST_IDENTITY);
      expect(mockStore[ACTIVE_IDENTITY_KEY]).toBe(GUEST_IDENTITY);
    });
  });

  describe('3. Scoped Key Generation & Storage Isolation', () => {
    test('generates expected scoped keys for all account-owned categories', () => {
      for (const category of ACCOUNT_DATA_CATEGORIES) {
        const guestKey = getScopedKey(category, 'guest');
        expect(guestKey).toBe(`@KnowledgeKing:guest:${category}`);

        const userKey = getScopedKey(category, 'uid:user123');
        expect(userKey).toBe(`@KnowledgeKing:uid:user123:${category}`);
      }
    });

    test('scoped key isolation: Account A and Account B produce strictly distinct keys', () => {
      const keyA = getScopedKey('playerProgress', 'uid:account_A');
      const keyB = getScopedKey('playerProgress', 'uid:account_B');
      expect(keyA).toBe('@KnowledgeKing:uid:account_A:playerProgress');
      expect(keyB).toBe('@KnowledgeKing:uid:account_B:playerProgress');
      expect(keyA).not.toBe(keyB);
    });

    test('scoped key isolation: Guest keys are isolated from signed-in user keys', () => {
      const guestKey = getScopedKey('campaignProgress', 'guest');
      const userKey = getScopedKey('campaignProgress', 'uid:account_A');
      expect(guestKey).toBe('@KnowledgeKing:guest:campaignProgress');
      expect(userKey).toBe('@KnowledgeKing:uid:account_A:campaignProgress');
      expect(guestKey).not.toBe(userKey);
    });

    test('getActiveScopedKey dynamically matches active identity', async () => {
      await setActiveIdentity('uid:user_active');
      const key = await getActiveScopedKey('mistakes');
      expect(key).toBe('@KnowledgeKing:uid:user_active:mistakes');

      await setActiveIdentity('guest');
      const guestKey = await getActiveScopedKey('mistakes');
      expect(guestKey).toBe('@KnowledgeKing:guest:mistakes');
    });

    test('throws if category is empty or missing', () => {
      expect(() => getScopedKey('')).toThrow();
      expect(() => getScopedKey('   ')).toThrow();
      expect(() => getScopedKey(null)).toThrow();
    });

    test('documents distinct account-owned vs device-wide categories', () => {
      expect(ACCOUNT_DATA_CATEGORIES).toContain('playerProgress');
      expect(ACCOUNT_DATA_CATEGORIES).toContain('campaignProgress');
      expect(ACCOUNT_DATA_CATEGORIES).toContain('mistakes');
      expect(ACCOUNT_DATA_CATEGORIES).toContain('battleHistory');
      expect(ACCOUNT_DATA_CATEGORIES).toContain('syncSeq');
      expect(ACCOUNT_DATA_CATEGORIES).toContain('pendingSyncOp');
      expect(ACCOUNT_DATA_CATEGORIES).toContain('lastSyncedSnapshot');

      expect(DEVICE_WIDE_DATA_CATEGORIES).toContain('deviceId');
      expect(DEVICE_WIDE_DATA_CATEGORIES).toContain('activeIdentity');
      expect(DEVICE_WIDE_DATA_CATEGORIES).toContain('settings');
      expect(DEVICE_WIDE_DATA_CATEGORIES).toContain('pvpLoadout');
    });
  });

  describe('4. Device Identity (Stable Installation UUID)', () => {
    test('generates valid RFC4122 v4 UUID format', () => {
      const uuid = generateUuidV4();
      const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      expect(uuid).toMatch(uuidV4Regex);
    });

    test('stable deviceId across repeated reads on the same device', async () => {
      const id1 = await getDeviceId();
      const id2 = await getDeviceId();
      expect(id1).toBe(id2);
      expect(mockStore[DEVICE_ID_KEY]).toBe(id1);

      // Even if in-memory cache is reset, it loads the persisted value from AsyncStorage
      _resetCachedDeviceIdForTests();
      const id3 = await getDeviceId();
      expect(id3).toBe(id1);
    });

    test('deviceId remains unchanged across user logouts and account switches', async () => {
      const initialDeviceId = await getDeviceId();

      // Guest active
      await setActiveIdentity('guest');
      expect(await getDeviceId()).toBe(initialDeviceId);

      // Account A active
      await setActiveIdentity('uid:account_alpha');
      expect(await getDeviceId()).toBe(initialDeviceId);

      // Account B active
      await setActiveIdentity('uid:account_beta');
      expect(await getDeviceId()).toBe(initialDeviceId);

      // Switch back to guest
      await setActiveIdentity('guest');
      expect(await getDeviceId()).toBe(initialDeviceId);

      expect(mockStore[DEVICE_ID_KEY]).toBe(initialDeviceId);
    });
  });

  describe('5. Sequence Safety Contract & Reconciler', () => {
    test('local syncSeq defaults to 0 when missing', async () => {
      const seq = await getLocalSyncSeq('uid:user_1');
      expect(seq).toBe(0);
    });

    test('saves and reads local syncSeq for an identity', async () => {
      await setLocalSyncSeq('uid:user_1', 7);
      expect(await getLocalSyncSeq('uid:user_1')).toBe(7);

      // Another user has independent sequence
      expect(await getLocalSyncSeq('uid:user_2')).toBe(0);
    });

    test('rejects negative or non-integer sync sequences', async () => {
      await expect(setLocalSyncSeq('uid:user_1', -1)).rejects.toThrow();
      await expect(setLocalSyncSeq('uid:user_1', 'invalid')).rejects.toThrow();
    });

    test('sequence initialization helper: local missing + cloud 15 -> next sequence > 15', () => {
      // Local missing (null or 0)
      const baseSeq = reconcileSyncSequence(null, 15);
      expect(baseSeq).toBe(15);

      const nextSeq = computeSafeNextSequence(null, 15);
      expect(nextSeq).toBe(16);
      expect(nextSeq).toBeGreaterThan(15);
    });

    test('local sequence higher than cloud does not roll backward', () => {
      // Local is ahead (e.g. 20) while cloud last applied was 15
      const baseSeq = reconcileSyncSequence(20, 15);
      expect(baseSeq).toBe(20);

      const nextSeq = computeSafeNextSequence(20, 15);
      expect(nextSeq).toBe(21);
      expect(nextSeq).toBeGreaterThan(20);
    });

    test('reconcileAndSaveLocalSyncSeq updates stored sequence only when cloud is higher', async () => {
      // 1. Initial state: local is 0, cloud reports 15
      const reconciled1 = await reconcileAndSaveLocalSyncSeq('uid:user_1', 15);
      expect(reconciled1).toBe(15);
      expect(await getLocalSyncSeq('uid:user_1')).toBe(15);

      // 2. Local advances to 22
      await setLocalSyncSeq('uid:user_1', 22);

      // 3. Cloud still reports 15: local must NOT roll backward
      const reconciled2 = await reconcileAndSaveLocalSyncSeq('uid:user_1', 15);
      expect(reconciled2).toBe(22);
      expect(await getLocalSyncSeq('uid:user_1')).toBe(22);
    });

    test('scoped sync metadata keys are properly formatted', () => {
      const syncSeqKey = getScopedKey('syncSeq', 'uid:player_x');
      const pendingOpKey = getScopedKey('pendingSyncOp', 'uid:player_x');
      const snapshotKey = getScopedKey('lastSyncedSnapshot', 'uid:player_x');

      expect(syncSeqKey).toBe('@KnowledgeKing:uid:player_x:syncSeq');
      expect(pendingOpKey).toBe('@KnowledgeKing:uid:player_x:pendingSyncOp');
      expect(snapshotKey).toBe('@KnowledgeKing:uid:player_x:lastSyncedSnapshot');
    });
  });
});
