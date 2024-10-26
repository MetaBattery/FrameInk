import { useColorScheme } from 'react-native';

export default function useThemeColor() {
  const theme = useColorScheme();
  
  const colors = {
    light: {
      primary: '#2196F3',
      background: '#f5f5f5',
      text: '#000000',
      surface: '#ffffff',
    },
    dark: {
      primary: '#64B5F6',
      background: '#121212',
      text: '#ffffff',
      surface: '#1E1E1E',
    },
  };

  return theme === 'dark' ? colors.dark : colors.light;
}