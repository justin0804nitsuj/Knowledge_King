import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { createInitialState, nextQuestion } from '../domain/game/battleEngine';
import { getWordsByLevel } from '../domain/vocabulary/vocabularyRepository';

export default function PvpBattleScreen({ navigation }) {
  const { roomId, room, isHost } = usePvpRoom();
  const [phase, setPhase] = useState('LOADING_MATCH');
  const [gameState, setGameState] = useState(null);
  const [initError, setInitError] = useState(null);

  useEffect(() => {
    if (!room || !room.match) {
      setPhase('LOADING_MATCH');
      return;
    }
    
    try {
      const { battleSeed, level, matchId, rulesetVersion, vocabularyVersion, questionCount } = room.match;
      
      console.log('[PVP-BATTLE] mount');
      console.log('[PVP-BATTLE] roomCode', roomId);
      console.log('[PVP-BATTLE] matchId', matchId);
      console.log('[PVP-BATTLE] battleSeed', battleSeed);
      console.log('[PVP-BATTLE] rulesetVersion', rulesetVersion);
      console.log('[PVP-BATTLE] level/config', level, questionCount);

      if (!battleSeed || level === undefined || !matchId || !rulesetVersion || !vocabularyVersion || !questionCount) {
        throw new Error("Malformed or incomplete match config");
      }
      
      setPhase('LOADING_VOCABULARY');
      const seed = parseInt(battleSeed, 10) || Date.now();
      const words = getWordsByLevel(level); 
      
      console.log('[PVP-BATTLE] vocabulary ready, count:', words ? words.length : 0);

      if (!words || words.length === 0) {
        throw new Error(`Empty vocabulary pool for level ${level}`);
      }
      
      setPhase('GENERATING_QUESTIONS');
      const config = {
        playerHp: 3,
        enemyHp: 3,
        timePerQuestionMs: 10000
      };

      let state = createInitialState(seed, level, words, config);
      state = nextQuestion(state);
      
      if (!state.currentQuestion) {
        throw new Error("Failed to generate first question");
      }

      console.log('[PVP-BATTLE] currentIndex', 0);
      console.log('[PVP-BATTLE] currentQuestion exists', !!state.currentQuestion);
      console.log('[PVP-BATTLE] first question target ID', state.currentQuestion.targetId);

      // Validate question structure
      const q = state.currentQuestion;
      if (!q.targetId || !q.word || !q.choices || q.choices.length !== 4 || !q.correctChoiceId) {
        throw new Error("Generated question violates invariant schema");
      }

      setGameState(state);
      setPhase('READY');
    } catch (e) {
      console.error('[PVP-BATTLE] Initialization failed:', e.message);
      setInitError(e.message);
      setPhase('ERROR');
    }
  }, [room?.match?.matchId]);

  if (phase === 'ERROR') {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Battle Error</Text>
        <Text style={styles.value}>{initError}</Text>
      </View>
    );
  }

  if (phase !== 'READY' || !gameState) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>
          {phase === 'LOADING_MATCH' ? 'Loading Match...' : 
           phase === 'LOADING_VOCABULARY' ? 'Loading Vocabulary...' : 
           'Generating Questions...'}
        </Text>
      </View>
    );
  }

  const hostUid = room.meta?.hostUid;
  const guestUid = Object.keys(room.players || {}).find(uid => uid !== hostUid);
  
  const myPlayer = isHost ? room.players[hostUid] : room.players[guestUid];
  const opponentPlayer = isHost ? room.players[guestUid] : room.players[hostUid];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>PvP Battle Phase 8B</Text>
      
      <View style={styles.card}>
        <Text style={styles.label}>Room Code</Text>
        <Text style={styles.value}>{roomId}</Text>
        
        <Text style={styles.label}>Match ID</Text>
        <Text style={styles.value}>{room.match.matchId}</Text>
        
        <Text style={styles.label}>Battle Seed</Text>
        <Text style={styles.value}>{room.match.battleSeed}</Text>
        
        <Text style={styles.label}>Ruleset Version</Text>
        <Text style={styles.value}>{room.match.rulesetVersion}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Me: {myPlayer?.displayName}</Text>
        <Text style={styles.label}>Opponent: {opponentPlayer?.displayName}</Text>
      </View>

      {gameState && gameState.currentQuestion && (
        <View style={styles.card}>
          <Text style={styles.label}>Question {gameState.questionNumber}</Text>
          <Text style={styles.questionText}>{gameState.currentQuestion.word}</Text>
          {gameState.currentQuestion.choices.map((choice, idx) => (
            <Text key={idx} style={styles.choiceText}>
              {idx + 1}. {choice.text} {choice.id === gameState.currentQuestion.correctChoiceId ? '(Correct)' : ''}
            </Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.large,
    backgroundColor: theme.colors.background,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginTop: 40,
    marginBottom: 20,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  label: {
    fontSize: 14,
    color: theme.colors.textMuted,
    marginBottom: 4,
    fontWeight: 'bold',
  },
  value: {
    fontSize: 16,
    color: theme.colors.textMain,
    marginBottom: 12,
  },
  questionText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: theme.colors.primary,
    marginBottom: 12,
  },
  choiceText: {
    fontSize: 16,
    color: theme.colors.textMain,
    marginBottom: 8,
  }
});
