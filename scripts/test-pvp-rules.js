const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const fs = require('fs');

async function run() {
  const testEnv = await initializeTestEnvironment({
    projectId: 'test-project',
    database: {
      rules: fs.readFileSync('firebase/database.rules.json', 'utf8')
    }
  });

  const host = testEnv.authenticatedContext('hostUid');
  const guest = testEnv.authenticatedContext('guestUid');

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
          hostUid: { hp: 100, potionsRemaining: 2, score: 0, correct: 0, wrong: 0, processedActions: {} },
          guestUid: { hp: 100, potionsRemaining: 2, score: 0, correct: 0, wrong: 0, processedActions: {} }
        },
        rounds: {
          '0': {
            answers: {
              hostUid: { selectedChoiceId: 'a', isCorrect: true, submittedAt: 123 },
              guestUid: { selectedChoiceId: 'b', isCorrect: false, submittedAt: 124 }
            }
          }
        }
      }
    });
  });

  console.log('Attempting resolveRound transaction...');
  try {
    await assertSucceeds(
      host.database().ref('rooms/room1/matchState').transaction((state) => {
        if (!state) return state;
        state.phase = 'ROUND_RESULT';
        state.players.hostUid.correct += 1;
        state.players.hostUid.score += 10;
        state.players.guestUid.hp -= 20;
        state.players.guestUid.wrong += 1;
        state.rounds['0'].resolution = {
          hostCorrect: true,
          guestCorrect: false,
          damageToHost: 0,
          damageToGuest: 20,
          hostHpBefore: 100,
          guestHpBefore: 100,
          hostHpAfter: 100,
          guestHpAfter: 80,
          resolvedAt: 125
        };
        return state;
      })
    );
    console.log('resolveRound SUCCEEDED');
  } catch (e) {
    console.error('resolveRound FAILED:', e.message);
  }

  await testEnv.cleanup();
}

run();
