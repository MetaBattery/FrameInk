// services/bleManager.ts

import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import { logger } from './logger';

class BLEManager {
  manager: BleManager;
  private device: Device | null = null;
  private readonly SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  private readonly FILE_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  private readonly COMMAND_CHAR_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
  private readonly CHUNK_SIZE = 512;
  private isInitialized = false;

  constructor() {
    this.manager = new BleManager();
    logger.debug('BLEManager', 'Created new instance');
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      if (Platform.OS === 'android') {
        await this.requestAndroidPermissions();
      }

      // Wait for BLE to be powered on
      const state = await this.manager.state();
      if (state !== State.PoweredOn) {
        await new Promise<void>((resolve) => {
          this.manager.onStateChange((state) => {
            if (state === State.PoweredOn) {
              resolve();
              this.manager.stopStateNotifications();
            }
          }, true);
        });
      }

      this.isInitialized = true;
      logger.debug('BLEManager', 'Initialization complete');
      return true;
    } catch (error) {
      logger.error('BLEManager', 'Initialization failed', error);
      return false;
    }
  }

  private async requestAndroidPermissions(): Promise<void> {
    if (Platform.OS === 'android' && Platform.Version >= 23) {
      logger.debug('BLEManager', 'Requesting Android permissions');
      
      try {
        const grants = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);

        const allGranted = Object.values(grants).every(
          (permission) => permission === PermissionsAndroid.RESULTS.GRANTED
        );

        if (!allGranted) {
          throw new Error('Required permissions not granted');
        }

        logger.debug('BLEManager', 'Android permissions granted');
      } catch (error) {
        logger.error('BLEManager', 'Permission request failed', error);
        throw new Error('Failed to get required permissions');
      }
    }
  }

  async scanForDevices(): Promise<Device[]> {
    if (!this.isInitialized) {
      throw new Error('BLE Manager not initialized');
    }

    logger.debug('BLEManager', 'Starting device scan');
    const devices: Device[] = [];

    return new Promise((resolve, reject) => {
      try {
        this.manager.startDeviceScan(
          [this.SERVICE_UUID],
          { allowDuplicates: false },
          (error, device) => {
            if (error) {
              logger.error('BLEManager', 'Scan error', error);
              this.manager.stopDeviceScan();
              reject(error);
              return;
            }

            if (device && device.name === 'FrameInk47') {
              logger.debug('BLEManager', 'Found device', {
                name: device.name,
                id: device.id,
              });
              devices.push(device);
            }
          }
        );

        // Stop scanning after 5 seconds
        setTimeout(() => {
          this.manager.stopDeviceScan();
          logger.debug('BLEManager', 'Scan complete', { deviceCount: devices.length });
          resolve(devices);
        }, 5000);
      } catch (error) {
        logger.error('BLEManager', 'Scan failed', error);
        reject(error);
      }
    });
  }

  async connectToDevice(device: Device): Promise<void> {
    if (!this.isInitialized) {
      throw new Error('BLE Manager not initialized');
    }

    try {
      logger.debug('BLEManager', 'Connecting to device', { deviceId: device.id });
      const connectedDevice = await device.connect();
      logger.debug('BLEManager', 'Connected, discovering services');
      
      await connectedDevice.discoverAllServicesAndCharacteristics();
      this.device = connectedDevice;
      
      logger.debug('BLEManager', 'Device setup complete');
    } catch (error) {
      logger.error('BLEManager', 'Connection failed', error);
      throw new Error('Failed to connect to device');
    }
  }

  async listFiles(): Promise<string[]> {
    if (!this.isInitialized || !this.device) {
      throw new Error('No device connected');
    }

    try {
      logger.debug('BLEManager', 'Requesting file list');
      
      await this.device.writeCharacteristicWithResponseForService(
        this.SERVICE_UUID,
        this.COMMAND_CHAR_UUID,
        Buffer.from('LIST').toString('base64')
      );

      const response = await this.device.readCharacteristicForService(
        this.SERVICE_UUID,
        this.FILE_CHAR_UUID
      );

      if (response && response.value) {
        const decodedResponse = Buffer.from(response.value, 'base64').toString();
        const files = decodedResponse.split(';').filter(item => item.length > 0);
        logger.debug('BLEManager', 'File list received', { fileCount: files.length });
        return files;
      }

      logger.debug('BLEManager', 'No files found');
      return [];
    } catch (error) {
      logger.error('BLEManager', 'List files failed', error);
      throw new Error('Failed to list files');
    }
  }

  async deleteFile(filename: string): Promise<boolean> {
    if (!this.isInitialized || !this.device) {
      throw new Error('No device connected');
    }

    try {
      logger.debug('BLEManager', 'Deleting file', { filename });
      
      const command = `DELETE:${filename}`;
      await this.device.writeCharacteristicWithResponseForService(
        this.SERVICE_UUID,
        this.COMMAND_CHAR_UUID,
        Buffer.from(command).toString('base64')
      );

      const result = await this.device.readCharacteristicForService(
        this.SERVICE_UUID,
        this.COMMAND_CHAR_UUID
      );

      const success = result?.value === Buffer.from('OK').toString('base64');
      logger.debug('BLEManager', 'Delete result', { success });
      return success;
    } catch (error) {
      logger.error('BLEManager', 'Delete failed', error);
      throw new Error('Failed to delete file');
    }
  }

  async uploadFile(filename: string, data: Buffer): Promise<boolean> {
    if (!this.isInitialized || !this.device) {
      throw new Error('No device connected');
    }

    try {
      logger.debug('BLEManager', 'Starting file upload', { 
        filename, 
        size: data.length 
      });

      // Start file transfer
      const startCommand = `START:${filename}`;
      await this.device.writeCharacteristicWithResponseForService(
        this.SERVICE_UUID,
        this.FILE_CHAR_UUID,
        Buffer.from(startCommand).toString('base64')
      );

      // Wait for ready response
      const readyResponse = await this.device.readCharacteristicForService(
        this.SERVICE_UUID,
        this.FILE_CHAR_UUID
      );

      if (readyResponse?.value !== Buffer.from('READY').toString('base64')) {
        throw new Error('Device not ready for file transfer');
      }

      // Send file data in chunks
      const totalChunks = Math.ceil(data.length / this.CHUNK_SIZE);
      for (let i = 0; i < data.length; i += this.CHUNK_SIZE) {
        const chunk = data.slice(i, i + this.CHUNK_SIZE);
        const chunkNumber = Math.floor(i / this.CHUNK_SIZE) + 1;
        
        logger.debug('BLEManager', 'Sending chunk', { 
          chunk: chunkNumber, 
          total: totalChunks 
        });

        await this.device.writeCharacteristicWithResponseForService(
          this.SERVICE_UUID,
          this.FILE_CHAR_UUID,
          chunk.toString('base64')
        );

        const chunkResponse = await this.device.readCharacteristicForService(
          this.SERVICE_UUID,
          this.FILE_CHAR_UUID
        );

        if (chunkResponse?.value !== Buffer.from('OK').toString('base64')) {
          throw new Error('Chunk transfer failed');
        }
      }

      // End file transfer
      await this.device.writeCharacteristicWithResponseForService(
        this.SERVICE_UUID,
        this.FILE_CHAR_UUID,
        Buffer.from('END').toString('base64')
      );

      const endResponse = await this.device.readCharacteristicForService(
        this.SERVICE_UUID,
        this.FILE_CHAR_UUID
      );

      const success = endResponse?.value === Buffer.from('DONE').toString('base64');
      logger.debug('BLEManager', 'Upload complete', { success });
      return success;
    } catch (error) {
      logger.error('BLEManager', 'Upload failed', error);
      throw new Error('Failed to upload file');
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        logger.debug('BLEManager', 'Disconnecting from device');
        await this.device.cancelConnection();
        this.device = null;
        logger.debug('BLEManager', 'Disconnected successfully');
      } catch (error) {
        logger.error('BLEManager', 'Disconnect failed', error);
        throw new Error('Failed to disconnect from device');
      }
    }
  }

  isConnected(): boolean {
    return this.device !== null;
  }
}

let bleManagerInstance: BLEManager | null = null;

export const getBleManager = async (): Promise<BLEManager> => {
  if (!bleManagerInstance) {
    bleManagerInstance = new BLEManager();
    await bleManagerInstance.initialize();
  }
  return bleManagerInstance;
};