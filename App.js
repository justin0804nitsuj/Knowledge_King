import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MainTabs from './src/navigation/MainTabs';
import BattleScreen from './src/screens/BattleScreen';
import BattleResultScreen from './src/screens/BattleResultScreen';
import StagePreviewScreen from './src/screens/StagePreviewScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={MainTabs} />
          <Stack.Screen name="StagePreview" component={StagePreviewScreen} />
          <Stack.Screen name="Battle" component={BattleScreen} />
          <Stack.Screen name="BattleResult" component={BattleResultScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
