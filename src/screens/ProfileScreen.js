import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { theme } from '../theme';
import { resetCampaignProgress } from '../storage/campaignStorage';

export default function ProfileScreen({ navigation }) {
  const handleReset = () => {
    Alert.alert(
      "Reset Adventure Progress",
      "Are you sure you want to completely wipe all campaign progress? This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Reset", 
          style: "destructive",
          onPress: async () => {
            await resetCampaignProgress();
            Alert.alert("Success", "Adventure progress has been reset.");
          }
        }
      ]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Profile</Text>
      
      <View style={styles.devSection}>
        <Text style={styles.devTitle}>Developer / Local Data</Text>
        <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
          <Text style={styles.resetBtnText}>Reset Adventure Progress</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.large,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: theme.colors.textMain,
    marginBottom: theme.spacing.large,
  },
  devSection: {
    backgroundColor: theme.colors.card,
    padding: theme.spacing.large,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.danger,
    marginTop: 'auto',
  },
  devTitle: {
    fontSize: 16,
    color: theme.colors.textMuted,
    marginBottom: theme.spacing.medium,
  },
  resetBtn: {
    backgroundColor: theme.colors.danger,
    padding: theme.spacing.medium,
    borderRadius: 8,
    alignItems: 'center',
  },
  resetBtnText: {
    color: '#fff',
    fontWeight: 'bold',
  }
});
