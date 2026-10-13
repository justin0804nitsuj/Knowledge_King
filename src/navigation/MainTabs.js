import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import HomeScreen from '../screens/HomeScreen';
import AdventureScreen from '../screens/AdventureScreen';
import ArenaScreen from '../screens/ArenaScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  const { t } = useTranslation();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          if (route.name === 'Home') {
            iconName = focused ? 'home' : 'home-outline';
          } else if (route.name === 'Adventure') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'Arena') {
            iconName = focused ? 'trophy' : 'trophy-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'person' : 'person-outline';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: t('navigation.home') }} />
      <Tab.Screen name="Adventure" component={AdventureScreen} options={{ title: t('navigation.adventure') }} />
      <Tab.Screen name="Arena" component={ArenaScreen} options={{ title: t('navigation.arena') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: t('navigation.profile') }} />
    </Tab.Navigator>
  );
}
