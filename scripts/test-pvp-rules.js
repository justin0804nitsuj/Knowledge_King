const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { transformSync } = require('@babel/core');

const roomPath = 'rooms/room1';
const clone = value => JSON.parse(JSON.stringify(value));
const player = (hp = 80) => ({
  hp, score: 0, correct: 0, wrong: 0,
  items: { HEAL: { remaining: 2 }, SHIELD: { remaining: 1 }, POWER: { remaining: 1 } },
});
const makeRoom = () => ({
  meta: {
    hostUid: 'hostUid', guestUid: 'guestUid', status: 'IN_BATTLE', createdAt: 1,
    rulesetVersion: '1', vocabularyVersion: '1', vocabularySchemaVersion: '1',
  },
  players: {
    hostUid: { displayName: 'Host', role: 'HOST', joinedAt: 1, ready: true },
    guestUid: { displayName: 'Guest', role: 'GUEST', joinedAt: 1, ready: true },
  },
  match: { matchId: 'match1', battleSeed: '12345', rulesetVersion: '1', vocabularyVersion: '1', createdAt: 1, level: 1, questionCount: 10 },
  matchState: { roundIndex: 0, phase: 'ANSWERING', roundStartedAt: Date.now(), players: { hostUid: player(), guestUid: player() } },
});
const answer = (selectedChoiceId = 'choice', clientSubmittedAt = Date.now()) => ({ selectedChoiceId, clientSubmittedAt, submittedAt: Date.now() });
const itemUse = itemId => ({ itemId, actionId: 'action1', usedAt: 1 });
const applyItem = (room, uid, itemId, roundIndex = 0) => {
  const state = room.matchState.players[uid];
  state.items[itemId].remaining -= 1;
  state.itemUses = { ...state.itemUses, [roundIndex]: itemUse(itemId) };
  if (itemId === 'HEAL') state.hp = Math.min(100, state.hp + 25);
  return room;
};

// Transpile the actual service and its domain imports using the existing Jest/Babel toolchain.
function loadService(db, entry = 'src/services/pvp/pvpBattleService.js') {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const requireFrom = createRequire(filename);
    const localRequire = specifier => {
      if (specifier === '../firebase/firebaseDatabase') return { db };
      const resolved = requireFrom.resolve(specifier);
      if (resolved.startsWith(path.resolve('src') + path.sep) && resolved.endsWith('.js')) return load(resolved);
      return requireFrom(specifier);
    };
    const { code } = transformSync(fs.readFileSync(filename, 'utf8'), {
      filename, configFile: false, babelrc: false,
      plugins: [require.resolve('@babel/plugin-transform-modules-commonjs')],
    });
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports);
    return module.exports;
  }
  return load(path.resolve(entry));
}

async function run() {
  if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) throw new Error('Run with firebase emulators:exec --only database.');
  const [host, port] = process.env.FIREBASE_DATABASE_EMULATOR_HOST.split(':');
  const testEnv = await initializeTestEnvironment({
    projectId: process.env.GCLOUD_PROJECT || 'demo-knowledge-king',
    database: { host, port: Number(port), rules: fs.readFileSync('firebase/database.rules.json', 'utf8') },
  });
  const contexts = {
    host: testEnv.authenticatedContext('hostUid'),
    guest: testEnv.authenticatedContext('guestUid'),
    outsider: testEnv.authenticatedContext('outsiderUid'),
  };
  const db = role => contexts[role].database();
  const seed = async room => testEnv.withSecurityRulesDisabled(context => context.database().ref(roomPath).set(room));
  const stateRef = (role, suffix = '') => db(role).ref(roomPath + '/matchState' + suffix);
  const guestPlayer = () => stateRef('guest', '/players/guestUid');
  let passed = 0;
  let failed = 0;
  async function test(name, scenario) {
    try {
      const room = makeRoom();
      await seed(room);
      await scenario(room);
      console.log('PASS ' + name);
      passed += 1;
    } catch (error) {
      console.error('FAIL ' + name + ': ' + error.message);
      failed += 1;
    }
  }
  async function serviceAction(role, callback) {
    const roomRef = db(role).ref(roomPath);
    let listener;
    await new Promise((resolve, reject) => {
      listener = () => resolve();
      roomRef.on('value', listener, reject);
    });
    try { return await callback(loadService(db(role)._delegate)); }
    finally { roomRef.off('value', listener); }
  }

  try {
    await test('current ANSWERING answer accepted', () => assertSucceeds(stateRef('guest', '/rounds/0/answers/guestUid').set(answer())));
    for (const phase of ['RESOLVING', 'ROUND_RESULT', 'FINISHED']) {
      await test('answer rejected during ' + phase, async room => {
        room.matchState.phase = phase;
        await seed(room);
        await assertFails(stateRef('guest', '/rounds/0/answers/guestUid').set(answer()));
      });
    }
    for (const roundIndex of [-1, 1]) {
      await test('answer rejected for wrong round ' + roundIndex, () => assertFails(stateRef('guest', '/rounds/' + roundIndex + '/answers/guestUid').set(answer())));
    }
    await test('past nonnegative round answer rejected', async room => {
      room.matchState.roundIndex = 1;
      await seed(room);
      await assertFails(stateRef('guest', '/rounds/0/answers/guestUid').set(answer()));
    });
    for (const status of ['WAITING', 'FINISHED', 'CANCELLED']) {
      await test('answer rejected in ' + status + ' room', async room => {
        room.meta.status = status;
        await seed(room);
        await assertFails(stateRef('guest', '/rounds/0/answers/guestUid').set(answer()));
      });
    }
    await test('dead player answer rejected', async room => {
      room.matchState.players.guestUid.hp = 0;
      await seed(room);
      await assertFails(stateRef('guest', '/rounds/0/answers/guestUid').set(answer()));
    });
    await test('outsider answer rejected', () => assertFails(stateRef('outsider', '/rounds/0/answers/outsiderUid').set(answer())));
    await test('opponent answer mutation rejected', () => assertFails(stateRef('guest', '/rounds/0/answers/hostUid').set(answer())));
    await test('duplicate answer mutation rejected', async room => {
      room.matchState.rounds = { 0: { answers: { guestUid: answer() } } };
      await seed(room);
      await assertFails(stateRef('guest', '/rounds/0/answers/guestUid').set(answer('different')));
    });
    await test('answer timestamp mutation rejected', async room => {
      room.matchState.rounds = { 0: { answers: { guestUid: answer() } } };
      await seed(room);
      await assertFails(stateRef('guest', '/rounds/0/answers/guestUid/submittedAt').set(2));
    });

    for (const itemId of ['HEAL', 'SHIELD', 'POWER']) {
      await test('legal own ' + itemId + ' at service transaction scope', async room => {
        applyItem(room, 'guestUid', itemId);
        await assertSucceeds(db('guest').ref(roomPath).set(room));
      });
      await test(itemId + ' after answer rejected with otherwise legal HP/inventory', async room => {
        room.matchState.rounds = { 0: { answers: { guestUid: answer() } } };
        await seed(room);
        applyItem(room, 'guestUid', itemId);
        await assertFails(db('guest').ref(roomPath).set(room));
      });
    }
    for (const phase of ['RESOLVING', 'ROUND_RESULT', 'FINISHED']) {
      await test('item rejected during ' + phase, async room => {
        room.matchState.phase = phase;
        await seed(room);
        const used = applyItem(clone(room), 'guestUid', 'POWER');
        await assertFails(guestPlayer().set(used.matchState.players.guestUid));
      });
    }
    for (const roundIndex of [-1, 1]) {
      await test('item rejected for wrong round ' + roundIndex, async room => {
        applyItem(room, 'guestUid', 'POWER', roundIndex);
        await assertFails(db('guest').ref(roomPath).set(room));
      });
    }
    await test('past nonnegative item round rejected', async room => {
      room.matchState.roundIndex = 1;
      await seed(room);
      applyItem(room, 'guestUid', 'POWER', 0);
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    for (const status of ['WAITING', 'FINISHED', 'CANCELLED']) {
      await test('item rejected in ' + status + ' room', async room => {
        room.meta.status = status;
        await seed(room);
        applyItem(room, 'guestUid', 'POWER');
        await assertFails(guestPlayer().set(room.matchState.players.guestUid));
      });
    }
    await test('HEAL at full HP rejected', async room => {
      room.matchState.players.guestUid.hp = 100;
      await seed(room);
      applyItem(room, 'guestUid', 'HEAL');
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    await test('dead player item rejected', async room => {
      room.matchState.players.guestUid.hp = 0;
      await seed(room);
      applyItem(room, 'guestUid', 'SHIELD');
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    await test('second item in same round rejected', async room => {
      applyItem(room, 'guestUid', 'SHIELD');
      await seed(room);
      applyItem(room, 'guestUid', 'POWER');
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    await test('zero inventory use rejected', async room => {
      room.matchState.players.guestUid.items.POWER.remaining = 0;
      await seed(room);
      applyItem(room, 'guestUid', 'POWER');
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    for (const itemId of ['HEAL', 'SHIELD', 'POWER']) {
      await test(itemId + ' inventory 0 -> 1 refill rejected', async room => {
        room.matchState.players.guestUid.items[itemId].remaining = 0;
        await seed(room);
        await assertFails(guestPlayer().child('items/' + itemId + '/remaining').set(1));
      });
    }
    await test('inventory decrement without itemUse rejected', () => assertFails(guestPlayer().child('items/POWER/remaining').set(0)));
    await test('multiple inventory decrements rejected', async room => {
      applyItem(room, 'guestUid', 'POWER');
      room.matchState.players.guestUid.items.SHIELD.remaining = 0;
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    await test('HEAL decrement by two rejected', async room => {
      applyItem(room, 'guestUid', 'HEAL');
      room.matchState.players.guestUid.items.HEAL.remaining = 0;
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    await test('fractional inventory rejected', () => assertFails(guestPlayer().child('items/POWER/remaining').set(0.5)));
    await test('itemUse without inventory decrement rejected', () => assertFails(guestPlayer().child('itemUses/0').set(itemUse('POWER'))));
    await test('invalid item ID rejected', async room => {
      room.matchState.players.guestUid.itemUses = { 0: itemUse('INVALID') };
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    await test('itemUse with same actionId but changed itemId rejected', async room => {
      applyItem(room, 'guestUid', 'SHIELD');
      await seed(room);
      await assertFails(guestPlayer().child('itemUses/0/itemId').set('POWER'));
    });
    await test('itemUse timestamp overwrite rejected', async room => {
      applyItem(room, 'guestUid', 'SHIELD');
      await seed(room);
      await assertFails(guestPlayer().child('itemUses/0/usedAt').set(2));
    });
    for (const role of ['host', 'guest']) {
      await test(role + ' cannot mutate opponent inventory', async room => {
        const opponent = role === 'host' ? 'guestUid' : 'hostUid';
        applyItem(room, opponent, 'POWER');
        await assertFails(db(role).ref(roomPath).set(room));
      });
    }
    for (const hp of [0, 60, 100]) {
      await test('arbitrary own HP ' + hp + ' rejected', () => assertFails(guestPlayer().child('hp').set(hp)));
    }
    await test('opponent HP modification rejected', () => assertFails(stateRef('guest', '/players/hostUid/hp').set(60)));
    await test('HEAL exact amount required', async room => {
      applyItem(room, 'guestUid', 'HEAL');
      room.matchState.players.guestUid.hp = 90;
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    await test('cannot submit answer and use item in the same write', async room => {
      applyItem(room, 'guestUid', 'POWER');
      room.matchState.rounds = { 0: { answers: { guestUid: answer() } } };
      await assertFails(db('guest').ref(roomPath).set(room));
    });

    for (const suffix of ['/rounds/0/answers/guestUid', '/rounds/0/answers', '/rounds/0', '/rounds']) {
      await test('answer history deletion rejected at ' + suffix, async room => {
        room.matchState.rounds = { 0: { answers: { hostUid: answer(), guestUid: answer() } } };
        await seed(room);
        await assertFails(stateRef('guest', suffix).remove());
      });
    }
    for (const suffix of ['/players/guestUid/itemUses/0', '/players/guestUid/itemUses', '/players/guestUid/items', '/players/hostUid', '/players', '']) {
      await test('combat state deletion rejected at ' + (suffix || '/matchState'), async room => {
        applyItem(room, 'guestUid', 'POWER');
        await seed(room);
        await assertFails(stateRef('guest', suffix).remove());
      });
    }
    await test('old round deletion rejected while adding current answer', async room => {
      room.matchState.roundIndex = 1;
      room.matchState.rounds = { 0: { answers: { hostUid: answer(), guestUid: answer() } } };
      await seed(room);
      delete room.matchState.rounds[0];
      room.matchState.rounds[1] = { answers: { guestUid: answer() } };
      await assertFails(db('guest').ref(roomPath).set(room));
    });
    for (const suffix of ['/phase', '/roundIndex', '/players/guestUid/score', '/players/guestUid/correct']) {
      await test('Guest cannot change settlement field ' + suffix, () => assertFails(stateRef('guest', suffix).set(suffix === '/phase' ? 'ROUND_RESULT' : 1)));
    }
    await test('Guest cannot create resolution', () => assertFails(stateRef('guest', '/rounds/0/resolution').set({ hostCorrect: true, guestCorrect: false })));
    await test('outsider room transaction rejected', room => assertFails(db('outsider').ref(roomPath).set(applyItem(room, 'guestUid', 'POWER'))));

    await test('real Guest service answer transaction accepted; duplicate rejected', async () => {
      await serviceAction('guest', async service => {
        const result = await service.submitAnswer('room1', 'guestUid', 0, 'choice');
        assert.equal(result.committed, true);
        assert.equal((await service.submitAnswer('room1', 'guestUid', 0, 'other')).committed, false);
        const stored = result.snapshot.val().matchState.rounds[0].answers.guestUid;
        assert.equal(stored.selectedChoiceId, 'choice');
        assert.equal(Object.hasOwn(stored, 'isCorrect'), false);
      });
    });
    for (const itemId of ['HEAL', 'SHIELD', 'POWER']) {
      await test('real Guest service ' + itemId + ' transaction accepted', () => serviceAction('guest', async service => {
        const result = await service.useBattleItem({ roomCode: 'room1', uid: 'guestUid', roundIndex: 0, itemId, actionId: 'action1' });
        assert.equal(result.committed, true);
      }));
    }
    for (const itemId of ['HEAL', 'SHIELD', 'POWER']) {
      await test('real Host service ' + itemId + ' transaction accepted', () => serviceAction('host', async service => {
        const result = await service.useBattleItem({ roomCode: 'room1', uid: 'hostUid', roundIndex: 0, itemId, actionId: 'action1' });
        assert.equal(result.committed, true);
      }));
    }
    await test('real service rejects item after answer', () => serviceAction('guest', async service => {
      assert.equal((await service.submitAnswer('room1', 'guestUid', 0, 'choice')).committed, true);
      assert.equal((await service.useBattleItem({ roomCode: 'room1', uid: 'guestUid', roundIndex: 0, itemId: 'POWER', actionId: 'action1' })).committed, false);
    }));
    await test('honest Host ignores forged true for wrong choice in emulator settlement', async room => {
      room.matchState.rounds = { 0: { answers: {
        hostUid: { ...answer('invalid-choice'), isCorrect: false },
        guestUid: { ...answer('another-invalid-choice'), isCorrect: true },
      } } };
      await seed(room);
      await serviceAction('host', async service => {
        const result = await service.resolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(result.committed, true);
        const state = result.snapshot.val().matchState;
        assert.equal(state.rounds[0].resolution.guestCorrect, false);
        assert.equal(state.players.hostUid.hp, 80);
      });
    });
    const { createPvpQuestions } = loadService(db('host')._delegate, 'src/domain/pvp/pvpQuestions.js');
    const [question] = createPvpQuestions(makeRoom().match);
    const wrongChoice = question.choices.find(choice => choice.id !== question.correctChoiceId).id;
    for (const [name, hostCorrect, guestCorrect, hostItem, guestItem, toHost, toGuest] of [
      ['normal', true, false, null, null, 0, 20],
      ['Guest correct', false, true, null, null, 20, 0],
      ['both correct (TIE)', true, true, null, null, 10, 10],
      ['both wrong', false, false, null, null, 0, 0],
      ['POWER', true, false, 'POWER', null, 0, 30],
      ['SHIELD', true, false, null, 'SHIELD', 0, 0],
      ['POWER vs SHIELD', true, false, 'POWER', 'SHIELD', 0, 10],
      ['both POWER (TIE)', true, true, 'POWER', 'POWER', 20, 20],
      ['both SHIELD (TIE)', true, true, 'SHIELD', 'SHIELD', 0, 0],
      ['wrong POWER', false, true, 'POWER', null, 20, 0],
    ]) {
      await test('real Host settlement: ' + name + ' ignores submitted booleans', async room => {
        if (hostItem) applyItem(room, 'hostUid', hostItem);
        if (guestItem) applyItem(room, 'guestUid', guestItem);
        room.matchState.rounds = { 0: { answers: {
          hostUid: { ...answer(hostCorrect ? question.correctChoiceId : wrongChoice), isCorrect: !hostCorrect },
          guestUid: { ...answer(guestCorrect ? question.correctChoiceId : wrongChoice), isCorrect: !guestCorrect },
        } } };
        await seed(room);
        await serviceAction('host', async service => {
          const result = await service.resolveRound('room1', 'hostUid', 'guestUid', 0);
          assert.equal(result.committed, true);
          const state = result.snapshot.val().matchState;
          assert.equal(state.players.hostUid.hp, 80 - toHost);
          assert.equal(state.players.guestUid.hp, 80 - toGuest);
          assert.equal(state.rounds[0].resolution.hostCorrect, hostCorrect);
          assert.equal(state.rounds[0].resolution.guestCorrect, guestCorrect);
        });
      });
    }
    await test('Host can advance a settled round; Guest cannot', async room => {
      room.matchState.phase = 'ROUND_RESULT';
      await seed(room);
      await assertFails(stateRef('guest').update({ phase: 'ANSWERING', roundIndex: 1 }));
      await serviceAction('host', async service => assert.equal((await service.advanceRound('room1', 0)).committed, true));
    });
    await test('real service preserves item inventory and history across round advancement', async () => {
      await serviceAction('guest', async service => {
        assert.equal((await service.useBattleItem({ roomCode: 'room1', uid: 'guestUid', roundIndex: 0, itemId: 'SHIELD', actionId: 'shield1' })).committed, true);
        assert.equal((await service.submitAnswer('room1', 'guestUid', 0, question.correctChoiceId)).committed, true);
      });
      await serviceAction('host', async service => {
        assert.equal((await service.submitAnswer('room1', 'hostUid', 0, question.correctChoiceId)).committed, true);
        assert.equal((await service.resolveRound('room1', 'hostUid', 'guestUid', 0)).committed, true);
        assert.equal((await service.advanceRound('room1', 0)).committed, true);
      });
      await serviceAction('guest', async service => {
        const result = await service.useBattleItem({ roomCode: 'room1', uid: 'guestUid', roundIndex: 1, itemId: 'POWER', actionId: 'power2' });
        assert.equal(result.committed, true);
        const state = result.snapshot.val().matchState.players.guestUid;
        assert.equal(state.items.SHIELD.remaining, 0);
        assert.equal(state.items.POWER.remaining, 0);
        assert.equal(state.itemUses[0].itemId, 'SHIELD');
        assert.equal(state.itemUses[1].itemId, 'POWER');
      });
    });
    await test('real simultaneous KO finalization remains DRAW with unequal scores', async room => {
      room.matchState.players.hostUid.hp = 10;
      room.matchState.players.guestUid.hp = 10;
      room.matchState.players.hostUid.score = 50;
      room.matchState.players.guestUid.score = 10;
      room.matchState.rounds = { 0: { answers: {
        hostUid: answer(question.correctChoiceId), guestUid: answer(question.correctChoiceId),
      } } };
      await seed(room);
      await serviceAction('host', async service => {
        assert.equal((await service.resolveRound('room1', 'hostUid', 'guestUid', 0)).committed, true);
        const result = await service.finalizeMatch('room1', 'hostUid', 'guestUid');
        assert.equal(result.committed, true);
        assert.equal(result.snapshot.val().meta.status, 'FINISHED');
        assert.equal(result.snapshot.val().matchState.result.winnerUid, undefined);
      });
    });
    await test('finished Guest may leave without altering results', async room => {
      room.meta.status = 'FINISHED';
      room.matchState.phase = 'FINISHED';
      await seed(room);
      await assertSucceeds(db('guest').ref(roomPath + '/players/guestUid').remove());
    });
    await test('Guest retains existing active-room departure permission', () =>
      assertSucceeds(db('guest').ref(roomPath + '/players/guestUid').remove()));
    const makeResolution = (speedOutcome = 'HOST_FASTER', speedDiffMs = 420) => ({
      hostCorrect: true, guestCorrect: true,
      hostBaseDamage: 20, guestBaseDamage: 20,
      hostPowerBonus: 0, guestPowerBonus: 0,
      hostShieldBlocked: 0, guestShieldBlocked: 0,
      damageToHost: 0, damageToGuest: 0,
      hostHpBefore: 80, guestHpBefore: 80,
      hostHpAfter: 80, guestHpAfter: 80,
      resolvedAt: 1,
      speedOutcome, speedDiffMs,
    });
    await test('Host resolution with valid speed fields is accepted', async room => {
      room.matchState.rounds = { 0: { answers: { hostUid: answer('c'), guestUid: answer('c') } } };
      await seed(room);
      await assertSucceeds(db('host').ref(roomPath + '/matchState/rounds/0/resolution').set(makeResolution('HOST_FASTER', 420)));
    });
    await test('Host resolution with invalid speedOutcome rejected', async room => {
      room.matchState.rounds = { 0: { answers: { hostUid: answer('c'), guestUid: answer('c') } } };
      await seed(room);
      await assertFails(db('host').ref(roomPath + '/matchState/rounds/0/resolution').set(makeResolution('INVALID_OUTCOME', 420)));
    });
    await test('Host resolution with negative speedDiffMs rejected', async room => {
      room.matchState.rounds = { 0: { answers: { hostUid: answer('c'), guestUid: answer('c') } } };
      await seed(room);
      await assertFails(db('host').ref(roomPath + '/matchState/rounds/0/resolution').set(makeResolution('HOST_FASTER', -10)));
    });
    await test('Host resolution with fractional speedDiffMs rejected', async room => {
      room.matchState.rounds = { 0: { answers: { hostUid: answer('c'), guestUid: answer('c') } } };
      await seed(room);
      await assertFails(db('host').ref(roomPath + '/matchState/rounds/0/resolution').set(makeResolution('HOST_FASTER', 12.5)));
    });
    await test('finished Host may remove the room', async room => {
      room.meta.status = 'FINISHED';
      room.matchState.phase = 'FINISHED';
      room.departures = { hostUid: true, guestUid: true };
      await seed(room);
      await assertSucceeds(db('host').ref(roomPath).remove());
    });
    // ----- CANCELLED room deletion tests -----
    await test('host can delete CANCELLED room', async room => {
      room.meta.status = 'CANCELLED';
      await seed(room);
      await assertSucceeds(db('host').ref(roomPath).remove());
    });
    await test('guest cannot delete CANCELLED room', async room => {
      room.meta.status = 'CANCELLED';
      await seed(room);
      await assertFails(db('guest').ref(roomPath).remove());
    });

    // ----- Phase 11C Timer Authority & Timeout Security Cases A-L -----
    await test('A. valid answer before deadline -> ALLOWED', async room => {
      room.matchState.roundStartedAt = Date.now();
      await seed(room);
      await assertSucceeds(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        submittedAt: Date.now(),
      }));
    });

    await test('B. valid answer after deadline -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        submittedAt: Date.now(),
      }));
    });

    // Exact deadline boundary tests (no +400ms grace period)
    await test('B1. Round 0 answer after 10000ms (at 10001ms) -> DENIED', async room => {
      room.matchState.roundIndex = 0;
      room.matchState.roundStartedAt = Date.now() - 10001;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        submittedAt: Date.now(),
      }));
    });

    await test('B2. Round 0 answer at 10400ms (no 400ms grace) -> DENIED', async room => {
      room.matchState.roundIndex = 0;
      room.matchState.roundStartedAt = Date.now() - 10400;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        submittedAt: Date.now(),
      }));
    });

    await test('B3. Round 1 answer before 6000ms deadline -> ALLOWED', async room => {
      room.matchState.roundIndex = 1;
      room.matchState.roundStartedAt = Date.now();
      await seed(room);
      await assertSucceeds(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        submittedAt: Date.now(),
      }));
    });

    await test('B4. Round 1 answer after 6000ms (at 6001ms) -> DENIED', async room => {
      room.matchState.roundIndex = 1;
      room.matchState.roundStartedAt = Date.now() - 6001;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        submittedAt: Date.now(),
      }));
    });

    await test('B5. Round 1 answer at 6400ms (no 400ms grace) -> DENIED', async room => {
      room.matchState.roundIndex = 1;
      room.matchState.roundStartedAt = Date.now() - 6400;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        submittedAt: Date.now(),
      }));
    });

    // ----- Phase 11D transit tolerance (500ms) & clientSubmittedAt security tests -----
    await test('B6. Tap before deadline with server receipt after deadline within 500ms transit -> ALLOWED', async room => {
      room.matchState.roundIndex = 1;
      const now = Date.now();
      // Started 6200ms ago -> deadline was 200ms ago
      room.matchState.roundStartedAt = now - 6200;
      await seed(room);
      // Tap was at 300ms ago (which is 100ms BEFORE deadline: 6200 - 300 = 5900ms <= 6000ms)
      // And now - 300 >= now - 500 (transit was 300ms <= 500ms)
      const tapTime = now - 300;
      await assertSucceeds(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        clientSubmittedAt: tapTime,
        submittedAt: now,
      }));
    });

    await test('B7. Tap after deadline arriving within 500ms -> DENIED', async room => {
      room.matchState.roundIndex = 1;
      const now = Date.now();
      // Started 6200ms ago -> deadline was 200ms ago
      room.matchState.roundStartedAt = now - 6200;
      await seed(room);
      // Tap was at 100ms ago (which is 100ms AFTER deadline: 6200 - 100 = 6100ms > 6000ms)
      const tapTime = now - 100;
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        clientSubmittedAt: tapTime,
        submittedAt: now,
      }));
    });

    await test('B8. clientSubmittedAt older than now - 500ms (transit tolerance exceeded) -> DENIED', async room => {
      room.matchState.roundIndex = 1;
      const now = Date.now();
      room.matchState.roundStartedAt = now - 5000;
      await seed(room);
      // Tap timestamp is 600ms older than now
      const tapTime = now - 600;
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        clientSubmittedAt: tapTime,
        submittedAt: now,
      }));
    });

    await test('B9. clientSubmittedAt in the future relative to server now -> DENIED', async room => {
      room.matchState.roundIndex = 1;
      const now = Date.now();
      room.matchState.roundStartedAt = now - 1000;
      await seed(room);
      // Tap timestamp is in the future
      const tapTime = now + 1000;
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        clientSubmittedAt: tapTime,
        submittedAt: now,
      }));
    });

    await test('B10. Forged backdated clientSubmittedAt far in past -> DENIED', async room => {
      room.matchState.roundIndex = 1;
      const now = Date.now();
      room.matchState.roundStartedAt = now - 10000;
      await seed(room);
      const tapTime = now - 9000;
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'choice1',
        clientSubmittedAt: tapTime,
        submittedAt: now,
      }));
    });

    await test('C. player marks self timedOut before deadline -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now();
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('D. player marks self timedOut after deadline -> ALLOWED', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      await seed(room);
      await assertSucceeds(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('E. Host marks missing Guest timedOut before deadline -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now();
      await seed(room);
      await assertFails(db('host').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('F. Host marks missing Guest timedOut after deadline -> ALLOWED', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      await seed(room);
      await assertSucceeds(db('host').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('G. Guest cannot mark Host timedOut -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/hostUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('H. timeout cannot overwrite an already submitted real answer -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      room.matchState.rounds = { 0: { answers: { guestUid: { selectedChoiceId: 'c', submittedAt: Date.now() - 14000 } } } };
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('I. real answer cannot overwrite an existing timeout -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now();
      room.matchState.rounds = { 0: { answers: { guestUid: { timedOut: true, submittedAt: Date.now() } } } };
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        selectedChoiceId: 'c',
        submittedAt: Date.now(),
      }));
    });

    await test('J. outsider cannot write answer or timeout -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now();
      await seed(room);
      await assertFails(db('outsider').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        selectedChoiceId: 'c',
        submittedAt: Date.now(),
      }));
      await assertFails(db('outsider').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('K. previous round deadline cannot authorize current-round writes -> DENIED', async room => {
      room.matchState.roundIndex = 0;
      room.matchState.roundStartedAt = Date.now();
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/1/answers/guestUid').set({
        selectedChoiceId: 'c',
        submittedAt: Date.now(),
      }));
    });

    await test('L. current round deadline cannot modify an old resolved round -> DENIED', async room => {
      room.matchState.roundIndex = 1;
      room.matchState.roundStartedAt = Date.now();
      room.matchState.rounds = {
        0: {
          answers: { hostUid: { selectedChoiceId: 'c', submittedAt: Date.now() }, guestUid: { selectedChoiceId: 'c', submittedAt: Date.now() } },
          resolution: makeResolution('TIE', 0)
        }
      };
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        selectedChoiceId: 'c2',
        submittedAt: Date.now(),
      }));
    });

    // ----- Phase 11C Both-Timeout Integration Suite (A through J) -----
    await test('Integration A: both missing after deadline Host auto-resolve -> ALLOWED, both timedOut, round resolves', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      delete room.matchState.rounds;
      await seed(room);
      await serviceAction('host', async service => {
        const result = await service.autoResolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(result.committed, true);
      });
      const guestSnap = await db('guest').ref(roomPath).get();
      assert.equal(guestSnap.exists(), true);
      const guestVal = guestSnap.val();
      assert.equal(guestVal.matchState.rounds[0].answers.hostUid.timedOut, true);
      assert.equal(guestVal.matchState.rounds[0].answers.guestUid.timedOut, true);
      assert.ok(guestVal.matchState.rounds[0].resolution);
      assert.equal(guestVal.matchState.rounds[0].resolution.hostTimedOut, true);
      assert.equal(guestVal.matchState.rounds[0].resolution.guestTimedOut, true);
      assert.equal(guestVal.matchState.players.hostUid.wrong, 1);
      assert.equal(guestVal.matchState.players.guestUid.wrong, 1);
      assert.equal(guestVal.matchState.phase, 'ROUND_RESULT');
    });

    await test('Integration B: Host answered, Guest missing after deadline -> Guest timeout filled, resolve succeeds', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      room.matchState.rounds = { 0: { answers: { hostUid: answer(question.correctChoiceId) } } };
      await seed(room);
      await serviceAction('host', async service => {
        const result = await service.autoResolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(result.committed, true);
      });
      const guestVal = (await db('guest').ref(roomPath).get()).val();
      assert.equal(guestVal.matchState.rounds[0].answers.guestUid.timedOut, true);
      assert.equal(guestVal.matchState.rounds[0].answers.hostUid.selectedChoiceId, question.correctChoiceId);
      assert.equal(guestVal.matchState.rounds[0].resolution.hostCorrect, true);
      assert.equal(guestVal.matchState.rounds[0].resolution.guestTimedOut, true);
      assert.equal(guestVal.matchState.players.hostUid.correct, 1);
      assert.equal(guestVal.matchState.players.guestUid.wrong, 1);
      assert.equal(guestVal.matchState.phase, 'ROUND_RESULT');
    });

    await test('Integration C: Guest answered, Host missing after deadline -> Host timeout filled, resolve succeeds', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      room.matchState.rounds = { 0: { answers: { guestUid: answer(question.correctChoiceId) } } };
      await seed(room);
      await serviceAction('host', async service => {
        const result = await service.autoResolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(result.committed, true);
      });
      const guestVal = (await db('guest').ref(roomPath).get()).val();
      assert.equal(guestVal.matchState.rounds[0].answers.hostUid.timedOut, true);
      assert.equal(guestVal.matchState.rounds[0].answers.guestUid.selectedChoiceId, question.correctChoiceId);
      assert.equal(guestVal.matchState.rounds[0].resolution.hostTimedOut, true);
      assert.equal(guestVal.matchState.rounds[0].resolution.guestCorrect, true);
      assert.equal(guestVal.matchState.players.hostUid.wrong, 1);
      assert.equal(guestVal.matchState.players.guestUid.correct, 1);
      assert.equal(guestVal.matchState.phase, 'ROUND_RESULT');
    });

    await test('Integration D: both timeout records already exist -> resolve succeeds', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      room.matchState.rounds = { 0: { answers: {
        hostUid: { timedOut: true, submittedAt: Date.now() - 1000 },
        guestUid: { timedOut: true, submittedAt: Date.now() - 1000 }
      } } };
      await seed(room);
      await serviceAction('host', async service => {
        const result = await service.autoResolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(result.committed, true);
      });
      const guestVal = (await db('guest').ref(roomPath).get()).val();
      assert.equal(guestVal.matchState.rounds[0].resolution.hostTimedOut, true);
      assert.equal(guestVal.matchState.rounds[0].resolution.guestTimedOut, true);
      assert.equal(guestVal.matchState.players.hostUid.wrong, 1);
      assert.equal(guestVal.matchState.players.guestUid.wrong, 1);
      assert.equal(guestVal.matchState.phase, 'ROUND_RESULT');
    });

    await test('Integration E: one real answer exists -> never overwritten by timeout', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      room.matchState.rounds = { 0: { answers: { hostUid: answer(question.correctChoiceId) } } };
      await seed(room);
      await serviceAction('host', async service => {
        await service.fillMissingTimeouts('room1', 'hostUid', 'guestUid', 0);
      });
      const hostVal = (await db('host').ref(roomPath).get()).val();
      assert.equal(hostVal.matchState.rounds[0].answers.hostUid.selectedChoiceId, question.correctChoiceId);
      assert.equal(hostVal.matchState.rounds[0].answers.hostUid.timedOut, undefined);
      await assertFails(db('host').ref(roomPath + '/matchState/rounds/0/answers/hostUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('Integration F: timeout already exists -> never overwritten', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      room.matchState.rounds = { 0: { answers: { hostUid: { timedOut: true, submittedAt: 99999 } } } };
      await seed(room);
      await serviceAction('host', async service => {
        await service.fillMissingTimeouts('room1', 'hostUid', 'guestUid', 0);
      });
      const hostVal = (await db('host').ref(roomPath).get()).val();
      assert.equal(hostVal.matchState.rounds[0].answers.hostUid.submittedAt, 99999);
      await assertFails(db('host').ref(roomPath + '/matchState/rounds/0/answers/hostUid').set({
        selectedChoiceId: question.correctChoiceId,
        submittedAt: Date.now(),
      }));
    });

    await test('Integration G: auto-resolve before deadline -> DENIED / no settlement', async room => {
      room.matchState.roundStartedAt = Date.now();
      delete room.matchState.rounds;
      await seed(room);
      await serviceAction('host', async service => {
        const result = await service.autoResolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(result.committed, false);
      });
      const hostVal = (await db('host').ref(roomPath).get()).val();
      assert.equal(hostVal.matchState.phase, 'ANSWERING');
      assert.equal(hostVal.matchState.rounds?.[0]?.resolution, undefined);
      await assertFails(db('host').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
    });

    await test('Integration H: outsider attempting same settlement -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      delete room.matchState.rounds;
      await seed(room);
      await assertFails(db('outsider').ref(roomPath + '/matchState/rounds/0/answers/guestUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
      await assertFails(db('outsider').ref(roomPath + '/matchState/rounds/0/resolution').set(makeResolution('TIE', 0)));
      await serviceAction('outsider', async service => {
        await assert.rejects(
          service.autoResolveRound('room1', 'hostUid', 'guestUid', 0),
          /permission_denied/
        );
      });
    });

    await test('Integration I: Guest attempting Host-authoritative settlement -> DENIED', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      delete room.matchState.rounds;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/answers/hostUid').set({
        timedOut: true,
        submittedAt: Date.now(),
      }));
      await assertFails(db('guest').ref(roomPath + '/matchState/rounds/0/resolution').set(makeResolution('TIE', 0)));
      await serviceAction('guest', async service => {
        await assert.rejects(
          service.autoResolveRound('room1', 'hostUid', 'guestUid', 0),
          /permission_denied/
        );
      });
    });

    await test('Integration J: repeated Host resolve after resolution -> no duplicate damage / safe no-op', async room => {
      room.matchState.roundStartedAt = Date.now() - 15000;
      delete room.matchState.rounds;
      await seed(room);
      await serviceAction('host', async service => {
        const res1 = await service.autoResolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(res1.committed, true);
        const hpAfterFirst = res1.snapshot.val().matchState.players.hostUid.hp;
        const wrongAfterFirst = res1.snapshot.val().matchState.players.hostUid.wrong;

        const res2 = await service.autoResolveRound('room1', 'hostUid', 'guestUid', 0);
        assert.equal(res2.committed, false);

        const roomVal = (await db('host').ref(roomPath).get()).val();
        assert.equal(roomVal.matchState.players.hostUid.hp, hpAfterFirst);
        assert.equal(roomVal.matchState.players.hostUid.wrong, wrongAfterFirst);
      });
    });

    // Phase 12A — PvP Skill Loadout & Battle Reveal Rules Tests
    await test('Phase 12A: valid loadout reveal by player during LOADOUT_REVEAL -> ALLOWED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      await seed(room);
      await assertSucceeds(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 1,
        SHIELD: 1,
        POWER: 2,
      }));
    });

    await test('Phase 12A: default loadout reveal (HEAL 2, SHIELD 1, POWER 1) -> ALLOWED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      await seed(room);
      await assertSucceeds(db('host').ref(roomPath + '/matchState/revealedLoadouts/hostUid').set({
        HEAL: 2,
        SHIELD: 1,
        POWER: 1,
      }));
    });

    await test('Phase 12A: player attempting to reveal opponent deck -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/hostUid').set({
        HEAL: 2,
        SHIELD: 1,
        POWER: 1,
      }));
    });

    await test('Phase 12A: outsider attempting to reveal deck -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      await seed(room);
      await assertFails(db('outsider').ref(roomPath + '/matchState/revealedLoadouts/outsiderUid').set({
        HEAL: 2,
        SHIELD: 1,
        POWER: 1,
      }));
    });

    await test('Phase 12A: modifying revealed deck after initial publish -> DENIED (immutable)', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      room.matchState.revealedLoadouts = {
        guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 }
      };
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 1,
        SHIELD: 1,
        POWER: 2,
      }));
    });

    await test('Phase 12A: deck with 3 copies of same skill -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 3,
        SHIELD: 1,
        POWER: 0,
      }));
    });

    await test('Phase 12A: deck with fewer or more than 4 cards -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      await seed(room);
      // 3 cards
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 1,
        SHIELD: 1,
        POWER: 1,
      }));
      // 5 cards
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 2,
        SHIELD: 2,
        POWER: 1,
      }));
    });

    await test('Phase 12A: deck with negative or fractional or unknown skills -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      delete room.matchState.roundStartedAt;
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: -1,
        SHIELD: 2,
        POWER: 3,
      }));
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 1.5,
        SHIELD: 1.5,
        POWER: 1,
      }));
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 2,
        SHIELD: 1,
        POWER: 1,
        EXTRA: 1,
      }));
    });

    await test('Phase 12A: deck reveal outside LOADOUT_REVEAL phase -> DENIED', async room => {
      room.matchState.phase = 'ANSWERING';
      await seed(room);
      await assertFails(db('guest').ref(roomPath + '/matchState/revealedLoadouts/guestUid').set({
        HEAL: 2,
        SHIELD: 1,
        POWER: 1,
      }));
    });

    await test('Phase 12A: Host advances phase from LOADOUT_REVEAL to ANSWERING with revealed inventory -> ALLOWED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 1, SHIELD: 1, POWER: 2 },
        guestUid: { HEAL: 2, SHIELD: 2, POWER: 0 }
      };
      await seed(room);
      await assertSucceeds(db('host').ref(roomPath).update({
        'matchState/phase': 'ANSWERING',
        'matchState/roundStartedAt': Date.now(),
        'matchState/players/hostUid/items/POWER/remaining': 2,
        'matchState/players/hostUid/items/HEAL/remaining': 1,
        'matchState/players/guestUid/items/POWER/remaining': 0,
        'matchState/players/guestUid/items/SHIELD/remaining': 2,
      }));
    });

    // ----- Phase 12A Regression Suite (A - J) for startFirstRound -----
    await test('Phase 12A Regression A: Host + both valid reveals -> startFirstRound ALLOWED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
        guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 }
      };
      await seed(room);
      await serviceAction('host', service => service.startFirstRound({ roomCode: 'room1', hostUid: 'hostUid', guestUid: 'guestUid' }));
      const snap = await db('host').ref(roomPath + '/matchState/phase').get();
      assert.equal(snap.val(), 'ANSWERING');
    });

    await test('Phase 12A Regression B: Guest attempts startFirstRound -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
        guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 }
      };
      await seed(room);
      await serviceAction('guest', async service => {
        await assert.rejects(
          service.startFirstRound({ roomCode: 'room1', hostUid: 'hostUid', guestUid: 'guestUid' }),
          /permission_denied/
        );
      });
    });

    await test('Phase 12A Regression C: Only one reveal exists -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
      };
      await seed(room);
      const result = await serviceAction('host', service => service.startFirstRound({ roomCode: 'room1', hostUid: 'hostUid', guestUid: 'guestUid' }));
      assert.equal(result.committed, false);
      await assertFails(db('host').ref(roomPath).update({
        'matchState/phase': 'ANSWERING',
        'matchState/roundStartedAt': Date.now(),
      }));
    });

    await test('Phase 12A Regression D: Host inventory does not match Host reveal -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 1, SHIELD: 1, POWER: 2 },
        guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 }
      };
      await seed(room);
      await assertFails(db('host').ref(roomPath).update({
        'matchState/phase': 'ANSWERING',
        'matchState/roundStartedAt': Date.now(),
        'matchState/players/hostUid/items/HEAL/remaining': 2,
        'matchState/players/hostUid/items/SHIELD/remaining': 1,
        'matchState/players/hostUid/items/POWER/remaining': 2,
        'matchState/players/guestUid/items/HEAL/remaining': 2,
        'matchState/players/guestUid/items/SHIELD/remaining': 1,
        'matchState/players/guestUid/items/POWER/remaining': 1,
      }));
    });

    await test('Phase 12A Regression E: Guest inventory does not match Guest reveal -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
        guestUid: { HEAL: 1, SHIELD: 2, POWER: 1 }
      };
      await seed(room);
      await assertFails(db('host').ref(roomPath).update({
        'matchState/phase': 'ANSWERING',
        'matchState/roundStartedAt': Date.now(),
        'matchState/players/hostUid/items/HEAL/remaining': 2,
        'matchState/players/hostUid/items/SHIELD/remaining': 1,
        'matchState/players/hostUid/items/POWER/remaining': 1,
        'matchState/players/guestUid/items/HEAL/remaining': 2,
        'matchState/players/guestUid/items/SHIELD/remaining': 2,
        'matchState/players/guestUid/items/POWER/remaining': 1,
      }));
    });

    await test('Phase 12A Regression F: POWER 3 in inventory -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 1, SHIELD: 1, POWER: 2 },
        guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 }
      };
      await seed(room);
      await assertFails(db('host').ref(roomPath).update({
        'matchState/phase': 'ANSWERING',
        'matchState/roundStartedAt': Date.now(),
        'matchState/players/hostUid/items/POWER/remaining': 3,
      }));
    });

    await test('Phase 12A Regression G: deck with total != 4 during reveal -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      await seed(room);
      await assertFails(db('host').ref(roomPath + '/matchState/revealedLoadouts/hostUid').set({
        HEAL: 2,
        SHIELD: 2,
        POWER: 1,
      }));
    });

    await test('Phase 12A Regression H: outsider start -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
        guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 }
      };
      await seed(room);
      await serviceAction('outsider', async service => {
        await assert.rejects(
          service.startFirstRound({ roomCode: 'room1', hostUid: 'hostUid', guestUid: 'guestUid' }),
          /permission_denied/
        );
      });
    });

    await test('Phase 12A Regression I: attempt to mutate revealedLoadouts during startFirstRound -> DENIED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 2, SHIELD: 1, POWER: 1 },
        guestUid: { HEAL: 2, SHIELD: 1, POWER: 1 }
      };
      await seed(room);
      await assertFails(db('host').ref(roomPath).update({
        'matchState/phase': 'ANSWERING',
        'matchState/roundStartedAt': Date.now(),
        'matchState/revealedLoadouts/guestUid/POWER': 2,
      }));
    });

    await test('Phase 12A Regression J: valid custom decks Host P2/S1/H1, Guest H2/S2/P0 -> ALLOWED', async room => {
      room.matchState.phase = 'LOADOUT_REVEAL';
      room.matchState.revealedLoadouts = {
        hostUid: { HEAL: 1, SHIELD: 1, POWER: 2 },
        guestUid: { HEAL: 2, SHIELD: 2, POWER: 0 }
      };
      await seed(room);
      await serviceAction('host', service => service.startFirstRound({ roomCode: 'room1', hostUid: 'hostUid', guestUid: 'guestUid' }));
      const snap = await db('host').ref(roomPath).get();
      const val = snap.val();
      assert.equal(val.matchState.phase, 'ANSWERING');
      assert.equal(val.matchState.players.hostUid.items.POWER.remaining, 2);
      assert.equal(val.matchState.players.hostUid.items.SHIELD.remaining, 1);
      assert.equal(val.matchState.players.hostUid.items.HEAL.remaining, 1);
      assert.equal(val.matchState.players.guestUid.items.POWER.remaining, 0);
      assert.equal(val.matchState.players.guestUid.items.SHIELD.remaining, 2);
      assert.equal(val.matchState.players.guestUid.items.HEAL.remaining, 2);
    });
  } finally {
    console.log('Total: ' + (passed + failed) + '; Passed: ' + passed + '; Failed: ' + failed);
    await testEnv.cleanup();
  }
  if (failed) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
