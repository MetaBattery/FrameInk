import { BleManager, Device, State, Characteristic, BleError } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';

// Enhanced logging utility
const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const;

interface EnhancedLogMessage {
  timestamp: string;
  level: keyof typeof LOG_LEVELS;
  component: string;
  message: string;
  data?: any;
  error?: Error;
}

class EnhancedLogger {
  private static logBuffer: EnhancedLogMessage[] = [];
  private static readonly MAX_BUFFER_SIZE = 1000;

  private static formatTimestamp(): string {
    return new Date().toISOString();
  }

  private static formatData(data: any): string {
    try {
      return JSON.stringify(data, (key, value) => {
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack,
          };
        }
        if (value instanceof Uint8Array) {
          return Array.from(value)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join(':');
        }
        return value;
      }, 2);
    } catch (error) {
      return String(data);
    }
  }

  private static log(level: keyof typeof LOG_LEVELS, component: string, message: string, data?: any, error?: Error) {
    const logMessage: EnhancedLogMessage = {
      timestamp: this.formatTimestamp(),
      level,
      component,
      message,
      data: data ? this.formatData(data) : undefined,
      error,
    };

    this.logBuffer.push(logMessage);
    if (this.logBuffer.length > this.MAX_BUFFER_SIZE) {
      this.logBuffer.shift();
    }

    const consoleMessage = `[${logMessage.timestamp}] [${level}] [${component}] ${message}`;
    switch (level) {
      case 'ERROR':
        console.error(consoleMessage, data, error?.stack);
        break;
      case 'WARN':
        console.warn(consoleMessage, data);
        break;
      case 'INFO':
        console.info(consoleMessage, data);
        break;
      default:
        console.log(consoleMessage, data);
    }
  }

  static debug(component: string, message: string, data?: any) {
    this.log('DEBUG', component, message, data);
  }

  static info(component: string, message: string, data?: any) {
    this.log('INFO', component, message, data);
  }

  static warn(component: string, message: string, data?: any) {
    this.log('WARN', component, message, data);
  }

  static error(component: string, message: string, error?: Error, data?: any) {
    this.log('ERROR', component, message, data, error);
  }

  static getLogs(): EnhancedLogMessage[] {
    return [...this.logBuffer];
  }

  static exportLogs(): string {
    return this.logBuffer
      .map(log => `${log.timestamp} [${log.level}] [${log.component}] ${log.message}${
        log.data ? '\nData: ' + log.data : ''
      }${log.error ? '\nError: ' + log.error.stack : ''}`)
      .join('\n');
  }
}

// Interfaces and Types
interface OperationTiming {
  operationId: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  type: string;
  status: 'started' | 'completed' | 'failed';
  error?: Error;
}

interface ConnectionDiagnostics {
  rssi: number;
  mtu: number;
  connectionTime: number;
  totalOperations: number;
  completedOperations: number;
  failedOperations: number;
  averageOperationTime: number;
  connectionAttempts: number;
  lastError: string | null;
}

export interface FileInfo {
  name: string;
  size: number;
}

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  startTime: number;
  currentSpeed: number;
}

interface BLEManagerOptions {
  timeout?: number;
  retries?: number;
  mtu?: number;
}

interface BLEConnectionState {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  rssi?: number;
  mtu?: number;
  lastConnectedTime?: number;
  connectionAttempts: number;
}

interface DeviceConnectionMetrics {
  rssi: number;
  mtu: number;
  txPower?: number;
  connectionInterval?: number;
  latency?: number;
  supervisionTimeout?: number;
  signalStrength: 'Excellent' | 'Good' | 'Fair' | 'Poor';
  stability: 'Stable' | 'Moderate' | 'Unstable';
}

// Utility functions
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const byteArrayToHex = (array: Uint8Array): string => {
  return Array.from(array)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join(':');
};

const formatRSSI = (rssi: number): string => {
  if (rssi >= -50) return `${rssi} dBm (Excellent)`;
  if (rssi >= -60) return `${rssi} dBm (Good)`;
  if (rssi >= -70) return `${rssi} dBm (Fair)`;
  return `${rssi} dBm (Poor)`;
};

const getSignalQuality = (rssi: number): DeviceConnectionMetrics['signalStrength'] => {
  if (rssi >= -60) return 'Excellent';
  if (rssi >= -70) return 'Good';
  if (rssi >= -80) return 'Fair';
  return 'Poor';
};

const getSignalStability = (rssiDelta: number): DeviceConnectionMetrics['stability'] => {
  if (rssiDelta <= 5) return 'Stable';
  if (rssiDelta <= 10) return 'Moderate';
  return 'Unstable';
};

class BLEManager {
    private bleManager: BleManager | null = null;
    private device: Device | null = null;
    private readonly SERVICE_UUID: string;
    private readonly FILE_CHAR_UUID: string;
    private readonly COMMAND_CHAR_UUID: string;
    private CHUNK_SIZE: number;
    private readonly DEFAULT_TIMEOUT: number;
    private readonly MAX_RETRIES: number;
    private readonly INIT_DELAY: number;
    private readonly TARGET_MTU: number;
    private isInitialized: boolean;
    private connectionState: BLEConnectionState;
    private transferProgress?: TransferProgress;
    private transferListeners: ((progress: TransferProgress) => void)[];
    private subscriptions: { remove: () => void }[] = [];
    private deviceMetrics: DeviceConnectionMetrics | null = null;
    private operationQueue: Promise<any> = Promise.resolve();
    private operationTimings: OperationTiming[] = [];
    private diagnosticsInterval: NodeJS.Timer | null = null;
  
    constructor(private options: BLEManagerOptions = {}) {
      this.SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
      this.FILE_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
      this.COMMAND_CHAR_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
  
      this.CHUNK_SIZE = 512;
      this.DEFAULT_TIMEOUT = options.timeout || 10000;
      this.MAX_RETRIES = options.retries || 3;
      this.INIT_DELAY = Platform.OS === 'android' ? 2000 : 1000;
      this.TARGET_MTU = options.mtu || 517;
      this.isInitialized = false;
      this.connectionState = {
        connected: false,
        connecting: false,
        error: null,
        connectionAttempts: 0
      };
      this.transferListeners = [];
  
      EnhancedLogger.info('BLEManager', 'Instance created', {
        serviceUUID: this.SERVICE_UUID,
        options: this.options,
        platform: Platform.OS,
        version: Platform.Version
      });
    }
  
    private generateTransactionId(): string {
      return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
  
    private async enqueue<T>(operation: () => Promise<T>, operationType: string): Promise<T> {
      const operationId = this.generateTransactionId();
      this.trackOperation(operationType, operationId);
  
      this.operationQueue = this.operationQueue.then(async () => {
        try {
          const result = await operation();
          this.completeOperation(operationId);
          return result;
        } catch (error) {
          this.completeOperation(operationId, error as Error);
          throw error;
        }
      });
  
      return this.operationQueue;
    }
  
    private trackOperation(type: string, operationId: string): void {
      const timing: OperationTiming = {
        operationId,
        startTime: Date.now(),
        type,
        status: 'started'
      };
      
      this.operationTimings.push(timing);
      EnhancedLogger.debug('BLEManager', 'Operation started', {
        operationId,
        type,
        timestamp: new Date(timing.startTime).toISOString()
      });
    }
  
    private completeOperation(operationId: string, error?: Error): void {
      const timing = this.operationTimings.find(t => t.operationId === operationId);
      if (timing) {
        timing.endTime = Date.now();
        timing.duration = timing.endTime - timing.startTime;
        timing.status = error ? 'failed' : 'completed';
        timing.error = error;
  
        EnhancedLogger.debug('BLEManager', 'Operation completed', {
          operationId,
          type: timing.type,
          duration: `${timing.duration}ms`,
          status: timing.status,
          error: error ? {
            name: error.name,
            message: error.message,
            stack: error.stack
          } : undefined
        });
      }
    }
  
    private async runConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
      if (!this.device) {
        throw new Error('No device connected');
      }
  
      const now = Date.now();
      const rssi = await this.device.readRSSI();
      const completedOps = this.operationTimings.filter(t => t.status === 'completed');
      const failedOps = this.operationTimings.filter(t => t.status === 'failed');
      const avgOpTime = this.calculateAverageOperationTime();
  
      const diagnostics: ConnectionDiagnostics = {
        rssi,
        mtu: this.CHUNK_SIZE + 3,
        connectionTime: now - (this.connectionState.lastConnectedTime || now),
        totalOperations: this.operationTimings.length,
        completedOperations: completedOps.length,
        failedOperations: failedOps.length,
        averageOperationTime: avgOpTime,
        connectionAttempts: this.connectionState.connectionAttempts,
        lastError: this.connectionState.error
      };
  
      EnhancedLogger.info('BLEManager', 'Connection diagnostics', diagnostics);
      return diagnostics;
    }
  
    private calculateAverageOperationTime(): number {
      const completedOps = this.operationTimings.filter(t => t.duration);
      if (completedOps.length === 0) return 0;
      
      const totalTime = completedOps.reduce((sum, op) => sum + (op.duration || 0), 0);
      return Math.round(totalTime / completedOps.length);
    }
  
    private startDiagnosticsMonitoring(): void {
      if (this.diagnosticsInterval) {
        clearInterval(this.diagnosticsInterval);
      }
  
      this.diagnosticsInterval = setInterval(async () => {
        try {
          await this.runConnectionDiagnostics();
        } catch (error) {
          EnhancedLogger.error('BLEManager', 'Diagnostics monitoring failed', error as Error);
        }
      }, 30000); // Run diagnostics every 30 seconds
  
      this.subscriptions.push({
        remove: () => {
          if (this.diagnosticsInterval) {
            clearInterval(this.diagnosticsInterval);
            this.diagnosticsInterval = null;
          }
        }
      });
    }
  
    private async monitorConnectionQuality(): Promise<void> {
      if (!this.device) return;
  
      const checkConnectionQuality = async () => {
        try {
          const rssi = await this.device?.readRSSI();
          const metrics = this.deviceMetrics;
          const previousRssi = metrics?.rssi;
  
          if (rssi && previousRssi) {
            const rssiDelta = Math.abs(rssi - previousRssi);
            const signalQuality = getSignalQuality(rssi);
            const stability = getSignalStability(rssiDelta);
            
            this.deviceMetrics = {
              ...this.deviceMetrics!,
              rssi,
              signalStrength: signalQuality,
              stability
            };
  
            EnhancedLogger.debug('BLEManager', 'Connection quality update', {
              currentRSSI: rssi,
              previousRSSI: previousRssi,
              change: rssiDelta,
              quality: signalQuality,
              stability,
              deviceId: this.device?.id
            });
  
            if (rssiDelta > 10 || signalQuality === 'Poor') {
              EnhancedLogger.warn('BLEManager', 'Connection quality issue detected', {
                rssiDelta,
                quality: signalQuality,
                stability,
                deviceId: this.device?.id
              });
            }
          }
        } catch (error) {
          EnhancedLogger.error('BLEManager', 'Connection quality check failed', error as Error);
        }
      };
  
      const interval = setInterval(checkConnectionQuality, 5000);
      this.subscriptions.push({ remove: () => clearInterval(interval) });
    }
  
    private handleBleError(error: BleError, context: string, additionalData?: any) {
      const errorInfo = {
        errorCode: error.errorCode,
        attErrorCode: error.attErrorCode,
        iosErrorCode: error.iosErrorCode,
        androidErrorCode: error.androidErrorCode,
        message: error.message,
        context,
        deviceState: this.device ? {
          id: this.device.id,
          name: this.device.name,
          connected: this.connectionState.connected,
          rssi: this.deviceMetrics?.rssi,
          quality: this.deviceMetrics?.signalStrength,
          stability: this.deviceMetrics?.stability
        } : null,
        connectionState: { ...this.connectionState },
        ...additionalData
      };
  
      EnhancedLogger.error('BLEManager', `BLE Error in ${context}`, error, errorInfo);
      return errorInfo;
    }

    async initialize(): Promise<boolean> {
        if (this.isInitialized) {
          EnhancedLogger.debug('BLEManager', 'Already initialized');
          return true;
        }
    
        const initOperationId = this.generateTransactionId();
        this.trackOperation('initialization', initOperationId);
    
        try {
          EnhancedLogger.info('BLEManager', 'Starting initialization');
          const initStartTime = Date.now();
          
          await delay(this.INIT_DELAY);
          this.bleManager = new BleManager();
    
          if (Platform.OS === 'android') {
            await this.requestAndroidPermissions();
          }
    
          const state = await this.bleManager.state();
          EnhancedLogger.debug('BLEManager', 'Initial BLE State', { state });
    
          if (state !== State.PoweredOn) {
            EnhancedLogger.info('BLEManager', 'Waiting for BLE to power on', { currentState: state });
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(new Error('Timeout waiting for BLE to power on'));
              }, this.DEFAULT_TIMEOUT);
    
              const subscription = this.bleManager!.onStateChange(newState => {
                EnhancedLogger.debug('BLEManager', 'BLE State changed', { 
                  previousState: state, 
                  newState 
                });
                
                if (newState === State.PoweredOn) {
                  clearTimeout(timeout);
                  subscription.remove();
                  resolve();
                }
              }, true);
            });
          }
    
          this.isInitialized = true;
          const initDuration = Date.now() - initStartTime;
          EnhancedLogger.info('BLEManager', 'Initialization complete', { 
            duration: `${initDuration}ms`,
            bleState: await this.bleManager.state()
          });
    
          this.completeOperation(initOperationId);
          return true;
        } catch (error) {
          const errorInfo = this.handleBleError(error as BleError, 'initialization', {
            platform: Platform.OS,
            platformVersion: Platform.Version,
            initDelay: this.INIT_DELAY,
            timeout: this.DEFAULT_TIMEOUT
          });
    
          this.completeOperation(initOperationId, error as Error);
          this.isInitialized = false;
          this.bleManager = null;
          throw error;
        }
      }
    
      private async requestAndroidPermissions(): Promise<void> {
        if (Platform.OS === 'android') {
          const permissionOperationId = this.generateTransactionId();
          this.trackOperation('permission_request', permissionOperationId);
      
          try {
            const permissions = [
              PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
              PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
            ];
      
            // Only add these permissions for Android 12+ (API level 31+)
            if (Platform.Version >= 31) {
              permissions.push(
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
                // Remove BLUETOOTH_ADVERTISE as it's not needed for central mode
              );
            }
      
            EnhancedLogger.debug('BLEManager', 'Requesting Android permissions', { 
              permissions,
              androidVersion: Platform.Version
            });
      
            const granted = await PermissionsAndroid.requestMultiple(permissions);
            
            EnhancedLogger.debug('BLEManager', 'Permission results', { granted });
      
            const allGranted = Object.values(granted).every(
              status => status === PermissionsAndroid.RESULTS.GRANTED
            );
      
            if (!allGranted) {
              const deniedPermissions = Object.entries(granted)
                .filter(([_, status]) => status !== PermissionsAndroid.RESULTS.GRANTED)
                .map(([permission]) => permission);
      
              throw new Error(`Permissions not granted: ${deniedPermissions.join(', ')}`);
            }
      
            EnhancedLogger.info('BLEManager', 'Android permissions granted successfully');
            this.completeOperation(permissionOperationId);
          } catch (error) {
            EnhancedLogger.error('BLEManager', 'Permission request failed', error as Error, {
              requestedPermissions: permissions
            });
            this.completeOperation(permissionOperationId, error as Error);
            throw error;
          }
        }
      }
    
      async scanForDevices(): Promise<Device[]> {
        if (!this.isInitialized || !this.bleManager) {
          throw new Error('BLE Manager not initialized');
        }
    
        const scanOperationId = this.generateTransactionId();
        this.trackOperation('device_scan', scanOperationId);
    
        EnhancedLogger.info('BLEManager', 'Starting device scan', {
          timeout: this.DEFAULT_TIMEOUT,
          operationId: scanOperationId
        });
    
        const scanStartTime = Date.now();
        const devices: Device[] = [];
        const seenDevices = new Set<string>();
    
        return new Promise<Device[]>((resolve, reject) => {
          const scanTimeout = setTimeout(() => {
            this.bleManager?.stopDeviceScan();
            const scanDuration = Date.now() - scanStartTime;
            
            EnhancedLogger.info('BLEManager', 'Scan completed', {
              duration: `${scanDuration}ms`,
              devicesFound: devices.length,
              operationId: scanOperationId
            });
    
            this.completeOperation(scanOperationId);
            resolve(devices);
          }, this.DEFAULT_TIMEOUT);
    
          this.bleManager.startDeviceScan(null, null, (error, device) => {
            if (error) {
              const errorInfo = this.handleBleError(error as BleError, 'device_scan', {
                scanDuration: `${Date.now() - scanStartTime}ms`,
                devicesFound: devices.length
              });
    
              clearTimeout(scanTimeout);
              this.completeOperation(scanOperationId, error as Error);
              reject(error);
              return;
            }
    
            if (device && device.name && device.name.includes('FrameInk47')) {
              const deviceId = device.id;
              
              if (!seenDevices.has(deviceId)) {
                seenDevices.add(deviceId);
                devices.push(device);
                
                EnhancedLogger.debug('BLEManager', 'Device found', {
                  id: device.id,
                  name: device.name,
                  rssi: formatRSSI(device.rssi),
                  manufacturerData: device.manufacturerData 
                    ? byteArrayToHex(Buffer.from(device.manufacturerData, 'base64'))
                    : undefined,
                  operationId: scanOperationId
                });
              }
            }
          });
        });
      }

      async connectToDevice(device: Device): Promise<void> {
        if (!this.isInitialized) {
          throw new Error('BLE Manager not initialized');
        }
    
        if (this.connectionState.connecting || this.connectionState.connected) {
          EnhancedLogger.warn('BLEManager', 'Connection attempt while already connected/connecting', {
            currentState: this.connectionState
          });
          return;
        }
    
        const connectOperationId = this.generateTransactionId();
        this.trackOperation('device_connection', connectOperationId);
        
        this.connectionState.connecting = true;
        this.connectionState.connectionAttempts++;
        let attempts = 0;
        const connectStartTime = Date.now();
    
        while (attempts < this.MAX_RETRIES) {
          try {
            EnhancedLogger.info('BLEManager', 'Starting connection attempt', {
              deviceId: device.id,
              attempt: attempts + 1,
              totalAttempts: this.connectionState.connectionAttempts,
              operationId: connectOperationId
            });
    
            const connectedDevice = await device.connect({
              timeout: this.DEFAULT_TIMEOUT,
              requestMTU: this.TARGET_MTU
            });
    
            const initialRssi = await connectedDevice.readRSSI();
            EnhancedLogger.debug('BLEManager', 'Initial connection established', {
              deviceId: connectedDevice.id,
              rssi: formatRSSI(initialRssi),
              operationId: connectOperationId
            });
    
            await delay(1000); // Stability delay
    
            // Request MTU change if on Android
            if (Platform.OS === 'android') {
              try {
                const newMTU = await connectedDevice.requestMTU(this.TARGET_MTU);
                EnhancedLogger.debug('BLEManager', 'MTU negotiated', { 
                  newMTU,
                  operationId: connectOperationId
                });
                this.CHUNK_SIZE = newMTU - 3; // Account for ATT overhead
              } catch (mtuError) {
                EnhancedLogger.warn('BLEManager', 'MTU negotiation failed', { 
                  error: mtuError,
                  fallbackMTU: this.CHUNK_SIZE,
                  operationId: connectOperationId
                });
              }
            }
    
            await connectedDevice.discoverAllServicesAndCharacteristics();
            const services = await connectedDevice.services();
            
            // Log discovered services and characteristics
            for (const service of services) {
              const characteristics = await service.characteristics();
              EnhancedLogger.debug('BLEManager', 'Service discovered', {
                serviceUUID: service.uuid,
                characteristics: characteristics.map(c => ({
                  uuid: c.uuid,
                  properties: c.properties
                })),
                operationId: connectOperationId
              });
            }
    
            this.device = connectedDevice;
            await this.setupNotifications();
    
            // Initialize connection metrics
            const rssi = await connectedDevice.readRSSI();
            this.deviceMetrics = {
              rssi,
              mtu: this.CHUNK_SIZE + 3,
              signalStrength: getSignalQuality(rssi),
              stability: 'Stable'
            };
    
            const connectDuration = Date.now() - connectStartTime;
            EnhancedLogger.info('BLEManager', 'Connection successful', {
              duration: `${connectDuration}ms`,
              metrics: this.deviceMetrics,
              operationId: connectOperationId
            });
    
            this.connectionState = {
              connected: true,
              connecting: false,
              error: null,
              rssi,
              mtu: this.deviceMetrics.mtu,
              lastConnectedTime: Date.now(),
              connectionAttempts: this.connectionState.connectionAttempts
            };
    
            // Setup connection monitoring
            this.startDiagnosticsMonitoring();
            this.monitorConnectionQuality();
    
            // Setup disconnect listener
            this.device.onDisconnected((error) => {
              const disconnectReason = error ? 'error' : 'normal';
              EnhancedLogger.warn('BLEManager', 'Device disconnected', {
                reason: disconnectReason,
                error,
                connectionDuration: Date.now() - this.connectionState.lastConnectedTime!,
                metrics: this.deviceMetrics
              });
              this.handleDisconnect(error);
            });
    
            this.completeOperation(connectOperationId);
            return;
          } catch (error) {
            attempts++;
            const errorDetails = {
              attempt: attempts,
              deviceId: device.id,
              maxRetries: this.MAX_RETRIES,
              error: error instanceof Error ? {
                name: error.name,
                message: error.message,
                stack: error.stack
              } : error,
              operationId: connectOperationId
            };
    
            if (attempts === this.MAX_RETRIES) {
              const finalError = this.handleBleError(error as BleError, 'connection', errorDetails);
              this.connectionState = {
                connected: false,
                connecting: false,
                error: error instanceof Error ? error.message : String(error),
                connectionAttempts: this.connectionState.connectionAttempts
              };
              this.completeOperation(connectOperationId, error as Error);
              throw error;
            } else {
              EnhancedLogger.warn('BLEManager', 'Connection attempt failed, retrying', errorDetails);
              await delay(1000 * attempts); // Exponential backoff
            }
          }
        }
      }
    
      private async setupNotifications(): Promise<void> {
        if (!this.device) return;
    
        const notificationOperationId = this.generateTransactionId();
        this.trackOperation('setup_notifications', notificationOperationId);
    
        try {
          EnhancedLogger.debug('BLEManager', 'Setting up notifications');
          const setupStartTime = Date.now();
    
          const fileChar = await this.device.readCharacteristicForService(
            this.SERVICE_UUID,
            this.FILE_CHAR_UUID
          );
          const commandChar = await this.device.readCharacteristicForService(
            this.SERVICE_UUID,
            this.COMMAND_CHAR_UUID
          );
    
          // Enable notifications for both characteristics
          await fileChar.startNotifications();
          await commandChar.startNotifications();
    
          const fileSub = fileChar.monitor((error, characteristic) => {
            if (error) {
              EnhancedLogger.error('BLEManager', 'File characteristic notification error', error as Error, {
                characteristicUUID: fileChar.uuid
              });
              return;
            }
            if (characteristic?.value) {
              const rawData = characteristic.value;
              const data = Buffer.from(rawData, 'base64');
              
              EnhancedLogger.debug('BLEManager', 'File characteristic notification', {
                dataLength: data.length,
                hexDataPreview: byteArrayToHex(data.slice(0, 20)) + (data.length > 20 ? '...' : '')
              });
              
              this.handleFileNotification(data.toString('utf8'));
            }
          });
    
          const commandSub = commandChar.monitor((error, characteristic) => {
            if (error) {
              EnhancedLogger.error('BLEManager', 'Command characteristic notification error', error as Error, {
                characteristicUUID: commandChar.uuid
              });
              return;
            }
            if (characteristic?.value) {
              const rawData = characteristic.value;
              const data = Buffer.from(rawData, 'base64');
              
              EnhancedLogger.debug('BLEManager', 'Command characteristic notification', {
                dataLength: data.length,
                command: data.toString('utf8')
              });
              
              this.handleCommandNotification(data.toString('utf8'));
            }
          });
    
          this.subscriptions.push(fileSub, commandSub);
    
          const setupDuration = Date.now() - setupStartTime;
          EnhancedLogger.info('BLEManager', 'Notifications setup complete', {
            duration: `${setupDuration}ms`,
            operationId: notificationOperationId
          });
    
          this.completeOperation(notificationOperationId);
        } catch (error) {
          EnhancedLogger.error('BLEManager', 'Failed to setup notifications', error as Error);
          this.completeOperation(notificationOperationId, error as Error);
          throw error;
        }
      }

      private handleFileNotification(data: string) {
        try {
          const notificationId = this.generateTransactionId();
          EnhancedLogger.debug('BLEManager', 'Processing file notification', {
            notificationId,
            dataLength: data.length,
            dataSample: data.substring(0, 100), // Log first 100 chars
            timestamp: new Date().toISOString()
          });
    
          // Process the notification data according to the protocol
          const processingStartTime = Date.now();
          // Implement file notification handling logic here
    
          EnhancedLogger.debug('BLEManager', 'File notification processed', {
            notificationId,
            processingTime: `${Date.now() - processingStartTime}ms`,
            currentMetrics: this.deviceMetrics
          });
        } catch (error) {
          EnhancedLogger.error('BLEManager', 'Error handling file notification', error as Error, {
            dataLength: data.length,
            connectionState: this.connectionState
          });
        }
      }
    
      private handleCommandNotification(data: string) {
        try {
          const notificationId = this.generateTransactionId();
          EnhancedLogger.debug('BLEManager', 'Processing command notification', {
            notificationId,
            command: data,
            timestamp: new Date().toISOString()
          });
    
          // Process the command notification according to the protocol
          const processingStartTime = Date.now();
          // Implement command handling logic here
    
          EnhancedLogger.debug('BLEManager', 'Command notification processed', {
            notificationId,
            processingTime: `${Date.now() - processingStartTime}ms`,
            currentMetrics: this.deviceMetrics
          });
        } catch (error) {
          EnhancedLogger.error('BLEManager', 'Error handling command notification', error as Error, {
            command: data,
            connectionState: this.connectionState
          });
        }
      }
    
      async writeCommand(command: string): Promise<void> {
        if (!this.device) throw new Error('No device connected');
        
        const writeOperationId = this.generateTransactionId();
        this.trackOperation('write_command', writeOperationId);
        
        const writeStartTime = Date.now();
        EnhancedLogger.debug('BLEManager', 'Writing command', { 
          command,
          operationId: writeOperationId
        });
    
        try {
          const data = Buffer.from(command).toString('base64');
          await this.enqueue(async () => {
            await this.device!.writeCharacteristicWithResponseForService(
              this.SERVICE_UUID,
              this.COMMAND_CHAR_UUID,
              data
            );
          }, 'write_command');
    
          const writeDuration = Date.now() - writeStartTime;
          EnhancedLogger.debug('BLEManager', 'Command written successfully', {
            command,
            duration: `${writeDuration}ms`,
            dataLength: command.length,
            operationId: writeOperationId
          });
    
          this.completeOperation(writeOperationId);
        } catch (error) {
          const errorInfo = this.handleBleError(error as BleError, 'write_command', {
            command,
            duration: `${Date.now() - writeStartTime}ms`
          });
          this.completeOperation(writeOperationId, error as Error);
          throw error;
        }
      }
    
      async listFiles(): Promise<FileInfo[]> {
        if (!this.isInitialized || !this.device) {
          throw new Error('No device connected');
        }
    
        const listOperationId = this.generateTransactionId();
        this.trackOperation('list_files', listOperationId);
    
        EnhancedLogger.info('BLEManager', 'Starting file list operation', {
          operationId: listOperationId
        });
    
        const operationStartTime = Date.now();
        const files: FileInfo[] = [];
        let accumulatedData = '';
    
        return new Promise<FileInfo[]>((resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            const error = new Error('List files timeout');
            EnhancedLogger.error('BLEManager', 'List files operation timed out', error, {
              duration: `${Date.now() - operationStartTime}ms`,
              accumulatedDataLength: accumulatedData.length,
              operationId: listOperationId
            });
            this.completeOperation(listOperationId, error);
            reject(error);
          }, this.DEFAULT_TIMEOUT);
    
          const handleData = (data: string) => {
            accumulatedData += data;
            
            EnhancedLogger.debug('BLEManager', 'Received file list data chunk', {
              chunkLength: data.length,
              totalAccumulated: accumulatedData.length,
              operationId: listOperationId
            });
            
            if (accumulatedData.includes('END_LIST')) {
              clearTimeout(timeoutHandle);
              
              const fileListData = accumulatedData.replace('END_LIST', '');
              const entries = fileListData.split(';').filter(entry => entry.trim() !== '');
    
              EnhancedLogger.debug('BLEManager', 'Processing file list entries', {
                entriesCount: entries.length,
                operationId: listOperationId
              });
    
              for (const entry of entries) {
                const [name, size] = entry.split(',');
                if (name && size) {
                  files.push({
                    name: name.trim(),
                    size: parseInt(size.trim(), 10),
                  });
                }
              }
    
              const operationDuration = Date.now() - operationStartTime;
              EnhancedLogger.info('BLEManager', 'File list operation complete', {
                duration: `${operationDuration}ms`,
                filesFound: files.length,
                totalSize: files.reduce((acc, file) => acc + file.size, 0),
                operationId: listOperationId
              });
    
              this.completeOperation(listOperationId);
              resolve(files);
            }
          };
    
          const sub = this.device!.monitorCharacteristicForService(
            this.SERVICE_UUID,
            this.FILE_CHAR_UUID,
            (error, characteristic) => {
              if (error) {
                const bleError = this.handleBleError(error as BleError, 'list_files_monitor', {
                  operationId: listOperationId
                });
                clearTimeout(timeoutHandle);
                this.completeOperation(listOperationId, error as Error);
                reject(error);
                return;
              }
    
              if (characteristic?.value) {
                const data = Buffer.from(characteristic.value, 'base64').toString('utf8');
                handleData(data);
              }
            }
          );
    
          this.subscriptions.push(sub);
    
          // Send the LIST command
          this.writeCommand('LIST').catch(error => {
            EnhancedLogger.error('BLEManager', 'Error sending LIST command', error as Error, {
              operationId: listOperationId
            });
            clearTimeout(timeoutHandle);
            this.completeOperation(listOperationId, error as Error);
            reject(error);
          });
        });
      }
    
      private handleDisconnect(error?: any) {
        const disconnectTime = Date.now();
        const connectionDuration = this.connectionState.lastConnectedTime 
          ? disconnectTime - this.connectionState.lastConnectedTime 
          : 0;
    
        if (error) {
          EnhancedLogger.error('BLEManager', 'Disconnected with error', error as Error, {
            connectionDuration: `${connectionDuration}ms`,
            metrics: this.deviceMetrics,
            lastOperations: this.operationTimings.slice(-5) // Last 5 operations
          });
        } else {
          EnhancedLogger.info('BLEManager', 'Disconnected normally', {
            connectionDuration: `${connectionDuration}ms`,
            metrics: this.deviceMetrics,
            operationStats: {
              total: this.operationTimings.length,
              successful: this.operationTimings.filter(t => t.status === 'completed').length,
              failed: this.operationTimings.filter(t => t.status === 'failed').length
            }
          });
        }
        
        // Clean up
        this.device = null;
        this.deviceMetrics = null;
        this.connectionState = {
          connected: false,
          connecting: false,
          error: error ? error.toString() : null,
          connectionAttempts: this.connectionState.connectionAttempts
        };
        
        // Clear all subscriptions
        this.subscriptions.forEach(sub => {
          try {
            sub.remove();
          } catch (removeError) {
            EnhancedLogger.warn('BLEManager', 'Error removing subscription', {
              error: removeError
            });
          }
        });
        this.subscriptions = [];
    
        // Clear diagnostic monitoring
        if (this.diagnosticsInterval) {
          clearInterval(this.diagnosticsInterval);
          this.diagnosticsInterval = null;
        }
      }
    
      async disconnect(): Promise<void> {
        if (this.device) {
          const disconnectOperationId = this.generateTransactionId();
          this.trackOperation('disconnect', disconnectOperationId);
    
          EnhancedLogger.info('BLEManager', 'Initiating disconnect', {
            deviceId: this.device.id,
            operationId: disconnectOperationId
          });
    
          const disconnectStartTime = Date.now();
    
          try {
            await this.device.cancelConnection();
            const disconnectDuration = Date.now() - disconnectStartTime;
            EnhancedLogger.info('BLEManager', 'Disconnected successfully', {
              duration: `${disconnectDuration}ms`,
              operationId: disconnectOperationId
            });
            this.completeOperation(disconnectOperationId);
          } catch (error) {
            const errorInfo = this.handleBleError(error as BleError, 'disconnect', {
              duration: `${Date.now() - disconnectStartTime}ms`
            });
            this.completeOperation(disconnectOperationId, error as Error);
            throw error;
          } finally {
            this.handleDisconnect();
          }
        }
      }
    
      // Public utility methods
      getConnectionState(): BLEConnectionState {
        return { ...this.connectionState };
      }
    
      isConnected(): boolean {
        return this.connectionState.connected;
      }
    
      getDeviceMetrics(): DeviceConnectionMetrics | null {
        return this.deviceMetrics ? { ...this.deviceMetrics } : null;
      }
    
      getLogs(): EnhancedLogMessage[] {
        return EnhancedLogger.getLogs();
      }
    
      exportLogs(): string {
        return EnhancedLogger.exportLogs();
      }
    
      destroy(): void {
        EnhancedLogger.info('BLEManager', 'Destroying BLEManager instance');
        this.disconnect();
        this.bleManager?.destroy();
        this.bleManager = null;
        this.isInitialized = false;
        EnhancedLogger.info('BLEManager', 'Destroyed successfully');
      }
    }
    
    // Singleton instance
    let bleManagerInstance: BLEManager | null = null;
    
    export const getBleManager = async (): Promise<BLEManager> => {
      if (!bleManagerInstance) {
        bleManagerInstance = new BLEManager();
        await bleManagerInstance.initialize();
      }
      return bleManagerInstance;
    };
    
    export default BLEManager;