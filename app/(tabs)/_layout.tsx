// app/(tabs)/_layout.tsx

import { Tabs } from 'expo-router';
import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false, // Remove the top header
        tabBarShowLabel: false, // Hide labels under icons
      }}
    >
      <Tabs.Screen
        name="index" // Matches app/(tabs)/index.tsx
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="home" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="library" // Matches app/(tabs)/library.tsx
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="image" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings" // Matches app/(tabs)/settings.tsx
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="cog" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}