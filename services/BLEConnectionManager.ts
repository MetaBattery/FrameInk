// services/BLEConnectionManager.ts

import { BleManager, Device, State } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { EnhancedLogger } from './EnhancedLogger';
import { OperationTracker } from './BLEOperationTracker';
import {
    ConnectionState,
    DeviceConnectionMetrics,
    BLEOptions,
    ConnectionDiagnostics,
} from './BLETypes';

const DEFAULT_SCAN_TIMEOUT = 6000;
const DEFAULT_MTU = 247;

export class BLEConnectionManager extends OperationTracker {
    private bleManager: BleManager;
    private connectedDevice: Device | null = null;
    private isInitialized: boolean = false;
    private connectionState: ConnectionState;
    private readonly options: BLEOptions;

    constructor(options: BLEOptions = {}) {
        super();
        EnhancedLogger.debug('BLEConnectionManager', 'Constructor called', { options });
        this.options = options;
        this.bleManager = new BleManager();
        this.connectionState = {
            connected: false,
            connecting: false,
            error: null,
            connectionAttempts: 0,
        };
        EnhancedLogger.info('BLEConnectionManager', 'Instance created', { options });
    }

    async initialize(): Promise<boolean> {
        EnhancedLogger.debug('BLEConnectionManager', 'Initialize method called');
        if (this.isInitialized) {
            EnhancedLogger.info('BLEConnectionManager', 'Already initialized');
            return true;
        }

        try {
            if (Platform.OS === 'android') {
                await this.requestAndroidPermissions();
            }
            await this.waitForBluetoothState();
            this.isInitialized = true;
            EnhancedLogger.info('BLEConnectionManager', 'Initialization complete');
            return true;
        } catch (error) {
            EnhancedLogger.error('BLEConnectionManager', 'Initialization failed', error as Error);
            this.isInitialized = false;
            throw error;
        }
    }

    private async requestAndroidPermissions(): Promise<void> {
        EnhancedLogger.debug('BLEConnectionManager', 'Requesting Android permissions');
        const permissions = [
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ];
        const granted = await PermissionsAndroid.requestMultiple(permissions);
        EnhancedLogger.debug('BLEConnectionManager', 'Permissions result', { granted });
        if (Object.values(granted).some((status) => status !== PermissionsAndroid.RESULTS.GRANTED)) {
            throw new Error('Required Android permissions not granted');
        }
        EnhancedLogger.info('BLEConnectionManager', 'Android permissions granted');
    }

    private async waitForBluetoothState(): Promise<void> {
        EnhancedLogger.debug('BLEConnectionManager', 'Waiting for Bluetooth state');
        const state = await this.bleManager.state();
        EnhancedLogger.debug('BLEConnectionManager', 'Current Bluetooth state', { state });
        if (state !== State.PoweredOn) {
            EnhancedLogger.debug('BLEConnectionManager', 'Bluetooth not powered on, waiting for state change');
            await new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    EnhancedLogger.error('BLEConnectionManager', 'Bluetooth state timeout');
                    reject(new Error('Bluetooth state timeout'));
                }, 10000);
                const subscription = this.bleManager.onStateChange((newState) => {
                    EnhancedLogger.debug('BLEConnectionManager', 'Bluetooth state changed', { newState });
                    if (newState === State.PoweredOn) {
                        clearTimeout(timeout);
                        subscription.remove();
                        resolve();
                    }
                }, true);
            });
        }
        EnhancedLogger.debug('BLEConnectionManager', 'Bluetooth is powered on');
    }

    // In BLEConnectionManager.ts
async scanForDevices(): Promise<Device[]> {
    EnhancedLogger.debug('BLEConnectionManager', 'Scanning for devices');
    if (!this.isInitialized) {
        throw new Error('BLE Manager not initialized');
    }

    return new Promise((resolve, reject) => {
        const devices: Device[] = [];
        const timeout = setTimeout(() => {
            EnhancedLogger.debug('BLEConnectionManager', 'Scan timeout reached');
            this.bleManager.stopDeviceScan();
            resolve(devices);
        }, this.options.scanTimeout || DEFAULT_SCAN_TIMEOUT);

        try {
            EnhancedLogger.debug('BLEConnectionManager', 'Starting device scan');
            this.bleManager.startDeviceScan(null, null, (error, device) => {
                if (error) {
                    EnhancedLogger.error('BLEConnectionManager', 'Scan error', error);
                    clearTimeout(timeout);
                    this.bleManager.stopDeviceScan();
                    reject(error);
                    return;
                }

                if (device) {
                    EnhancedLogger.info('BLEConnectionManager', 'Discovered device', {
                        id: device.id,
                        name: device.name,
                        localName: device.localName,
                        rssi: device.rssi,
                        manufacturerData: device.manufacturerData,
                        serviceUUIDs: device.serviceUUIDs,
                        mtu: device.mtu,
                    });
                    devices.push(device);
                }
            });
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Unknown error during scan';
            EnhancedLogger.error('BLEConnectionManager', 'Error starting scan', {
                error: errorMessage,
                stack: err instanceof Error ? err.stack : undefined,
            });
            clearTimeout(timeout);
            reject(new Error(`Scan failed: ${errorMessage}`));
        }
    });
}

async connectToDevice(device: Device): Promise<void> {
    EnhancedLogger.debug('BLEConnectionManager', 'Connect to device method called', { 
        deviceId: device.id,
        deviceName: device.name,
        deviceLocalName: device.localName,
        rssi: device.rssi
    });

    if (this.connectionState.connecting || this.connectionState.connected) {
        EnhancedLogger.warn('BLEConnectionManager', 'Already connecting or connected to a device');
        throw new Error('Already connecting or connected to a device');
    }

    this.connectionState.connecting = true;
    this.connectionState.connectionAttempts++;
    
    try {
        EnhancedLogger.debug('BLEConnectionManager', 'Attempting to connect to device', { 
            deviceId: device.id,
            deviceName: device.name,
            deviceLocalName: device.localName,
            attempt: this.connectionState.connectionAttempts
        });

        const isConnectable = await device.isConnectable();
        if (!isConnectable) {
            throw new Error('Device is not connectable');
        }

        EnhancedLogger.debug('BLEConnectionManager', 'Calling device.connect()');
        const connectedDevice = await device.connect({
            timeout: this.options.connectionTimeout || 10000,
        });
        EnhancedLogger.debug('BLEConnectionManager', 'Device.connect() completed successfully');

        EnhancedLogger.debug('BLEConnectionManager', 'Device connected, requesting MTU change');
        const requestedMTU = this.options.mtu || DEFAULT_MTU;
        const newMTU = await connectedDevice.requestMTU(requestedMTU);
        EnhancedLogger.debug('BLEConnectionManager', 'MTU changed', { requestedMTU, newMTU });

        EnhancedLogger.debug('BLEConnectionManager', 'Discovering services and characteristics');
        await connectedDevice.discoverAllServicesAndCharacteristics();

        this.connectedDevice = connectedDevice;
        this.connectionState = {
            connected: true,
            connecting: false,
            error: null,
            connectionAttempts: this.connectionState.connectionAttempts,
        };
        EnhancedLogger.info('BLEConnectionManager', 'Device connected successfully', {
            id: device.id,
            name: device.name,
            localName: device.localName,
        });
    } catch (error) {
        this.connectionState.connecting = false;
        this.connectionState.error = (error as Error).message;
        EnhancedLogger.error('BLEConnectionManager', 'Connection failed', {
            error: (error as Error).message,
            stack: (error as Error).stack,
            deviceId: device.id,
            deviceName: device.name,
            deviceLocalName: device.localName
        });
        throw error;
    }
}

    async disconnect(): Promise<void> {
        EnhancedLogger.debug('BLEConnectionManager', 'Disconnect method called');
        if (this.connectedDevice) {
            try {
                EnhancedLogger.debug('BLEConnectionManager', 'Attempting to disconnect from device', { 
                    deviceId: this.connectedDevice.id,
                    deviceName: this.connectedDevice.name,
                    deviceLocalName: this.connectedDevice.localName
                });
                await this.connectedDevice.cancelConnection();
                this.connectedDevice = null;
                this.connectionState = {
                    connected: false,
                    connecting: false,
                    error: null,
                    connectionAttempts: this.connectionState.connectionAttempts,
                };
                EnhancedLogger.info('BLEConnectionManager', 'Device disconnected successfully');
            } catch (error) {
                EnhancedLogger.error('BLEConnectionManager', 'Error during disconnect', error as Error);
                throw error;
            }
        } else {
            EnhancedLogger.warn('BLEConnectionManager', 'Disconnect called but no device was connected');
        }
    }

    async getDiagnostics(): Promise<ConnectionDiagnostics> {
        EnhancedLogger.debug('BLEConnectionManager', 'Get diagnostics method called');
        if (!this.connectedDevice) {
            EnhancedLogger.error('BLEConnectionManager', 'No device connected for diagnostics');
            throw new Error('No device connected');
        }

        try {
            EnhancedLogger.debug('BLEConnectionManager', 'Reading RSSI');
            const rssi = await this.connectedDevice.readRSSI();
            const diagnostics: ConnectionDiagnostics = {
                rssi,
                mtu: this.connectedDevice.mtu || DEFAULT_MTU,
                connectionTime: Date.now() - (this.connectionState.lastConnectedTime || Date.now()),
                totalOperations: this.operationTimings.length,
                completedOperations: this.operationTimings.filter((op) => op.status === 'completed').length,
                failedOperations: this.operationTimings.filter((op) => op.status === 'failed').length,
                averageOperationTime: this.calculateAverageOperationTime(),
                connectionAttempts: this.connectionState.connectionAttempts,
                lastError: this.connectionState.error,
            };
            EnhancedLogger.debug('BLEConnectionManager', 'Diagnostics collected', diagnostics);
            return diagnostics;
        } catch (error) {
            EnhancedLogger.error('BLEConnectionManager', 'Error getting diagnostics', error as Error);
            throw error;
        }
    }

    destroy(): void {
        EnhancedLogger.debug('BLEConnectionManager', 'Destroy method called');
        this.bleManager.destroy();
        this.connectedDevice = null;
        this.isInitialized = false;
        EnhancedLogger.info('BLEConnectionManager', 'Manager destroyed');
    }

    getConnectionState(): ConnectionState {
        EnhancedLogger.debug('BLEConnectionManager', 'Get connection state called', this.connectionState);
        return { ...this.connectionState };
    }

    getCurrentDevice(): Device | null {
        EnhancedLogger.debug('BLEConnectionManager', 'Get connected device called', { 
            deviceId: this.connectedDevice?.id,
            deviceName: this.connectedDevice?.name,
            deviceLocalName: this.connectedDevice?.localName
        });
        return this.connectedDevice;
    }

    async isDeviceConnected(deviceId: string): Promise<boolean> {
        EnhancedLogger.debug('BLEConnectionManager', 'Is device connected method called', { deviceId });
        if (!this.isInitialized) {
            EnhancedLogger.error('BLEConnectionManager', 'BLE Manager not initialized');
            throw new Error('BLE Manager not initialized');
        }
        try {
            const isConnected = await this.bleManager.isDeviceConnected(deviceId);
            EnhancedLogger.debug('BLEConnectionManager', 'Device connection status', { deviceId, isConnected });
            return isConnected;
        } catch (error) {
            EnhancedLogger.error('BLEConnectionManager', 'Error checking device connection', error as Error);
            throw error;
        }
    }

    getDeviceMetrics(): DeviceConnectionMetrics | null {
        EnhancedLogger.debug('BLEConnectionManager', 'Get device metrics called');
        if (!this.connectedDevice) {
            return null;
        }
        return {
            rssi: this.connectedDevice.rssi || 0,
            mtu: this.connectedDevice.mtu || DEFAULT_MTU,
            signalStrength: this.getSignalStrength(this.connectedDevice.rssi || 0),
            stability: 'Stable', // This would need to be determined based on connection history
        };
    }

    private getSignalStrength(rssi: number): 'Excellent' | 'Good' | 'Fair' | 'Poor' {
        if (rssi >= -50) return 'Excellent';
        if (rssi >= -60) return 'Good';
        if (rssi >= -70) return 'Fair';
        return 'Poor';
    }

    protected async runConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
        return this.getDiagnostics();
    }
}