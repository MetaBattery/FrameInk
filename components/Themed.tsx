// components/Themed.tsx

import { Text as DefaultText, View as DefaultView, useColorScheme } from 'react-native';
import { MD3Theme, useTheme } from 'react-native-paper';
import React from 'react';

export function useThemeColor(
  props: { light?: string; dark?: string },
  colorName: keyof MD3Theme['colors']
) {
  const theme = useTheme();
  const scheme = useColorScheme() || 'light';
  const colorFromProps = props[scheme];

  if (colorFromProps) {
    return colorFromProps;
  } else {
    return theme.colors[colorName];
  }
}

type ThemeProps = {
  lightColor?: string;
  darkColor?: string;
};

type TextProps = ThemeProps & DefaultText['props'];
type ViewProps = ThemeProps & DefaultView['props'];

export function ThemedText(props: TextProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return <DefaultText style={[{ color }, style]} {...otherProps} />;
}

export function ThemedView(props: ViewProps) {
  const { style, lightColor, darkColor, ...otherProps } = props;
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  return <DefaultView style={[{ backgroundColor }, style]} {...otherProps} />;
}