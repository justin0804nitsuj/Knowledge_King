// src/components/pvp/PvpActiveEffectBadge.js
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../../theme';
/**
 * Active effect badge for local player (Shield / Power).
 * Props:
 *  - type: 'SHIELD' | 'POWER' (used for testID)
 *  - label: localized string to display
 *  - testID?: string for testing
 */
export default function PvpActiveEffectBadge({ type, label, testID }) {
  if (!type || !label) return null;
  const icon = type === 'SHIELD' ? '🛡' : type === 'POWER' ? '⚡' : '';
  return (
    <View style={styles.container} testID={testID} accessible accessibilityLabel={label}>
      <Text style={styles.text}>{icon} {label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: -30,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 10,
  },
  text: {
    backgroundColor: theme.colors.blackOverlay || 'rgba(0,0,0,0.5)',
    color: theme.colors.primary,
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
});
