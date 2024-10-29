// app/_layout.tsx

import { Slot } from 'expo-router';
import React from 'react';
import { PaperProvider } from 'react-native-paper';
import { ThemeProvider, ThemeContext } from '../contexts/ThemeContext';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <MainLayout />
    </ThemeProvider>
  );
}

function MainLayout() {
  const { theme } = React.useContext(ThemeContext);

  return (
    <PaperProvider theme={theme}>
      <Slot />
    </PaperProvider>
  );
}