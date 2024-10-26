// app/_layout.tsx

import { Stack } from 'expo-router';
import { PaperProvider } from 'react-native-paper';
import { ThemeProvider, ThemeContext } from '../contexts/ThemeContext';
import React, { useContext } from 'react';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Main />
    </ThemeProvider>
  );
}

function Main() {
  const { theme } = useContext(ThemeContext);

  return (
    <PaperProvider theme={theme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </PaperProvider>
  );
}