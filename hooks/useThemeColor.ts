// hooks/useThemeColor.ts

import { useColorScheme } from 'react-native';
import { useTheme } from 'react-native-paper';

type ThemeColorProps = {
  light?: string;
  dark?: string;
};

/**
 * Hook to get theme-aware colors.
 * Can be called with props and colorName for Paper theme colors,
 * or without arguments for basic theme colors.
 */
export function useThemeColor(
  props?: ThemeColorProps,
  colorName?: string
): string {
  const theme = useTheme();
  const scheme = useColorScheme() ?? 'light';

  // If props provided with override colors, use them
  if (props) {
    const colorFromProps = props[scheme as 'light' | 'dark'];
    if (colorFromProps) {
      return colorFromProps;
    }
  }

  // Fall back to theme color if colorName provided
  if (colorName && colorName in theme.colors) {
    return (theme.colors as unknown as Record<string, string>)[colorName];
  }

  // Default fallback
  return scheme === 'dark' ? '#ffffff' : '#000000';
}

export default useThemeColor;
