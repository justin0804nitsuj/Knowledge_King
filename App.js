import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MainTabs from './src/navigation/MainTabs';
import BattleScreen from './src/screens/BattleScreen';
import BattleResultScreen from './src/screens/BattleResultScreen';
import StagePreviewScreen from './src/screens/StagePreviewScreen';
import MistakeReviewScreen from './src/screens/MistakeReviewScreen';
import { AuthProvider } from './src/context/AuthContext';
import { initI18n } from './src/localization/i18n';

const Stack = createNativeStackNavigator();

export default function App() {
  const [i18nLoaded, setI18nLoaded] = useState(false);

  useEffect(() => {
    initI18n().then(() => {
      setI18nLoaded(true);
    });
  }, []);

  if (!i18nLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="StagePreview" component={StagePreviewScreen} />
            <Stack.Screen name="Battle" component={BattleScreen} />
            <Stack.Screen name="BattleResult" component={BattleResultScreen} />
            <Stack.Screen name="MistakeReview" component={MistakeReviewScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
