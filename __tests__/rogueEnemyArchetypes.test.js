import {
  INTENT_TYPES,
  ARCHETYPE_IDS,
  ENEMY_ARCHETYPES,
  getArchetype,
  getIntentForTurn,
  selectArchetypeForNode,
  validateEncounterIntegrity,
} from '../src/domain/rogue/combat/enemyArchetypes';
import {
  createEncounter,
  resolveEncounterTurn,
  ENCOUNTER_STATUS,
} from '../src/domain/rogue/combat/rogueCombat';
import { chooseAttackAndResolve, chooseGuardAndResolve } from './helpers/rogueTestHelpers';

describe('Rogue Expedition V0.1 — Phase R3 Enemy Archetypes & Intent System', () => {
  describe('1. Archetype Registry & Intent Patterns', () => {
    test('SCOUT has predictable repeating ATTACK cycle', () => {
      const scout = getArchetype(ARCHETYPE_IDS.SCOUT);
      expect(scout).toBeDefined();
      expect(scout.hp).toBe(80);
      expect(scout.baseDamage).toBe(8);

      // Verify turns 1 to 5 are strictly ATTACK with 8 damage
      for (let turn = 1; turn <= 5; turn++) {
        const intent = getIntentForTurn(scout, turn);
        expect(intent).toEqual({ type: INTENT_TYPES.ATTACK, value: 8 });
      }
    });

    test('BRUTE alternates between normal ATTACK and HEAVY_ATTACK', () => {
      const brute = getArchetype(ARCHETYPE_IDS.BRUTE);
      expect(brute).toBeDefined();
      expect(brute.hp).toBe(100);

      // Turn 1: ATTACK 8
      expect(getIntentForTurn(brute, 1)).toEqual({ type: INTENT_TYPES.ATTACK, value: 8 });
      // Turn 2: HEAVY_ATTACK 20
      expect(getIntentForTurn(brute, 2)).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 20 });
      // Turn 3: ATTACK 8
      expect(getIntentForTurn(brute, 3)).toEqual({ type: INTENT_TYPES.ATTACK, value: 8 });
      // Turn 4: HEAVY_ATTACK 20
      expect(getIntentForTurn(brute, 4)).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 20 });
    });

    test('SENTINEL alternates between ATTACK and GUARD', () => {
      const sentinel = getArchetype(ARCHETYPE_IDS.SENTINEL);
      expect(sentinel).toBeDefined();
      expect(sentinel.hp).toBe(125);

      // Turn 1: ATTACK 10
      expect(getIntentForTurn(sentinel, 1)).toEqual({ type: INTENT_TYPES.ATTACK, value: 10 });
      // Turn 2: GUARD 10
      expect(getIntentForTurn(sentinel, 2)).toEqual({ type: INTENT_TYPES.GUARD, value: 10 });
      // Turn 3: ATTACK 10
      expect(getIntentForTurn(sentinel, 3)).toEqual({ type: INTENT_TYPES.ATTACK, value: 10 });
      // Turn 4: GUARD 10
      expect(getIntentForTurn(sentinel, 4)).toEqual({ type: INTENT_TYPES.GUARD, value: 10 });
    });

    test('OVERLORD follows deterministic 3-turn rotation (ATTACK -> GUARD -> HEAVY_ATTACK)', () => {
      const overlord = getArchetype(ARCHETYPE_IDS.OVERLORD);
      expect(overlord).toBeDefined();
      expect(overlord.hp).toBe(175);

      // Turn 1: ATTACK 10
      expect(getIntentForTurn(overlord, 1)).toEqual({ type: INTENT_TYPES.ATTACK, value: 10 });
      // Turn 2: GUARD 10
      expect(getIntentForTurn(overlord, 2)).toEqual({ type: INTENT_TYPES.GUARD, value: 10 });
      // Turn 3: HEAVY_ATTACK 23
      expect(getIntentForTurn(overlord, 3)).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 23 });
      // Turn 4: ATTACK 10
      expect(getIntentForTurn(overlord, 4)).toEqual({ type: INTENT_TYPES.ATTACK, value: 10 });
      // Turn 5: GUARD 10
      expect(getIntentForTurn(overlord, 5)).toEqual({ type: INTENT_TYPES.GUARD, value: 10 });
      // Turn 6: HEAVY_ATTACK 23
      expect(getIntentForTurn(overlord, 6)).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 23 });
    });
  });

  describe('2. Deterministic Archetype Assignment', () => {
    test('BOSS node always assigns OVERLORD archetype', () => {
      const seeds = [42, 999, 'custom-seed', 20261015];
      for (const s of seeds) {
        expect(selectArchetypeForNode('BOSS', s, 'node-4-0')).toBe(ARCHETYPE_IDS.OVERLORD);
      }
    });

    test('same run seed + node ID always assigns identical archetype', () => {
      const arch1 = selectArchetypeForNode('BATTLE', 12345, 'node-1-0');
      const arch2 = selectArchetypeForNode('BATTLE', 12345, 'node-1-0');
      expect(arch1).toBe(arch2);

      const elite1 = selectArchetypeForNode('ELITE', 88888, 'node-3-1');
      const elite2 = selectArchetypeForNode('ELITE', 88888, 'node-3-1');
      expect(elite1).toBe(elite2);
    });

    test('different nodes or seeds produce variety within valid candidates', () => {
      const eliteArch = selectArchetypeForNode('ELITE', 10101, 'node-3-0');
      expect([ARCHETYPE_IDS.SENTINEL, ARCHETYPE_IDS.BRUTE]).toContain(eliteArch);

      const battleArch = selectArchetypeForNode('BATTLE', 20202, 'node-1-1');
      expect([ARCHETYPE_IDS.SCOUT, ARCHETYPE_IDS.BRUTE]).toContain(battleArch);
    });
  });

  describe('3. Validation & Malformed State Safety', () => {
    test('validates valid encounter state correctly', () => {
      const validEncounter = {
        archetypeId: ARCHETYPE_IDS.SCOUT,
        enemy: {
          intent: {
            type: INTENT_TYPES.ATTACK,
            value: 10,
          },
        },
      };
      expect(validateEncounterIntegrity(validEncounter).valid).toBe(true);
    });

    test('rejects unknown archetypeId safely', () => {
      const corrupted = {
        archetypeId: 'UNKNOWN_MONSTER',
        enemy: {
          intent: { type: INTENT_TYPES.ATTACK, value: 10 },
        },
      };
      const res = validateEncounterIntegrity(corrupted);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toMatch(/Unknown or missing archetypeId/);
    });

    test('rejects invalid intent type or negative value safely', () => {
      const invalidType = {
        archetypeId: ARCHETYPE_IDS.BRUTE,
        enemy: {
          intent: { type: 'METEOR_SWARM', value: 10 },
        },
      };
      expect(validateEncounterIntegrity(invalidType).valid).toBe(false);

      const invalidValue = {
        archetypeId: ARCHETYPE_IDS.SENTINEL,
        enemy: {
          intent: { type: INTENT_TYPES.GUARD, value: -5 },
        },
      };
      expect(validateEncounterIntegrity(invalidValue).valid).toBe(false);
    });
  });

  describe('4. Combat Intent Actions & Turn Resolution Order', () => {
    const mockQ1 = {
      questionId: 'q_test_1',
      token: 'tok_test_1',
      word: 'bastion',
      choices: [{ id: 'c1', text: '堡壘' }, { id: 'c2', text: '懦弱' }],
      correctChoiceId: 'c1',
    };
    const mockQ2 = {
      questionId: 'q_test_2',
      token: 'tok_test_2',
      word: 'resolve',
      choices: [{ id: 'c1', text: '決心' }],
      correctChoiceId: 'c1',
    };

    test('current intent is visible and established before answer is submitted', () => {
      const encounter = createEncounter({
        nodeId: 'node-test-1',
        archetypeId: ARCHETYPE_IDS.SENTINEL,
        customQuestion: mockQ1,
      });

      expect(encounter.enemy.intent).toBeDefined();
      expect(encounter.enemy.intent.type).toBe(INTENT_TYPES.ATTACK);
      expect(encounter.enemy.intent.value).toBe(10);
      expect(encounter.turn).toBe(1);
    });

    test('GUARD intent mitigates incoming player damage and enemy deals no attack damage', () => {
      // Sentinel turn 2 has GUARD intent (mitigation: 10)
      const enc = createEncounter({
        nodeId: 'node-sentinel-guard',
        archetypeId: ARCHETYPE_IDS.SENTINEL,
        customQuestion: mockQ1,
      });

      // Advance to turn 2 where Sentinel's intent is GUARD
      const t1Result = chooseAttackAndResolve(
        enc,
        { choiceId: 'c1', token: 'tok_test_1' },
        { nextQuestion: mockQ2 }
      );
      const turn2Enc = t1Result.encounter;
      expect(turn2Enc.turn).toBe(2);
      expect(turn2Enc.enemy.intent).toEqual({ type: INTENT_TYPES.GUARD, value: 10 });

      // Player answers correctly on guard turn (Normal 25 damage mitigated by 10 -> 15 damage)
      const mockQ3 = {
        questionId: 'q_test_3',
        token: 'tok_test_3',
        word: 'fortitude',
        choices: [{ id: 'c1', text: '剛毅' }],
        correctChoiceId: 'c1',
      };
      const initialEnemyHp = turn2Enc.enemy.hp; // 150 - 25 = 125
      const initialPlayerHp = turn2Enc.player.hp; // 100 - 10 = 90

      const guardTurnResult = chooseAttackAndResolve(
        turn2Enc,
        { choiceId: 'c1', token: 'tok_test_2' },
        { nextQuestion: mockQ3 }
      );
      expect(guardTurnResult.resolved).toBe(true);
      const turn3Enc = guardTurnResult.encounter;

      // Enemy takes only 15 damage: 125 - 15 = 110
      expect(turn3Enc.enemy.hp).toBe(initialEnemyHp - 15);
      // Enemy dealt 0 damage because it was guarding: Player HP remains 90!
      expect(turn3Enc.player.hp).toBe(initialPlayerHp);

      // Guard mitigation expires on turn 3! Next turn intent is ATTACK
      expect(turn3Enc.turn).toBe(3);
      expect(turn3Enc.enemy.intent.type).toBe(INTENT_TYPES.ATTACK);
    });

    test('GUARD intent with wrong answer deals 0 to enemy and 0 to player', () => {
      const enc = createEncounter({
        nodeId: 'node-sentinel-wrong',
        archetypeId: ARCHETYPE_IDS.SENTINEL,
        customQuestion: mockQ1,
      });

      // Advance to turn 2 (GUARD)
      const t1Result = chooseAttackAndResolve(
        enc,
        { choiceId: 'c1', token: 'tok_test_1' },
        { nextQuestion: mockQ2 }
      );
      const turn2Enc = t1Result.encounter;
      expect(turn2Enc.enemy.intent.type).toBe(INTENT_TYPES.GUARD);

      const beforeEnemyHp = turn2Enc.enemy.hp;
      const beforePlayerHp = turn2Enc.player.hp;

      // Player answers incorrectly ('c2')
      const mockQ3 = { questionId: 'q3', token: 'tok3', word: 'w3', choices: [{ id: 'c1' }], correctChoiceId: 'c1' };
      const res = chooseAttackAndResolve(
        turn2Enc,
        { choiceId: 'c2', token: 'tok_test_2' },
        { nextQuestion: mockQ3 }
      );
      expect(res.resolved).toBe(true);

      // Enemy takes 0 damage
      expect(res.encounter.enemy.hp).toBe(beforeEnemyHp);
      // Enemy performs no attack during GUARD
      expect(res.encounter.player.hp).toBe(beforePlayerHp);
    });

    test('HEAVY_ATTACK deals increased heavy damage when enemy survives', () => {
      // BRUTE turn 2 is HEAVY_ATTACK (value: 22)
      const bruteEnc = createEncounter({
        nodeId: 'node-brute-heavy',
        archetypeId: ARCHETYPE_IDS.BRUTE,
        playerHp: 100,
        customQuestion: mockQ1,
      });

      // Turn 1: BRUTE ATTACK (8)
      const t1 = chooseAttackAndResolve(
        bruteEnc,
        { choiceId: 'c2', token: 'tok_test_1' }, // wrong answer
        { nextQuestion: mockQ2 }
      );
      const t2Enc = t1.encounter;
      expect(t2Enc.player.hp).toBe(92);
      expect(t2Enc.enemy.intent).toEqual({ type: INTENT_TYPES.HEAVY_ATTACK, value: 20 });

      // Turn 2: player answers wrong again, enemy executes HEAVY_ATTACK (20 damage)
      const mockQ3 = { questionId: 'q3', token: 'tok3', word: 'w3', choices: [{ id: 'c1' }], correctChoiceId: 'c1' };
      const t2 = chooseAttackAndResolve(
        t2Enc,
        { choiceId: 'c2', token: 'tok_test_2' },
        { nextQuestion: mockQ3 }
      );
      expect(t2.resolved).toBe(true);
      // Player HP: 92 - 20 = 72
      expect(t2.encounter.player.hp).toBe(72);
    });

    test('lethal player hit cancels HEAVY_ATTACK immediately', () => {
      let enc = createEncounter({
        nodeId: 'node-brute-lethal',
        archetypeId: ARCHETYPE_IDS.BRUTE,
        playerHp: 100,
        customQuestion: mockQ1,
      });

      // Turn 1 (Intent: ATTACK 8): Player ATTACK -> Brute HP: 75, Player HP: 92
      let res = chooseAttackAndResolve(enc, { choiceId: enc.question.correctChoiceId, token: enc.question.token });
      enc = res.encounter;

      // Turn 2 (Intent: HEAVY_ATTACK 20): Player GUARD (20 block) -> Brute HP: 75, Player blocks 20 (HP: 92)
      res = chooseGuardAndResolve(enc, { choiceId: enc.question.correctChoiceId, token: enc.question.token });
      enc = res.encounter;

      // Turn 3 (Intent: ATTACK 8): Player ATTACK -> Brute HP: 50, Player takes 8 (92 -> 84)
      res = chooseAttackAndResolve(enc, { choiceId: enc.question.correctChoiceId, token: enc.question.token });
      enc = res.encounter;

      // Turn 4 (Intent: HEAVY_ATTACK 20): Player GUARD (20 block) -> Brute HP: 50, Player blocks 20 (HP: 84)
      res = chooseGuardAndResolve(enc, { choiceId: enc.question.correctChoiceId, token: enc.question.token });
      enc = res.encounter;

      // Turn 5 (Intent: ATTACK 8): Player ATTACK -> Brute HP: 25, Player takes 8 (84 -> 76)
      res = chooseAttackAndResolve(enc, { choiceId: enc.question.correctChoiceId, token: enc.question.token });
      enc = res.encounter;

      // Turn 6 (Intent: HEAVY_ATTACK 20): Brute HP is 25!
      expect(enc.enemy.hp).toBe(25);
      expect(enc.enemy.intent.type).toBe(INTENT_TYPES.HEAVY_ATTACK);
      const playerHpBeforeLethal = enc.player.hp;

      // Player lands lethal blow (deals 25 damage: 25 -> 0)
      res = chooseAttackAndResolve(enc, { choiceId: enc.question.correctChoiceId, token: enc.question.token });
      expect(res.encounter.status).toBe(ENCOUNTER_STATUS.VICTORY);
      expect(res.encounter.enemy.hp).toBe(0);
      // Heavy attack was cancelled by lethal hit! Player took NO damage from HEAVY_ATTACK
      expect(res.encounter.player.hp).toBe(playerHpBeforeLethal);
    });

    test('duplicate question submission does not re-execute intent or damage twice', () => {
      const scoutEnc = createEncounter({
        nodeId: 'node-idemp',
        archetypeId: ARCHETYPE_IDS.SCOUT,
        customQuestion: mockQ1,
      });

      const firstRes = chooseAttackAndResolve(scoutEnc, { choiceId: 'c1', token: 'tok_test_1' });
      expect(firstRes.resolved).toBe(true);

      // Try resubmitting same token
      const dupRes = chooseAttackAndResolve(firstRes.encounter, { choiceId: 'c1', token: 'tok_test_1' });
      expect(dupRes.resolved).toBe(false);
      expect(dupRes.reason).toBe('TOKEN_MISMATCH');
      expect(dupRes.encounter.enemy.hp).toBe(firstRes.encounter.enemy.hp);
      expect(dupRes.encounter.player.hp).toBe(firstRes.encounter.player.hp);
    });
  });
});
