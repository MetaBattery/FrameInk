/**
 * services/BLEConnectionManager.ts
 * 
 * This file contains the BLEConnectionManager class which is responsible for scanning,
 * connecting, and disconnecting BLE devices. It uses the react-native-ble-plx library.
 */

import { BleManager, Device } from 'react-native-ble-plx';
import { EnhancedLogger } from './EnhancedLogger';

export class BLEConnectionManager {
  private bleManager: BleManager;
  private connectedDevice: Device | null = null;

  constructor() {
    this.bleManager = new BleManager();
    EnhancedLogger.debug('BLEConnectionManager', 'Initialized');
  }

  async scanForDevices(timeout: number = 5000): Promise<Device[]> {
    EnhancedLogger.debug('BLEConnectionManager', 'Starting device scan', { timeout });
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
      EnhancedLogger.error('BLEConnectionManager', 'Connection error', error);
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
        EnhancedLogger.error('BLEConnectionManager', 'Disconnect error', error);
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
      EnhancedLogger.error('BLEConnectionManager', 'Error checking connection status', error);
      return false;
    }
  }
}

// Export a shared instance so that all screens use the same connection manager.
export const sharedBLEConnectionManager = new BLEConnectionManager();
