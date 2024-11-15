// BLEConnectionManager.ts
import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { Buffer } from 'buffer';
import { EnhancedLogger } from './EnhancedLogger';
import { OperationTracker } from './BLEOperationTracker';
import { 
    ConnectionState, 
    DeviceConnectionMetrics, 
    BLEOptions,
    ConnectionDiagnostics 
} from './BLETypes';

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

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

export class BLEConnectionManager extends OperationTracker {
    private bleManager: BleManager | null = null;
    private device: Device | null = null;
    private readonly DEFAULT_TIMEOUT: number;
    private readonly MAX_RETRIES: number;
    private readonly INIT_DELAY: number;
    private readonly TARGET_MTU: number;
    private _isInitialized: boolean;
    private connectionState: ConnectionState;
    private deviceMetrics: DeviceConnectionMetrics | null = null;
    private monitoringSubscriptions: { remove: () => void }[] = [];

    constructor(private options: BLEOptions = {}) {
        super();
        this.DEFAULT_TIMEOUT = options.timeout || 10000;
        this.MAX_RETRIES = options.retries || 3;
        this.INIT_DELAY = Platform.OS === 'android' ? 2000 : 1000;
        this.TARGET_MTU = options.mtu || 517;
        this._isInitialized = false;
        this.connectionState = {
            connected: false,
            connecting: false,
            error: null,
            connectionAttempts: 0
        };

        EnhancedLogger.info('BLEConnectionManager', 'Instance created', {
            options: this.options,
            platform: Platform.OS,
            version: Platform.Version
        });
    }

    get isInitialized(): boolean {
        return this._isInitialized;
    }

    async initialize(): Promise<boolean> {
        if (this._isInitialized) {
            EnhancedLogger.debug('BLEConnectionManager', 'Already initialized');
            return true;
        }

        const initOperationId = this.generateTransactionId();
        this.trackOperation('initialization', initOperationId);

        try {
            EnhancedLogger.info('BLEConnectionManager', 'Starting initialization');
            const initStartTime = Date.now();
            
            await delay(this.INIT_DELAY);
            
            try {
                this.bleManager = new BleManager({
                    restoreStateIdentifier: 'FrameInkBleManager',
                    restoreStateFunction: (restoredState) => {
                        EnhancedLogger.debug('BLEConnectionManager', 'State restored', { restoredState });
                    }
                });
            } catch (error) {
                EnhancedLogger.error('BLEConnectionManager', 'Failed to create BleManager instance', error as Error);
                throw new Error('Failed to initialize Bluetooth manager');
            }

            if (!this.bleManager) {
                throw new Error('BleManager initialization failed');
            }

            if (Platform.OS === 'android') {
                await this.requestAndroidPermissions();
            }

            await this.checkAndWaitForBluetoothState();

            this._isInitialized = true;
            const initDuration = Date.now() - initStartTime;
            EnhancedLogger.info('BLEConnectionManager', 'Initialization complete', { 
                duration: `${initDuration}ms`,
                bleState: await this.bleManager.state()
            });

            this.completeOperation(initOperationId);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error during initialization';
            EnhancedLogger.error('BLEConnectionManager', 'Initialization failed', error as Error, {
                platform: Platform.OS,
                platformVersion: Platform.Version,
                initDelay: this.INIT_DELAY,
                timeout: this.DEFAULT_TIMEOUT
            });

            this.completeOperation(initOperationId, error as Error);
            this._isInitialized = false;
            this.bleManager = null;
            throw new Error(`Bluetooth initialization failed: ${errorMessage}`);
        }
    }

    private async checkAndWaitForBluetoothState(): Promise<void> {
        if (!this.bleManager) throw new Error('BLE Manager not initialized');

        const state = await this.bleManager.state();
        if (state !== State.PoweredOn) {
            EnhancedLogger.info('BLEConnectionManager', 'Waiting for BLE to power on', { currentState: state });
            
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Timeout waiting for BLE to power on'));
                }, this.DEFAULT_TIMEOUT);

                let subscription: any;
                try {
                    subscription = this.bleManager!.onStateChange((newState) => {
                        EnhancedLogger.debug('BLEConnectionManager', 'BLE State changed', { 
                            previousState: state, 
                            newState 
                        });
                        
                        if (newState === State.PoweredOn) {
                            clearTimeout(timeout);
                            if (subscription) {
                                subscription.remove();
                            }
                            resolve();
                        } else if (newState === State.PoweredOff) {
                            EnhancedLogger.warn('BLEConnectionManager', 'Bluetooth is powered off');
                        } else if (newState === State.Unauthorized) {
                            reject(new Error('Bluetooth permission denied'));
                        }
                    }, true);
                } catch (error) {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
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

                if (Platform.Version >= 31) {
                    permissions.push(
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
                    );
                }

                EnhancedLogger.debug('BLEConnectionManager', 'Requesting Android permissions', { 
                    permissions,
                    androidVersion: Platform.Version
                });

                const granted = await PermissionsAndroid.requestMultiple(permissions);
                
                EnhancedLogger.debug('BLEConnectionManager', 'Permission results', { granted });

                const allGranted = Object.values(granted).every(
                    status => status === PermissionsAndroid.RESULTS.GRANTED
                );

                if (!allGranted) {
                    const deniedPermissions = Object.entries(granted)
                        .filter(([_, status]) => status !== PermissionsAndroid.RESULTS.GRANTED)
                        .map(([permission]) => permission);

                    throw new Error(`Required permissions not granted: ${deniedPermissions.join(', ')}`);
                }

                EnhancedLogger.info('BLEConnectionManager', 'Android permissions granted successfully');
                this.completeOperation(permissionOperationId);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown permission error';
                EnhancedLogger.error('BLEConnectionManager', 'Permission request failed', error as Error);
                this.completeOperation(permissionOperationId, error as Error);
                throw new Error(`Permission request failed: ${errorMessage}`);
            }
        }
    }

async scanForDevices(): Promise<Device[]> {
    if (!this._isInitialized || !this.bleManager) {
        throw new Error('BLE Manager not initialized');
    }

    const scanOperationId = this.generateTransactionId();
    this.trackOperation('device_scan', scanOperationId);

    EnhancedLogger.info('BLEConnectionManager', 'Starting device scan', {
        timeout: this.DEFAULT_TIMEOUT,
        operationId: scanOperationId
    });

    const scanStartTime = Date.now();
    const devices: Device[] = [];
    const seenDevices = new Set<string>();

    return new Promise<Device[]>((resolve, reject) => {
        let timeoutHandle: NodeJS.Timeout;
        let hasCompleted = false;

        const completeScan = (error?: Error) => {
            if (hasCompleted) return;
            hasCompleted = true;

            this.bleManager?.stopDeviceScan();
            const scanDuration = Date.now() - scanStartTime;

            if (error) {
                EnhancedLogger.error('BLEConnectionManager', 'Scan failed', error, {
                    duration: `${scanDuration}ms`,
                    devicesFound: devices.length,
                    operationId: scanOperationId
                });
                this.completeOperation(scanOperationId, error);
                reject(error);
            } else {
                EnhancedLogger.info('BLEConnectionManager', 'Scan completed', {
                    duration: `${scanDuration}ms`,
                    devicesFound: devices.length,
                    operationId: scanOperationId
                });
                this.completeOperation(scanOperationId);
                resolve(devices);
            }
        };

        timeoutHandle = setTimeout(() => {
            if (devices.length > 0) {
                completeScan();
            } else {
                completeScan(new Error('No devices found during scan'));
            }
        }, this.DEFAULT_TIMEOUT);

        try {
            this.bleManager.startDeviceScan(
                null,
                { allowDuplicates: false },
                (error, device) => {
                    if (error) {
                        clearTimeout(timeoutHandle);
                        completeScan(error);
                        return;
                    }

                    if (device && device.name && device.name.includes('FrameInk47')) {
                        const deviceId = device.id;
                        
                        if (!seenDevices.has(deviceId)) {
                            seenDevices.add(deviceId);
                            devices.push(device);
                            
                            EnhancedLogger.debug('BLEConnectionManager', 'Device found', {
                                id: device.id,
                                name: device.name,
                                rssi: formatRSSI(device.rssi),
                                manufacturerData: device.manufacturerData 
                                    ? Buffer.from(device.manufacturerData, 'base64').toString('hex')
                                    : undefined,
                                operationId: scanOperationId
                            });

                            clearTimeout(timeoutHandle);
                            completeScan();
                        }
                    }
                }
            );
        } catch (error) {
            clearTimeout(timeoutHandle);
            completeScan(error as Error);
        }
    });
}

async connectToDevice(device: Device): Promise<void> {
    if (!this._isInitialized) {
        throw new Error('BLE Manager not initialized');
    }

    if (this.connectionState.connecting || this.connectionState.connected) {
        EnhancedLogger.warn('BLEConnectionManager', 'Connection attempt while already connected/connecting', {
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
            EnhancedLogger.info('BLEConnectionManager', 'Starting connection attempt', {
                deviceId: device.id,
                attempt: attempts + 1,
                totalAttempts: this.connectionState.connectionAttempts
            });

            const connectedDevice = await device.connect({
                timeout: this.DEFAULT_TIMEOUT,
                requestMTU: this.TARGET_MTU
            });

            await this.setupConnection(connectedDevice);
            this.device = connectedDevice;

            const connectDuration = Date.now() - connectStartTime;
            EnhancedLogger.info('BLEConnectionManager', 'Connection successful', {
                duration: `${connectDuration}ms`,
                metrics: this.deviceMetrics
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
                } : error
            };

            if (attempts === this.MAX_RETRIES) {
                this.connectionState = {
                    connected: false,
                    connecting: false,
                    error: error instanceof Error ? error.message : String(error),
                    connectionAttempts: this.connectionState.connectionAttempts
                };
                this.completeOperation(connectOperationId, error as Error);
                throw error;
            } else {
                EnhancedLogger.warn('BLEConnectionManager', 'Connection attempt failed, retrying', errorDetails);
                await delay(1000 * attempts); // Exponential backoff
            }
        }
    }
}

private async setupConnection(device: Device): Promise<void> {
    const setupStartTime = Date.now();

    // Request MTU change if on Android
    if (Platform.OS === 'android') {
        try {
            const newMTU = await device.requestMTU(this.TARGET_MTU);
            EnhancedLogger.debug('BLEConnectionManager', 'MTU negotiated', { newMTU });
            
        } catch (error) {
            EnhancedLogger.warn('BLEConnectionManager', 'MTU negotiation failed', { 
                error,
                fallbackMTU: 23
            });
        }
    }

    // Update connection state
    this.connectionState = {
        connected: true,
        connecting: false,
        error: null,
        lastConnectedTime: Date.now(),
        connectionAttempts: this.connectionState.connectionAttempts
    };

    // Setup connection monitoring
    this.startConnectionMonitoring(device);

    EnhancedLogger.debug('BLEConnectionManager', 'Connection setup complete', {
        duration: `${Date.now() - setupStartTime}ms`,
        deviceId: device.id
    });
}

private startConnectionMonitoring(device: Device): void {
    // Monitor disconnection
    const disconnectSub = device.onDisconnected((error) => {
        this.handleDisconnect(error);
    });

    this.monitoringSubscriptions.push(disconnectSub);
    this.startDiagnosticsMonitoring();
}

protected async runConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
    if (!this.device) {
        throw new Error('No device connected');
    }

    const now = Date.now();
    const rssi = await this.device.readRSSI();
    const completedOps = this.operationTimings.filter(t => t.status === 'completed');
    const failedOps = this.operationTimings.filter(t => t.status === 'failed');

    return {
        rssi,
        mtu: this.TARGET_MTU,
        connectionTime: now - (this.connectionState.lastConnectedTime || now),
        totalOperations: this.operationTimings.length,
        completedOperations: completedOps.length,
        failedOperations: failedOps.length,
        averageOperationTime: this.calculateAverageOperationTime(),
        connectionAttempts: this.connectionState.connectionAttempts,
        lastError: this.connectionState.error
    };
}

private handleDisconnect(error?: any): void {
    EnhancedLogger.info('BLEConnectionManager', 'Device disconnected', {
        error,
        deviceId: this.device?.id,
        connectionDuration: this.connectionState.lastConnectedTime 
            ? Date.now() - this.connectionState.lastConnectedTime 
            : 0
    });

    this.device = null;
    this.deviceMetrics = null;
    this.connectionState = {
        connected: false,
        connecting: false,
        error: error ? error.toString() : null,
        connectionAttempts: this.connectionState.connectionAttempts
    };

    this.monitoringSubscriptions.forEach(sub => {
        try {
            sub.remove();
        } catch (removeError) {
            EnhancedLogger.warn('BLEConnectionManager', 'Error removing subscription', {
                error: removeError
            });
        }
    });
    this.monitoringSubscriptions = [];
    this.stopDiagnosticsMonitoring();
}

async disconnect(): Promise<void> {
    if (this.device) {
        const disconnectOperationId = this.generateTransactionId();
        this.trackOperation('disconnect', disconnectOperationId);

        try {
            await this.device.cancelConnection();
            this.completeOperation(disconnectOperationId);
        } catch (error) {
            this.completeOperation(disconnectOperationId, error as Error);
            throw error;
        } finally {
            this.handleDisconnect();
        }
    }
}

destroy(): void {
    this.disconnect();
    this.bleManager?.destroy();
    this.bleManager = null;
    this._isInitialized = false;
    EnhancedLogger.info('BLEConnectionManager', 'Manager destroyed');
}

// Public getters
getConnectionState(): ConnectionState {
    return { ...this.connectionState };
}

getDeviceMetrics(): DeviceConnectionMetrics | null {
    return this.deviceMetrics ? { ...this.deviceMetrics } : null;
}

getCurrentDevice(): Device | null {
    return this.device;
}
}