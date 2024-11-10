// services/bleManager.ts
import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import { logger } from './logger';

export interface FileInfo {
    name: string;
    size: number;
}

// Add delay utility function within the same file
const delay = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

interface FileInfo {
    name: string;
    size: number;
}

interface BLEManagerOptions {
  timeout?: number;
  retries?: number;
}

interface BLEConnectionState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

class BLEManager {
  private bleManager: BleManager | null = null;
  private device: Device | null = null;
  private readonly SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  private readonly FILE_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  private readonly COMMAND_CHAR_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
  private readonly CHUNK_SIZE = 512;
  private readonly DEFAULT_TIMEOUT = 10000; // 10 seconds
  private readonly MAX_RETRIES = 3;
  private readonly INIT_DELAY = Platform.OS === 'android' ? 2000 : 1000;
  private isInitialized = false;
  private connectionState: BLEConnectionState = {
    connected: false,
    connecting: false,
    error: null
  };

  constructor(private options: BLEManagerOptions = {}) {
    logger.debug('BLEManager', 'Creating new instance');
  }

  private async withTimeout<T>(
    promise: Promise<T>, 
    timeoutMs: number = this.DEFAULT_TIMEOUT,
    operation: string
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutHandle!);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle!);
      throw error;
    }
  }

  private async withRetries<T>(
    operation: () => Promise<T>,
    retries: number = this.MAX_RETRIES,
    operationName: string
  ): Promise<T> {
    let lastError: Error;
    
    for (let i = 0; i < retries; i++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        logger.warn('BLEManager', `${operationName} failed, attempt ${i + 1} of ${retries}`, error);
        
        if (i < retries - 1) {
          await delay(1000 * (i + 1));
        }
      }
    }
    
    throw lastError!;
  }

  async initialize(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      logger.debug('BLEManager', 'Starting initialization');

      // Wait for native modules to be ready
      logger.debug('BLEManager', `Waiting ${this.INIT_DELAY}ms for native modules`);
      await delay(this.INIT_DELAY);

      // Initialize BleManager after delay
      logger.debug('BLEManager', 'Creating BleManager instance');
      this.bleManager = new BleManager();

      if (Platform.OS === 'android') {
        await this.requestAndroidPermissions();
      }

      const stateCheckOperation = async () => {
        if (!this.bleManager) {
          throw new Error('BleManager not initialized');
        }

        const state = await this.bleManager.state();
        
        if (state !== State.PoweredOn) {
          await new Promise<void>((resolve, reject) => {
            if (!this.bleManager) {
              reject(new Error('BleManager not initialized'));
              return;
            }

            const timeout = setTimeout(() => {
              this.bleManager?.stopStateNotifications();
              reject(new Error('Bluetooth state change timeout'));
            }, 5000);

            this.bleManager.onStateChange((state) => {
              if (state === State.PoweredOn) {
                clearTimeout(timeout);
                this.bleManager?.stopStateNotifications();
                resolve();
              }
            }, true);
          });
        }
      };

      await this.withRetries(
        stateCheckOperation,
        this.options.retries || this.MAX_RETRIES,
        'Bluetooth state check'
      );

      this.isInitialized = true;
      logger.debug('BLEManager', 'Initialization complete');
      return true;
    } catch (error) {
      logger.error('BLEManager', 'Initialization failed', error);
      this.isInitialized = false;
      this.bleManager = null;
      return false;
    }
  }

  private async requestAndroidPermissions(): Promise<void> {
    if (Platform.OS === 'android') {
      logger.debug('BLEManager', 'Requesting Android permissions');
      
      const permissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      ];

      if (Platform.Version >= 31) {
        permissions.push(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
        );
      }
      
      try {
        const grants = await PermissionsAndroid.requestMultiple(permissions);

        const allGranted = Object.values(grants).every(
          (permission) => permission === PermissionsAndroid.RESULTS.GRANTED
        );

        if (!allGranted) {
          throw new Error('Required permissions not granted');
        }

        logger.debug('BLEManager', 'Android permissions granted');
      } catch (error) {
        logger.error('BLEManager', 'Permission request failed', error);
        throw error;
      }
    }
  }

  private async requestAndroidPermissions(): Promise<void> {
    if (Platform.OS === 'android') {
      logger.debug('BLEManager', 'Requesting Android permissions');
      
      const permissions = [
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      ];

      if (Platform.Version >= 31) {
        permissions.push(
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
        );
      }
      
      try {
        const grants = await PermissionsAndroid.requestMultiple(permissions);

        const allGranted = Object.values(grants).every(
          (permission) => permission === PermissionsAndroid.RESULTS.GRANTED
        );

        if (!allGranted) {
          throw new Error('Required permissions not granted');
        }

        logger.debug('BLEManager', 'Android permissions granted');
      } catch (error) {
        logger.error('BLEManager', 'Permission request failed', error);
        throw error;
      }
    }
  }

  async scanForDevices(): Promise<Device[]> {
    if (!this.isInitialized) {
      throw new Error('BLE Manager not initialized');
    }

    logger.debug('BLEManager', 'Starting device scan');
    const devices: Device[] = [];
    let scanTimeout: NodeJS.Timeout;

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.bleManager.stopDeviceScan();
        if (scanTimeout) clearTimeout(scanTimeout);
      };

      try {
        this.bleManager.startDeviceScan(
          [this.SERVICE_UUID],
          { allowDuplicates: false },
          (error, device) => {
            if (error) {
              cleanup();
              reject(error);
              return;
            }

            if (device?.name === 'FrameInk47' && !devices.find(d => d.id === device.id)) {
              logger.debug('BLEManager', 'Found device', {
                name: device.name,
                id: device.id,
              });
              devices.push(device);
            }
          }
        );

        scanTimeout = setTimeout(() => {
          cleanup();
          logger.debug('BLEManager', 'Scan complete', { deviceCount: devices.length });
          resolve(devices);
        }, 5000);
      } catch (error) {
        cleanup();
        logger.error('BLEManager', 'Scan failed', error);
        reject(error);
      }
    });
  }

  async connectToDevice(device: Device): Promise<void> {
    if (!this.isInitialized) {
        throw new Error('BLE Manager not initialized');
    }

    if (this.connectionState.connecting) {
        throw new Error('Connection already in progress');
    }

    try {
        this.connectionState = {
            connected: false,
            connecting: true,
            error: null
        };

        logger.debug('BLEManager', 'Connecting to device', { deviceId: device.id });
        
        if (this.device) {
            await this.disconnect();
        }

        const connectOperation = async () => {
            const connectedDevice = await this.withTimeout(
                device.connect(),
                this.options.timeout || this.DEFAULT_TIMEOUT,
                'Device connection'
            );
            
            await this.withTimeout(
                connectedDevice.discoverAllServicesAndCharacteristics(),
                this.options.timeout || this.DEFAULT_TIMEOUT,
                'Service discovery'
            );

            // Request MTU size change
            const requestedMtu = 512;
            const mtu = await this.withTimeout(
                connectedDevice.requestMTU(requestedMtu),
                this.options.timeout || this.DEFAULT_TIMEOUT,
                'Request MTU size'
            );
            logger.debug('BLEManager', 'MTU size negotiated', { mtu });

            return connectedDevice;
        };

        this.device = await this.withRetries(
            connectOperation,
            this.options.retries || this.MAX_RETRIES,
            'Device connection'
        );

        this.connectionState = {
            connected: true,
            connecting: false,
            error: null
        };

        // Set up disconnection listener
        this.device.onDisconnected((error) => {
            this.handleDisconnect(error);
        });

        logger.debug('BLEManager', 'Device setup complete');
    } catch (error) {
        this.connectionState = {
            connected: false,
            connecting: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
        logger.error('BLEManager', 'Connection failed', error);
        throw error;
    }
}

  private handleDisconnect(error?: any) {
    logger.debug('BLEManager', 'Device disconnected', error);
    this.device = null;
    this.connectionState = {
      connected: false,
      connecting: false,
      error: error ? error.message : null
    };
  }

  async listFiles(): Promise<FileInfo[]> {
    if (!this.isInitialized || !this.device) {
        throw new Error('No device connected');
    }

    return new Promise<FileInfo[]>((resolve, reject) => {
        const files: FileInfo[] = [];
        let subscription: any;
        let timeoutHandle: NodeJS.Timeout;

        const cleanup = () => {
            if (subscription) {
                subscription.remove();
                subscription = null;
            }
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
        };

        const finalize = () => {
            cleanup();
            resolve(files);
        };

        // Start a timeout to finalize the result if no new data is received
        const resetTimeout = () => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
            timeoutHandle = setTimeout(() => {
                logger.debug('BLEManager', 'No more data received, finalizing file list');
                finalize();
            }, 500);  // Wait 500 ms before finalizing
        };

        // Subscribe to notifications on the FILE_CHAR_UUID
        subscription = this.device.monitorCharacteristicForService(
            this.SERVICE_UUID,
            this.FILE_CHAR_UUID,
            (error, characteristic) => {
                if (error) {
                    logger.error('BLEManager', 'Error receiving notification', error);
                    cleanup();
                    reject(error);
                    return;
                }

                if (characteristic?.value) {
                    const decodedResponse = Buffer.from(characteristic.value, 'base64').toString('utf8');
                    logger.debug('BLEManager', 'Received file info', {
                        text: decodedResponse
                    });

                    // Each notification contains one file info
                    const item = decodedResponse.trim();
                    if (item.length > 0) {
                        const [name, size] = item.split(',');
                        if (name && size) {
                            files.push({
                                name: name.trim(),
                                size: parseInt(size.trim(), 10)
                            });
                        }
                    }

                    // Reset the timeout since we received data
                    resetTimeout();
                } else {
                    logger.warn('BLEManager', 'No response value received');
                }
            }
        );

        // Send the LIST command
        this.device.writeCharacteristicWithResponseForService(
            this.SERVICE_UUID,
            this.COMMAND_CHAR_UUID,
            Buffer.from('LIST').toString('base64')
        ).catch(error => {
            logger.error('BLEManager', 'Failed to send LIST command', error);
            cleanup();
            reject(error);
        });

        // Initialize the timeout
        resetTimeout();
    });
}

  async deleteFile(filename: string): Promise<boolean> {
    if (!this.isInitialized || !this.device) {
      throw new Error('No device connected');
    }

    const deleteOperation = async () => {
      logger.debug('BLEManager', 'Deleting file', { filename });
      
      const command = `DELETE:${filename}`;
      await this.withTimeout(
        this.device!.writeCharacteristicWithResponseForService(
          this.SERVICE_UUID,
          this.COMMAND_CHAR_UUID,
          Buffer.from(command).toString('base64')
        ),
        this.options.timeout || this.DEFAULT_TIMEOUT,
        'Write DELETE command'
      );

      const result = await this.withTimeout(
        this.device!.readCharacteristicForService(
          this.SERVICE_UUID,
          this.COMMAND_CHAR_UUID
        ),
        this.options.timeout || this.DEFAULT_TIMEOUT,
        'Read delete result'
      );

      const success = result?.value === Buffer.from('OK').toString('base64');
      logger.debug('BLEManager', 'Delete result', { success });
      return success;
    };

    try {
      return await this.withRetries(
        deleteOperation,
        this.options.retries || this.MAX_RETRIES,
        'Delete file'
      );
    } catch (error) {
      logger.error('BLEManager', 'Delete failed', error);
      throw error;
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
      await this.withTimeout(
        this.device.writeCharacteristicWithResponseForService(
          this.SERVICE_UUID,
          this.FILE_CHAR_UUID,
          Buffer.from(`START:${filename}`).toString('base64')
        ),
        this.options.timeout || this.DEFAULT_TIMEOUT,
        'Write START command'
      );

      // Wait for ready response
      const readyResponse = await this.withTimeout(
        this.device.readCharacteristicForService(
          this.SERVICE_UUID,
          this.FILE_CHAR_UUID
        ),
        this.options.timeout || this.DEFAULT_TIMEOUT,
        'Read READY response'
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

        await this.withTimeout(
          this.device.writeCharacteristicWithResponseForService(
            this.SERVICE_UUID,
            this.FILE_CHAR_UUID,
            chunk.toString('base64')
          ),
          this.options.timeout || this.DEFAULT_TIMEOUT,
          `Write chunk ${chunkNumber}`
        );

        const chunkResponse = await this.withTimeout(
          this.device.readCharacteristicForService(
            this.SERVICE_UUID,
            this.FILE_CHAR_UUID
          ),
          this.options.timeout || this.DEFAULT_TIMEOUT,
          `Read chunk ${chunkNumber} response`
        );

        if (chunkResponse?.value !== Buffer.from('OK').toString('base64')) {
          throw new Error(`Chunk ${chunkNumber} transfer failed`);
        }
      }

      // End file transfer
      await this.withTimeout(
        this.device.writeCharacteristicWithResponseForService(
          this.SERVICE_UUID,
          this.FILE_CHAR_UUID,
          Buffer.from('END').toString('base64')
        ),
        this.options.timeout || this.DEFAULT_TIMEOUT,
        'Write END command'
      );

      const endResponse = await this.withTimeout(
        this.device.readCharacteristicForService(
          this.SERVICE_UUID,
          this.FILE_CHAR_UUID
        ),
        this.options.timeout || this.DEFAULT_TIMEOUT,
        'Read END response'
      );

      const success = endResponse?.value === Buffer.from('DONE').toString('base64');
      logger.debug('BLEManager', 'Upload complete', { success });
      return success;
    } catch (error) {
      logger.error('BLEManager', 'Upload failed', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        logger.debug('BLEManager', 'Disconnecting from device');
        await this.withTimeout(
          this.device.cancelConnection(),
          this.options.timeout || this.DEFAULT_TIMEOUT,
          'Device disconnection'
        );
        this.device = null;
        this.connectionState = {
          connected: false,
          connecting: false,
          error: null
        };
        logger.debug('BLEManager', 'Disconnected successfully');
      } catch (error) {
        logger.error('BLEManager', 'Disconnect failed', error);
        throw error;
      }
    }
  }

  getConnectionState(): BLEConnectionState {
    return { ...this.connectionState };
  }

  isConnected(): boolean {
    return this.device !== null && this.isInitialized;
  }

  destroy(): void {
    if (this.bleManager) {
      this.bleManager.destroy();
    }
    this.isInitialized = false;
    this.device = null;
    this.connectionState = {
      connected: false,
      connecting: false,
      error: null
    };
  }
}

let bleManagerInstance: BLEManager | null = null;

export const getBleManager = async (): Promise<BLEManager> => {
  try {
    if (!bleManagerInstance) {
      bleManagerInstance = new BLEManager({
        timeout: 10000,  // 10 seconds
        retries: 3
      });
      await bleManagerInstance.initialize();
    } else if (!bleManagerInstance.isConnected()) {
      await bleManagerInstance.initialize();
    }
    return bleManagerInstance;
  } catch (error) {
    logger.error('BLEManager', 'Failed to get BLE manager instance', error);
    if (bleManagerInstance) {
      bleManagerInstance.destroy();
      bleManagerInstance = null;
    }
    throw error;
  }
};