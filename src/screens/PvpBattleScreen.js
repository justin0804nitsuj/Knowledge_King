import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { usePvpRoom } from '../context/PvpRoomContext';
import { theme } from '../theme';
import { createInitialState, nextQuestion } from '../domain/game/battleEngine';
import { getWordsByLevel } from '../domain/vocabulary/vocabularyRepository';

export default function PvpBattleScreen({ navigation }) {
  const { roomId, room, isHost } = usePvpRoom();
  const [gameState, setGameState] = useState(null);

  useEffect(() => {
    if (!room || !room.match) return;
    
    const { battleSeed, level, matchId, rulesetVersion, vocabularyVersion, questionCount } = room.match;
    if (!battleSeed || !level || !matchId || !rulesetVersion || !vocabularyVersion || !questionCount) {
      console.warn("Malformed match config");
      return;
    }
    
    // We only want to generate this once per match
    const seed = parseInt(battleSeed, 10) || Date.now();
    const words = getWordsByLevel(level); 
    
    const config = {
      playerHp: 3,
      enemyHp: 3,
      timePerQuestionMs: 10000
    };

    let state = createInitialState(seed, level, words, config);
    state = nextQuestion(state);
    
    setGameState(state);
  }, [room?.match?.matchId]);

  if (!room || !room.match) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Loading Match...</Text>
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
          <Text style={styles.questionText}>{gameState.currentQuestion.targetWord.word}</Text>
          {gameState.currentQuestion.choices.map((choice, idx) => (
            <Text key={idx} style={styles.choiceText}>
              {idx + 1}. {choice.translation} {choice.id === gameState.currentQuestion.targetWord.id ? '(Correct)' : ''}
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
