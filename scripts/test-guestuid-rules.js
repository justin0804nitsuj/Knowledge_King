const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const roomPath = 'rooms/room1';

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'knowledge-king-test',
    database: { rules: fs.readFileSync('firebase/database.rules.json', 'utf8') },
  });

  const db = uid => testEnv.authenticatedContext(uid).database();
  const seed = async data => testEnv.withSecurityRulesDisabled(ctx => ctx.database().ref(roomPath).set(data));
  let passed = 0, failed = 0;

  async function test(name, fn) {
    try { await fn(); console.log('PASS: ' + name); passed++; }
    catch (e) { console.error('FAIL: ' + name, e); failed++; }
  }

  try {
    // 1. Host creates WAITING room without guestUid → PASS
    await test('1. Host creates WAITING room without guestUid', () =>
      assertSucceeds(db('hostUid').ref(roomPath).set({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      }))
    );

    // 2. Guest joins → PASS
    await test('2. Guest joins', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertSucceeds(db('guestUid').ref(roomPath + '/players/guestUid').set({ role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 }));
    });

    // 3. Guest cannot directly write meta/guestUid → FAIL
    await test('3. Guest cannot directly write meta/guestUid', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertFails(db('guestUid').ref(roomPath + '/meta/guestUid').set('guestUid'));
    });

    // 4. Host starts with actual GUEST UID → PASS
    await test('4. Host starts with actual GUEST UID', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertSucceeds(db('hostUid').ref(roomPath).update({
        'meta/status': 'IN_BATTLE',
        'meta/guestUid': 'guestUid',
        'match': { matchId: 'm1', battleSeed: '1', rulesetVersion: '1', vocabularyVersion: '1', createdAt: 1, level: 1, questionCount: 10 },
        'matchState': { roundIndex: 0, phase: 'ANSWERING', players: { hostUid: { hp: 100, score: 0, correct: 0, wrong: 0, items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } } }, guestUid: { hp: 100, score: 0, correct: 0, wrong: 0, items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } } } } }
      }));
    });

    // 5. Host starts with guestUid = hostUid → FAIL
    await test('5. Host starts with guestUid = hostUid', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertFails(db('hostUid').ref(roomPath).update({
        'meta/status': 'IN_BATTLE',
        'meta/guestUid': 'hostUid',
        'match': { matchId: 'm1', battleSeed: '1', rulesetVersion: '1', vocabularyVersion: '1', createdAt: 1, level: 1, questionCount: 10 },
        'matchState': { roundIndex: 0, phase: 'ANSWERING', players: { hostUid: { hp: 100, score: 0, correct: 0, wrong: 0, items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } } }, guestUid: { hp: 100, score: 0, correct: 0, wrong: 0, items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } } } } }
      }));
    });

    // 6. Host starts with nonexistent guest UID → FAIL
    await test('6. Host starts with nonexistent guest UID', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertFails(db('hostUid').ref(roomPath).update({
        'meta/status': 'IN_BATTLE',
        'meta/guestUid': 'missingUid',
        'match': { matchId: 'm1', battleSeed: '1', rulesetVersion: '1', vocabularyVersion: '1', createdAt: 1, level: 1, questionCount: 10 },
        'matchState': { roundIndex: 0, phase: 'ANSWERING', players: {} }
      }));
    });

    // 7. Host starts with UID whose role != GUEST → FAIL
    await test('7. Host starts with UID whose role != GUEST', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, fakeGuest: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertFails(db('hostUid').ref(roomPath).update({
        'meta/status': 'IN_BATTLE',
        'meta/guestUid': 'fakeGuest',
        'match': { matchId: 'm1', battleSeed: '1', rulesetVersion: '1', vocabularyVersion: '1', createdAt: 1, level: 1, questionCount: 10 },
        'matchState': { roundIndex: 0, phase: 'ANSWERING', players: {} }
      }));
    });

    // 8. guestUid modification after start → FAIL
    await test('8. guestUid modification after start', async () => {
      await seed({
        meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'IN_BATTLE', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertFails(db('hostUid').ref(roomPath + '/meta/guestUid').set('newGuestUid'));
    });

    // 9. guestUid removal after start → FAIL
    await test('9. guestUid removal after start', async () => {
      await seed({
        meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'IN_BATTLE', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertFails(db('hostUid').ref(roomPath + '/meta/guestUid').remove());
    });

    // 10. Host cancels WAITING room without guestUid → PASS
    await test('10. Host cancels WAITING room without guestUid', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'WAITING', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertSucceeds(db('hostUid').ref(roomPath + '/meta/status').set('CANCELLED'));
    });

    // 11. Host deletes CANCELLED room → PASS
    await test('11. Host deletes CANCELLED room', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'CANCELLED', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertSucceeds(db('hostUid').ref(roomPath).remove());
    });

    // 12. Guest deletes CANCELLED room → FAIL
    await test('12. Guest deletes CANCELLED room', async () => {
      await seed({
        meta: { hostUid: 'hostUid', status: 'CANCELLED', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } }
      });
      await assertFails(db('guestUid').ref(roomPath).remove());
    });

    // 13. Host only departed in FINISHED → delete FAIL
    await test('13. Host only departed in FINISHED → delete FAIL', async () => {
      await seed({
        meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'FINISHED', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } },
        departures: { hostUid: true }
      });
      await assertFails(db('hostUid').ref(roomPath).remove());
    });

    // 14. Guest only departed in FINISHED → delete FAIL
    await test('14. Guest only departed in FINISHED → delete FAIL', async () => {
      await seed({
        meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'FINISHED', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } },
        departures: { guestUid: true }
      });
      await assertFails(db('guestUid').ref(roomPath).remove());
    });

    // 15. both departed → Host delete PASS
    await test('15. both departed → Host delete PASS', async () => {
      await seed({
        meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'FINISHED', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } },
        departures: { hostUid: true, guestUid: true }
      });
      await assertSucceeds(db('hostUid').ref(roomPath).remove());
    });

    // 16. both departed → Guest delete PASS
    await test('16. both departed → Guest delete PASS', async () => {
      await seed({
        meta: { hostUid: 'hostUid', guestUid: 'guestUid', status: 'FINISHED', createdAt: 1, rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1' },
        players: { hostUid: { role: 'HOST', ready: true, displayName: 'Player', joinedAt: 1 }, guestUid: { role: 'GUEST', ready: true, displayName: 'Player', joinedAt: 1 } },
        departures: { hostUid: true, guestUid: true }
      });
      await assertSucceeds(db('guestUid').ref(roomPath).remove());
    });

  } finally {
    console.log('Total: ' + (passed + failed) + '; Passed: ' + passed + '; Failed: ' + failed);
    await testEnv.cleanup();
  }
  if (failed) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
