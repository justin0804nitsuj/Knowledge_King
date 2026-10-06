import { getPlayerLevelInfo } from '../src/domain/player/levelSystem';
import { XP_REWARDS } from '../src/domain/player/xpRewards';
import { getLocalDailyKey, DAILY_MISSIONS } from '../src/domain/player/dailySystem';
import { createDefaultPlayerProgress, recordDailyActivity } from '../src/storage/playerProgressStorage';
import { processBattleResult } from '../src/domain/game/resultProcessor';
import { createDefaultHistory, addBattleRecord } from '../src/storage/battleHistoryStorage';
import { createDefaultMistakes, recordMistakesFromBattle, processReviewResult, getActiveMistakes } from '../src/storage/mistakeStorage';
import { BATTLE_STATES } from '../src/domain/game/battleEngine';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getStageById } from '../src/domain/adventure/campaignConfig';

// Mock AsyncStorage
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
}));

describe('Player Progression Domain', () => {
  
  describe('Level System', () => {
    it('0 XP is Level 1', () => {
      const info = getPlayerLevelInfo(0);
      expect(info.level).toBe(1);
      expect(info.xpIntoCurrentLevel).toBe(0);
      expect(info.xpRequiredForNextLevel).toBe(100);
    });

    it('100 XP reaches Level 2', () => {
      const info = getPlayerLevelInfo(100);
      expect(info.level).toBe(2);
      expect(info.xpIntoCurrentLevel).toBe(0);
      expect(info.xpRequiredForNextLevel).toBe(150); // 100 + (2-1)*50
    });

    it('large XP grant crosses multiple levels', () => {
      // L1->L2 = 100
      // L2->L3 = 150 (Total 250)
      // L3->L4 = 200 (Total 450)
      // L4->L5 = 250 (Total 700)
      const info = getPlayerLevelInfo(500);
      expect(info.level).toBe(4);
      expect(info.xpIntoCurrentLevel).toBe(50);
      expect(info.xpRequiredForNextLevel).toBe(250);
    });
  });

  describe('Mistakes System', () => {
    it('wrong creates active record', async () => {
      let mistakes = createDefaultMistakes();
      mistakes = await recordMistakesFromBattle(mistakes, [], ['word1'], [], 1);
      
      const active = getActiveMistakes(mistakes);
      expect(active.length).toBe(1);
      expect(active[0].id).toBe('word1');
      expect(active[0].wrongCount).toBe(1);
    });

    it('timeout creates active record', async () => {
      let mistakes = createDefaultMistakes();
      mistakes = await recordMistakesFromBattle(mistakes, [], [], ['word2'], 1);
      
      const active = getActiveMistakes(mistakes);
      expect(active.length).toBe(1);
      expect(active[0].timeoutCount).toBe(1);
    });

    it('2 successful post-mistake reviews mark recovered', async () => {
      let mistakes = createDefaultMistakes();
      mistakes = await recordMistakesFromBattle(mistakes, [], ['word1'], [], 1);
      
      expect(getActiveMistakes(mistakes).length).toBe(1);
      
      mistakes = await processReviewResult(mistakes, 'word1', true);
      expect(getActiveMistakes(mistakes).length).toBe(1); // Not recovered yet
      
      mistakes = await processReviewResult(mistakes, 'word1', true);
      expect(getActiveMistakes(mistakes).length).toBe(0); // Recovered!
      expect(mistakes.records['word1'].isRecovered).toBe(true);
    });

    it('new later mistake makes it active again', async () => {
      let mistakes = createDefaultMistakes();
      mistakes = await recordMistakesFromBattle(mistakes, [], ['word1'], [], 1);
      mistakes = await processReviewResult(mistakes, 'word1', true);
      mistakes = await processReviewResult(mistakes, 'word1', true);
      
      // Now recovered
      expect(getActiveMistakes(mistakes).length).toBe(0);
      
      // Mistake again
      mistakes = await recordMistakesFromBattle(mistakes, [], ['word1'], [], 1);
      expect(getActiveMistakes(mistakes).length).toBe(1);
      expect(mistakes.records['word1'].isRecovered).toBe(false);
    });
  });

  describe('Battle History System', () => {
    it('capped at 100 and removes oldest', () => {
      let history = createDefaultHistory();
      
      // Add 105 records
      for (let i = 1; i <= 105; i++) {
        history = addBattleRecord(history, { id: i });
      }
      
      expect(history.records.length).toBe(100);
      // Newest (105) should be at index 0
      expect(history.records[0].id).toBe(105);
      // Oldest (6) should be at index 99
      expect(history.records[99].id).toBe(6);
    });
  });

  describe('Daily System & Streak', () => {
    it('first active day streak is 1', () => {
      let p = createDefaultPlayerProgress();
      p.daily.lastActiveDate = null; 
      
      p = recordDailyActivity(p);
      expect(p.daily.streak).toBe(1);
    });
  });
  
  describe('Result Processor Atomic Behavior & Idempotency', () => {
    let mockStorage = {};
    
    beforeEach(() => {
      mockStorage = {};
      AsyncStorage.getItem.mockImplementation(async (key) => mockStorage[key] || null);
      AsyncStorage.setItem.mockImplementation(async (key, value) => {
        mockStorage[key] = value;
      });
    });

    it('processing the same battleId twice does not grant duplicate XP or stats', async () => {
      const finalState = {
        status: BATTLE_STATES.VICTORY,
        correctCount: 4,
        wrongCount: 0,
        timeoutCount: 0,
        questionNumber: 4,
        maxCombo: 4,
        score: 100,
        correctTargetIds: [],
        wrongTargetIds: [],
        timeoutTargetIds: []
      };

      const res1 = await processBattleResult('battle_123', finalState, 'L1-S1');
      expect(res1.xpEarned).toBeGreaterThan(0);
      
      const pAfterFirst = JSON.parse(mockStorage['@KnowledgeKing:playerProgress']);
      const xpAfterFirst = pAfterFirst.totalXp;
      
      // Simulate app restart / remount calling the exact same event
      const res2 = await processBattleResult('battle_123', finalState, 'L1-S1');
      // Returns summary safely
      expect(res2.xpEarned).toBe(res1.xpEarned); 
      
      const pAfterSecond = JSON.parse(mockStorage['@KnowledgeKing:playerProgress']);
      // But XP should not be duplicated
      expect(pAfterSecond.totalXp).toBe(xpAfterFirst);
      
      // History should only have 1 record
      const hAfterSecond = JSON.parse(mockStorage['@KnowledgeKing:battleHistory']);
      expect(hAfterSecond.records.length).toBe(1);
    });

    it('processing the same review answer twice does not duplicate XP', async () => {
      // Setup some mistakes
      const { recordMistakesFromBattle } = require('../src/storage/mistakeStorage');
      const { processReviewAnswer } = require('../src/domain/game/reviewProcessor');

      let mistakes = require('../src/storage/mistakeStorage').createDefaultMistakes();
      mistakes = await recordMistakesFromBattle(mistakes, [], ['word1'], [], 1);
      mockStorage['@KnowledgeKing:mistakes'] = JSON.stringify(mistakes);

      const res1 = await processReviewAnswer('review_1', 'word1', true);
      expect(res1.xpEarned).toBeGreaterThan(0);

      const pAfterFirst = JSON.parse(mockStorage['@KnowledgeKing:playerProgress']);
      const xpAfterFirst = pAfterFirst.totalXp;

      const res2 = await processReviewAnswer('review_1', 'word1', true);
      // It returns 0 XP on duplicate processing
      expect(res2.xpEarned).toBe(0);

      const pAfterSecond = JSON.parse(mockStorage['@KnowledgeKing:playerProgress']);
      expect(pAfterSecond.totalXp).toBe(xpAfterFirst);
    });

    it('partial failure recovers cleanly and does not duplicate state', async () => {
      const finalState = {
        status: BATTLE_STATES.VICTORY,
        correctCount: 4,
        wrongCount: 1,
        timeoutCount: 0,
        questionNumber: 5,
        maxCombo: 4,
        score: 100,
        correctTargetIds: [],
        wrongTargetIds: ['word-wrong'],
        timeoutTargetIds: []
      };

      // Force failure on mistake storage
      let callCount = 0;
      const originalSetItem = AsyncStorage.setItem;
      AsyncStorage.setItem.mockImplementation(async (key, value) => {
        if (key === '@KnowledgeKing:mistakes') {
          callCount++;
          if (callCount === 1) {
            throw new Error('Injected network/storage failure');
          }
        }
        mockStorage[key] = value;
      });

      // 1. Initial process throws partway
      await expect(processBattleResult('battle_partial', finalState, 'L1-S1'))
        .rejects
        .toThrow('Injected network/storage failure');

      const pAfterFail = JSON.parse(mockStorage['@KnowledgeKing:playerProgress']);
      const xpAfterFail = pAfterFail.totalXp;
      expect(xpAfterFail).toBeGreaterThan(0); // XP succeeded

      const mAfterFail = mockStorage['@KnowledgeKing:mistakes'];
      expect(mAfterFail).toBeUndefined(); // Mistake failed

      const hAfterFail = mockStorage['@KnowledgeKing:battleHistory'];
      expect(hAfterFail).toBeUndefined(); // History failed because mistake threw

      // 2. Retry exact same battle
      const res = await processBattleResult('battle_partial', finalState, 'L1-S1');
      expect(res.xpEarned).toBeGreaterThan(0);

      // Verify XP not duplicated
      const pAfterRetry = JSON.parse(mockStorage['@KnowledgeKing:playerProgress']);
      expect(pAfterRetry.totalXp).toBe(xpAfterFail);

      // Verify Mistake count correct
      const mAfterRetry = JSON.parse(mockStorage['@KnowledgeKing:mistakes']);
      expect(mAfterRetry.records['word-wrong'].wrongCount).toBe(1);

      // Verify history exactly once
      const hAfterRetry = JSON.parse(mockStorage['@KnowledgeKing:battleHistory']);
      expect(hAfterRetry.records.length).toBe(1);
    });
  });
});
