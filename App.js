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
import JoinRoomScreen from './src/screens/JoinRoomScreen';
import WaitingRoomScreen from './src/screens/WaitingRoomScreen';
import PvpBattleScreen from './src/screens/PvpBattleScreen';
import PvpResultScreen from './src/screens/PvpResultScreen';
import { AuthProvider } from './src/context/AuthContext';
import { OnlineProvider } from './src/context/OnlineContext';
import { PvpRoomProvider } from './src/context/PvpRoomContext';
import { initI18n } from './src/localization/i18n';
import { StatusBar } from 'expo-status-bar';

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
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1E3A8A' }}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
          <OnlineProvider>
            <PvpRoomProvider>
              <NavigationContainer>
                <Stack.Navigator screenOptions={{ headerShown: false }}>
                  <Stack.Screen name="MainTabs" component={MainTabs} />
                  <Stack.Screen name="StagePreview" component={StagePreviewScreen} />
                  <Stack.Screen name="Battle" component={BattleScreen} />
                  <Stack.Screen name="BattleResult" component={BattleResultScreen} />
                  <Stack.Screen name="MistakeReview" component={MistakeReviewScreen} />
                  <Stack.Screen name="JoinRoom" component={JoinRoomScreen} />
                  <Stack.Screen name="WaitingRoom" component={WaitingRoomScreen} />
                  <Stack.Screen name="PvpBattle" component={PvpBattleScreen} />
                  <Stack.Screen name="PvpResult" component={PvpResultScreen} />
                </Stack.Navigator>
              </NavigationContainer>
            </PvpRoomProvider>
          </OnlineProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
