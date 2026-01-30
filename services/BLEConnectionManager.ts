/**
 * services/BLEConnectionManager.ts
 *
 * This file contains the BLEConnectionManager class which is responsible for scanning,
 * connecting, and disconnecting BLE devices. It uses the react-native-ble-plx library.
 */

import { BleManager, Device, State } from '@sfourdrinier/react-native-ble-plx';
import { EnhancedLogger } from './EnhancedLogger';
import { Platform, PermissionsAndroid } from 'react-native';

export class BLEConnectionManager {
  private bleManager: BleManager;
  private connectedDevice: Device | null = null;

  constructor() {
    this.bleManager = new BleManager();
    EnhancedLogger.debug('BLEConnectionManager', 'Initialized');
  }

  /**
   * Request Bluetooth permissions required for Android 12+ (API 31+)
   * Returns true if permissions are granted, false otherwise
   */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      // iOS permissions are handled via Info.plist
      return true;
    }

    if (Platform.OS === 'android') {
      const apiLevel = Platform.Version;
      EnhancedLogger.debug('BLEConnectionManager', 'Requesting permissions', { apiLevel });

      try {
        if (apiLevel >= 31) {
          // Android 12+ requires BLUETOOTH_SCAN and BLUETOOTH_CONNECT
          const result = await PermissionsAndroid.requestMultiple([
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]);

          const allGranted =
            result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
            result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
            result['android.permission.ACCESS_FINE_LOCATION'] === PermissionsAndroid.RESULTS.GRANTED;

          EnhancedLogger.debug('BLEConnectionManager', 'Permission results (Android 12+)', { result, allGranted });
          return allGranted;
        } else {
          // Android 11 and below require location permission for BLE scanning
          const result = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            {
              title: 'Location Permission',
              message: 'FrameInk needs location access to scan for Bluetooth devices.',
              buttonNeutral: 'Ask Me Later',
              buttonNegative: 'Cancel',
              buttonPositive: 'OK',
            }
          );

          const granted = result === PermissionsAndroid.RESULTS.GRANTED;
          EnhancedLogger.debug('BLEConnectionManager', 'Permission result (Android 11-)', { result, granted });
          return granted;
        }
      } catch (error) {
        EnhancedLogger.error('BLEConnectionManager', 'Permission request error', error as Error);
        return false;
      }
    }

    return true;
  }

  /**
   * Check if Bluetooth is powered on and ready
   */
  async waitForPoweredOn(timeout: number = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkState = async () => {
        const state = await this.bleManager.state();
        EnhancedLogger.debug('BLEConnectionManager', 'Bluetooth state', { state });

        if (state === State.PoweredOn) {
          resolve(true);
          return;
        }

        if (Date.now() - startTime > timeout) {
          EnhancedLogger.warn('BLEConnectionManager', 'Timeout waiting for Bluetooth to power on', { state });
          resolve(false);
          return;
        }

        // Check again in 100ms
        setTimeout(checkState, 100);
      };

      checkState();
    });
  }

  async scanForDevices(timeout: number = 5000): Promise<Device[]> {
    EnhancedLogger.debug('BLEConnectionManager', 'Starting device scan', { timeout });

    // Request permissions first
    const hasPermissions = await this.requestPermissions();
    if (!hasPermissions) {
      throw new Error('Bluetooth permissions not granted. Please enable Bluetooth permissions in Settings.');
    }

    // Wait for Bluetooth to be powered on
    const isPoweredOn = await this.waitForPoweredOn();
    if (!isPoweredOn) {
      throw new Error('Bluetooth is not enabled. Please turn on Bluetooth.');
    }

    return new Promise((resolve, reject) => {
      const devices: Device[] = [];
      this.bleManager.startDeviceScan(null, null, (error, device) => {
        if (error) {
          EnhancedLogger.error('BLEConnectionManager', 'Scan error', error);
          this.bleManager.stopDeviceScan();
          reject(error);
          return;
        }
        if (device && device.name && device.name.startsWith('FrameInk')) {
          EnhancedLogger.info('BLEConnectionManager', 'FrameInk device found', {
            id: device.id,
            name: device.name,
            rssi: device.rssi,
          });
          devices.push(device);
        }
      });
      setTimeout(() => {
        this.bleManager.stopDeviceScan();
        EnhancedLogger.debug('BLEConnectionManager', 'Scan completed', { devicesFound: devices.length });
        resolve(devices);
      }, timeout);
    });
  }

  async connectAndPrepare(device: Device): Promise<void> {
    EnhancedLogger.debug('BLEConnectionManager', 'Connecting to device', { deviceId: device.id });
    try {
      await device.connect();
      await device.discoverAllServicesAndCharacteristics();
      this.connectedDevice = device;
      EnhancedLogger.info('BLEConnectionManager', 'Connected to device', { deviceId: device.id });
    } catch (error) {
      EnhancedLogger.error('BLEConnectionManager', 'Connection error', error as Error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connectedDevice) {
      EnhancedLogger.debug('BLEConnectionManager', 'Disconnecting from device', { deviceId: this.connectedDevice.id });
      try {
        await this.connectedDevice.cancelConnection();
        EnhancedLogger.info('BLEConnectionManager', 'Disconnected from device', { deviceId: this.connectedDevice.id });
        this.connectedDevice = null;
      } catch (error) {
        EnhancedLogger.error('BLEConnectionManager', 'Disconnect error', error as Error);
        throw error;
      }
    }
  }

  getConnectedDevice(): Device | null {
    return this.connectedDevice;
  }

  isConnected(): boolean {
    return this.connectedDevice !== null;
  }

  async isDeviceConnected(): Promise<boolean> {
    if (!this.connectedDevice) return false;
    try {
      return await this.connectedDevice.isConnected();
    } catch (error) {
      EnhancedLogger.error('BLEConnectionManager', 'Error checking connection status', error as Error);
      return false;
    }
  }
}

// Export a shared instance so that all screens use the same connection manager.
export const sharedBLEConnectionManager = new BLEConnectionManager();
