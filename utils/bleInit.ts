/**
 * utils/bleInit.ts
 * 
 * This utility function initializes BLE by waiting for native modules to be ready.
 * It introduces a delay based on the platform (Android or iOS).
 */

import { Platform } from 'react-native';

export const initializeBLE = async () => {
  // Wait for a short period to ensure native modules are ready.
  await new Promise(resolve => setTimeout(resolve, Platform.OS === 'android' ? 2000 : 1000));
};
