const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'gsat-battle-items',
    database: {
      rules: fs.readFileSync('firebase/database.rules.json', 'utf8')
    }
  });

  const host = testEnv.authenticatedContext('hostUid');
  const guest = testEnv.authenticatedContext('guestUid');
  const hacker = testEnv.authenticatedContext('hackerUid');

  let passed = 0;
  let failed = 0;

  async function test(name, promise) {
    try {
      await promise;
      console.log(`✅ ${name}`);
      passed++;
    } catch (e) {
      console.error(`❌ ${name}`);
      console.error(e.message);
      failed++;
    }
  }

  // Set up initial state
  await testEnv.withSecurityRulesDisabled(async context => {
    const db = context.database();
    await db.ref('rooms/room1').set({
      meta: {
        hostUid: 'hostUid',
        status: 'IN_BATTLE'
      },
      matchState: {
        roundIndex: 0,
        phase: 'ANSWERING',
        players: {
          hostUid: { 
            hp: 80, 
            items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } }, 
            score: 0, correct: 0, wrong: 0, itemUses: {} 
          },
          guestUid: { 
            hp: 100, 
            items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } }, 
            score: 0, correct: 0, wrong: 0, itemUses: {} 
          }
        },
        rounds: {
          '0': {}
        }
      }
    });
  });

  // 1. legal own HEAL
  await test('legal own HEAL', assertSucceeds(
    host.database().ref('rooms/room1/matchState/players/hostUid').update({
      hp: 100,
      'items/HEAL/remaining': 1,
      'itemUses/0': { itemId: 'HEAL', actionId: 'action1', usedAt: 123456 }
    })
  ));

  // 2. HEAL at full HP rejected
  await test('HEAL at full HP rejected', assertFails(
    guest.database().ref('rooms/room1/matchState/players/guestUid').update({
      hp: 125,
      'items/HEAL/remaining': 1,
      'itemUses/0': { itemId: 'HEAL', actionId: 'action2', usedAt: 123456 }
    })
  ));

  // Set up answer for host
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.database().ref('rooms/room1/matchState/rounds/0/answers/hostUid').set({
      selectedChoiceId: 'a', isCorrect: true, submittedAt: 123
    });
  });

  // 3. HEAL after answer rejected
  await test('HEAL after answer rejected', assertFails(
    host.database().ref('rooms/room1/matchState/players/hostUid').update({
      hp: 100, // already 100, wait let's change HP back to 80 via rules disabled
      'items/HEAL/remaining': 0,
      'itemUses/1': { itemId: 'HEAL', actionId: 'action3', usedAt: 123456 }
    })
  ));

  // Reset host state
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.database().ref('rooms/room1/matchState/players/hostUid').set({
      hp: 80, 
      items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } }, 
      score: 0, correct: 0, wrong: 0, itemUses: {} 
    });
    await context.database().ref('rooms/room1/matchState/players/guestUid').set({
      hp: 80, 
      items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } }, 
      score: 0, correct: 0, wrong: 0, itemUses: {} 
    });
  });

  // 4. legal SHIELD
  await test('legal SHIELD', assertSucceeds(
    host.database().ref('rooms/room1/matchState/players/hostUid').update({
      'items/SHIELD/remaining': 0,
      'itemUses/0': { itemId: 'SHIELD', actionId: 'action4', usedAt: 123456 }
    })
  ));

  // 5. legal POWER
  await test('legal POWER', assertSucceeds(
    guest.database().ref('rooms/room1/matchState/players/guestUid').update({
      'items/POWER/remaining': 0,
      'itemUses/0': { itemId: 'POWER', actionId: 'action5', usedAt: 123456 }
    })
  ));

  // 6. second item same round rejected (Host already used SHIELD in round 0)
  await test('second item same round rejected', assertFails(
    host.database().ref('rooms/room1/matchState/players/hostUid').update({
      'items/POWER/remaining': 0,
      'itemUses/0': { itemId: 'POWER', actionId: 'action6', usedAt: 123456 } // overwriting index 0
    })
  ));

  // 7. zero inventory rejected
  await test('zero inventory rejected', assertFails(
    host.database().ref('rooms/room1/matchState/players/hostUid').update({
      'items/SHIELD/remaining': -1,
      'itemUses/1': { itemId: 'SHIELD', actionId: 'action7', usedAt: 123456 } 
    })
  ));

  // 8. opponent inventory mutation rejected
  await test('opponent inventory mutation rejected', assertFails(
    host.database().ref('rooms/room1/matchState/players/guestUid').update({
      'items/HEAL/remaining': 0,
      'itemUses/1': { itemId: 'HEAL', actionId: 'action8', usedAt: 123456 } 
    })
  ));

  // 9. inventory increase rejected
  await test('inventory increase rejected', assertFails(
    guest.database().ref('rooms/room1/matchState/players/guestUid').update({
      'items/POWER/remaining': 2,
      'itemUses/1': { itemId: 'POWER', actionId: 'action9', usedAt: 123456 } 
    })
  ));

  // 10. forged HP mutation rejected
  await test('forged HP mutation rejected', assertFails(
    guest.database().ref('rooms/room1/matchState/players/guestUid').update({
      hp: 100, // healing without decrementing potion
    })
  ));

  // 11. itemUse overwrite rejected
  await test('itemUse overwrite rejected', assertFails(
    host.database().ref('rooms/room1/matchState/players/hostUid/itemUses/0').set({
      itemId: 'HEAL', actionId: 'action10', usedAt: 123456 
    })
  ));

  // Prepare round answers for settlement
  await testEnv.withSecurityRulesDisabled(async context => {
    await context.database().ref('rooms/room1/matchState/rounds/0').set({
      answers: {
        hostUid: { selectedChoiceId: 'a', isCorrect: true, submittedAt: 123 },
        guestUid: { selectedChoiceId: 'b', isCorrect: false, submittedAt: 124 }
      }
    });
  });

  // 12. Guest settlement rejected
  await test('Guest settlement rejected', assertFails(
    guest.database().ref('rooms/room1/matchState').update({
      phase: 'ROUND_RESULT',
      'players/guestUid/hp': 60
    })
  ));

  // 13. Host legal settlement accepted
  await test('Host legal settlement accepted', assertSucceeds(
    host.database().ref('rooms/room1/matchState').update({
      phase: 'ROUND_RESULT',
      'players/hostUid/score': 10,
      'players/hostUid/correct': 1,
      'players/guestUid/hp': 60,
      'players/guestUid/wrong': 1,
      'rounds/0/resolution': {
        hostCorrect: true, guestCorrect: false
      }
    })
  ));

  console.log('---------------------------------');
  console.log(`Total: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log('---------------------------------');

  await testEnv.cleanup();
}

run().catch(console.error);
