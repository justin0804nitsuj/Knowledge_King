const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const fs = require('fs');

async function run() {
  const rules = fs.readFileSync('firebase/database.rules.json', 'utf8');
  const testEnv = await initializeTestEnvironment({
    projectId: 'test-project',
    database: { rules }
  });

  const hostUid = 'host1';
  const guestUid = 'guest1';
  const roomId = '89730';

  // Setup initial room data
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await context.database().ref(`rooms/${roomId}`).set({
      meta: {
        hostUid,
        status: 'WAITING',
        createdAt: 123456,
        rulesetVersion: '1.0.0',
        vocabularyVersion: '1.0.0',
        vocabularySchemaVersion: '1.0.0'
      },
      players: {
        [hostUid]: {
          role: 'HOST',
          ready: true,
          joinedAt: 123456,
          displayName: 'Host'
        },
        [guestUid]: {
          role: 'GUEST',
          ready: true,
          joinedAt: 123456,
          displayName: 'Guest'
        }
      }
    });
  });

  const hostContext = testEnv.authenticatedContext(hostUid);
  let passed = 0;
  let failed = 0;

  // Attempt the startMatch transaction equivalent
  const newData = {
    meta: {
      hostUid,
      status: 'IN_BATTLE',
      createdAt: 123456,
      rulesetVersion: '1.0.0',
      vocabularyVersion: '1.0.0',
      vocabularySchemaVersion: '1.0.0'
    },
    players: {
      [hostUid]: {
        role: 'HOST',
        ready: true,
        joinedAt: 123456,
        displayName: 'Host'
      },
      [guestUid]: {
        role: 'GUEST',
        ready: true,
        joinedAt: 123456,
        displayName: 'Guest'
      }
    },
    match: {
      matchId: 'match_123',
      battleSeed: '12345',
      rulesetVersion: '1.0.0',
      vocabularyVersion: '1.0.0',
      createdAt: 12345678,
      questionCount: 10,
      level: 1
    }
  };

  console.log("Attempting valid startMatch...");
  try {
    await assertSucceeds(hostContext.database().ref(`rooms/${roomId}`).set(newData));
    console.log("SUCCESS!");
    passed++;
  } catch (e) {
    console.error("FAILED!", e);
    failed++;
  }

  // Attempt unauthorized guest rewrite
  const badData = JSON.parse(JSON.stringify(newData));
  badData.players[guestUid].ready = false;
  
  console.log("Attempting invalid rewrite by host...");
  try {
    await assertFails(hostContext.database().ref(`rooms/${roomId}`).set(badData));
    console.log("SUCCESS! Denied as expected.");
    passed++;
  } catch (e) {
    console.error("FAILED! Should have been denied.", e);
    failed++;
  }

  await testEnv.cleanup();
  console.log(`Total: ${passed + failed}; Passed: ${passed}; Failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
