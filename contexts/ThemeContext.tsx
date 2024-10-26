// contexts/ThemeContext.tsx

import React, { createContext, useState, ReactNode } from 'react';
import { MD3Theme } from 'react-native-paper';
import { Themes } from '../themes';

type ThemeType = 'light' | 'grey' | 'dark';

interface ThemeContextProps {
  theme: MD3Theme;
  themeName: ThemeType;
  setThemeName: (name: ThemeType) => void;
}

export const ThemeContext = createContext<ThemeContextProps>({
  theme: Themes.light,
  themeName: 'light',
  setThemeName: () => {},
});

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [themeName, setThemeName] = useState<ThemeType>('light');

  return (
    <ThemeContext.Provider
      value={{
        theme: Themes[themeName],
        themeName,
        setThemeName,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};