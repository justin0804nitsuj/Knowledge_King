import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function AdventureScreen() {
  return (
    <View style={styles.container}>
      <Text>Adventure Screen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' }
});
