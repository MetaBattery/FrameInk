// themes.ts

import { MD3LightTheme as DefaultTheme, MD3DarkTheme } from 'react-native-paper';

export const Themes = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: '#ffffff',
      primary: '#2196F3', // Blue buttons
      surface: '#ffffff',
      text: '#000000',
    },
  },
  grey: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: '#808080',
      primary: '#FFD700', // Yellow buttons
      surface: '#808080',
      text: '#000000',
    },
  },
  dark: {
    ...MD3DarkTheme,
    colors: {
      ...MD3DarkTheme.colors,
      background: '#000000',
      primary: '#006400', // Dark green buttons
      surface: '#000000',
      text: '#ffffff',
    },
  },
};