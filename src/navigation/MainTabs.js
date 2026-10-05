import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import HomeScreen from '../screens/HomeScreen';
import AdventureScreen from '../screens/AdventureScreen';
import ArenaScreen from '../screens/ArenaScreen';
import ProfileScreen from '../screens/ProfileScreen';

const Tab = createBottomTabNavigator();

export default function MainTabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: true }}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Adventure" component={AdventureScreen} />
      <Tab.Screen name="Arena" component={ArenaScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
