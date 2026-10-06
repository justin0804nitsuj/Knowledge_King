import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { theme } from '../theme';

export default function AdventureScreen({ navigation }) {
  const levels = [1, 2, 3, 4, 5, 6];

  const handleSelectLevel = (level) => {
    navigation.navigate('Battle', { level });
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Offline Gatekeeper Battle Mode</Text>
      <Text style={styles.subtitle}>Select a level to begin (All levels unlocked for testing)</Text>
      
      <View style={styles.levelContainer}>
        {levels.map(level => (
          <TouchableOpacity 
            key={level} 
            style={styles.levelBtn}
            onPress={() => handleSelectLevel(level)}
          >
            <Text style={styles.levelBtnText}>Level {level}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: theme.colors.background,
    padding: theme.spacing.medium,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    textAlign: 'center',
    marginTop: theme.spacing.large,
    marginBottom: theme.spacing.small,
  },
  subtitle: {
    fontSize: 16,
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginBottom: theme.spacing.large,
  },
  levelContainer: {
    alignItems: 'center',
  },
  levelBtn: {
    backgroundColor: theme.colors.primary,
    padding: theme.spacing.medium,
    borderRadius: 8,
    width: '80%',
    alignItems: 'center',
    marginBottom: theme.spacing.medium,
  },
  levelBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  }
});
