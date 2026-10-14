const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('node:fs');

const validPayload = () => ({
  schemaVersion: 1,
  revision: 1,
  updatedAt: Date.now(),
  appliedOps: {
    'dev-uuid-1': 1
  },
  progression: {
    totalXp: 150
  },
  campaign: {
    clearedStages: {
      'L1-S1': true
    },
    stageStars: {
      'L1-S1': 3
    },
    stageScores: {
      'L1-S1': 1000
    },
    bestCombo: 10
  },
  uniqueClaims: {
    'firstClear:L1-S1': {
      claimedAt: Date.now(),
      deviceId: 'dev-uuid-1'
    }
  }
});

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'knowledge-king-sync-rules-test',
    database: { rules: fs.readFileSync('firebase/database.rules.json', 'utf8') }
  });

  const db = (uid) => (uid ? testEnv.authenticatedContext(uid).database() : testEnv.unauthenticatedContext().database());
  const seed = (path, data) => testEnv.withSecurityRulesDisabled((ctx) => ctx.database().ref(path).set(data));

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log('PASS: ' + name);
      passed++;
    } catch (e) {
      console.error('FAIL: ' + name, e);
      failed++;
    }
  }

  try {
    console.log('\n--- Running Cloud Progress Security Rules Tests ---');

    // A. Authenticated owner can read own userProgress
    await test('A. Authenticated owner can read own userProgress', async () => {
      await seed('userProgress/user123', validPayload());
      await assertSucceeds(db('user123').ref('userProgress/user123').get());
    });

    // B. Authenticated owner can write valid own userProgress
    await test('B. Authenticated owner can write valid own userProgress', async () => {
      await assertSucceeds(db('user123').ref('userProgress/user123').set(validPayload()));
    });

    // C. Account A cannot read Account B userProgress
    await test('C. Account A cannot read Account B userProgress', async () => {
      await seed('userProgress/user456', validPayload());
      await assertFails(db('user123').ref('userProgress/user456').get());
    });

    // D. Account A cannot write Account B userProgress
    await test('D. Account A cannot write Account B userProgress', async () => {
      await assertFails(db('user123').ref('userProgress/user456').set(validPayload()));
    });

    // E. Unauthenticated read denied
    await test('E. Unauthenticated read denied', async () => {
      await seed('userProgress/user123', validPayload());
      await assertFails(db(null).ref('userProgress/user123').get());
    });

    // F. Unauthenticated write denied
    await test('F. Unauthenticated write denied', async () => {
      await assertFails(db(null).ref('userProgress/user123').set(validPayload()));
    });

    // G. Malformed schema (schemaVersion !== 1) rejected
    await test('G. Malformed schema (schemaVersion 2) rejected', async () => {
      const payload = validPayload();
      payload.schemaVersion = 2;
      await assertFails(db('user123').ref('userProgress/user123').set(payload));
    });

    // H. Negative XP rejected
    await test('H. Negative XP rejected', async () => {
      const payload = validPayload();
      payload.progression.totalXp = -50;
      await assertFails(db('user123').ref('userProgress/user123').set(payload));
    });

    // I. Invalid star rating (> 3) rejected
    await test('I. Invalid star rating (> 3) rejected', async () => {
      const payload = validPayload();
      payload.campaign.stageStars['L1-S1'] = 4;
      await assertFails(db('user123').ref('userProgress/user123').set(payload));
    });

    // J. Invalid star rating (< 1) rejected
    await test('J. Invalid star rating (< 1) rejected', async () => {
      const payload = validPayload();
      payload.campaign.stageStars['L1-S1'] = 0;
      await assertFails(db('user123').ref('userProgress/user123').set(payload));
    });

    // K. Unexpected top-level child rejected
    await test('K. Unexpected top-level child rejected', async () => {
      const payload = validPayload();
      payload.maliciousField = 'exploit';
      await assertFails(db('user123').ref('userProgress/user123').set(payload));
    });

    // L. Unexpected campaign child rejected
    await test('L. Unexpected campaign child rejected', async () => {
      const payload = validPayload();
      payload.campaign.extraProperty = 123;
      await assertFails(db('user123').ref('userProgress/user123').set(payload));
    });

    // M. Unique claim missing required deviceId rejected
    await test('M. Unique claim missing required deviceId rejected', async () => {
      const payload = validPayload();
      payload.uniqueClaims['firstClear:L1-S1'] = { claimedAt: Date.now() }; // no deviceId
      await assertFails(db('user123').ref('userProgress/user123').set(payload));
    });

    // N. Revision rollback rejected
    await test('N. Revision rollback rejected', async () => {
      const initial = validPayload();
      initial.revision = 5;
      await seed('userProgress/user123', initial);

      const rollback = validPayload();
      rollback.revision = 3;
      await assertFails(db('user123').ref('userProgress/user123').set(rollback));
    });

    // O. Existing users/$uid behavior remains valid (authenticated read/write own profile)
    await test('O. Authenticated player can write own users profile', async () => {
      await assertSucceeds(db('user123').ref('users/user123').set({
        displayName: 'Player One',
        updatedAt: Date.now()
      }));
    });

    // P. Another authenticated player CAN read users/$uid (needed for PvP lookup)
    await test('P. Other authenticated player can read public users profile', async () => {
      await seed('users/user123', { displayName: 'Player One' });
      await assertSucceeds(db('user456').ref('users/user123').get());
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
