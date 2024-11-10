// utils/bleInit.ts
import { Platform } from 'react-native';

export const initializeBLE = async () => {
  // Wait for native modules to be ready
  await new Promise(resolve => setTimeout(resolve, Platform.OS === 'android' ? 2000 : 1000));
};