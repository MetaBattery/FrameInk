// BLEManager.ts

import { Device } from 'react-native-ble-plx';
import { Platform, PermissionsAndroid } from 'react-native';
import { BLEConnectionManager } from './BLEConnectionManager';
import { BLECommunicationManager } from './BLECommunicationManager';
import { EnhancedLogger } from './EnhancedLogger';
import {
    BLEOptions,
    BLEManagerEvents,
    ConnectionState,
    DeviceConnectionMetrics,
    FileInfo,
    TransferProgress,
    ScanResult,
    ConnectionOptions,
    BLEError,
    ConnectionDiagnostics,
    BLECommand,
    BLEResponse,
    StorageSpace
} from './BLETypes';

export class BLEManager {
    private connectionManager: BLEConnectionManager;
    private communicationManager: BLECommunicationManager | null = null;
    private events: BLEManagerEvents = {};
    private options: BLEOptions;

    constructor(options?: BLEOptions) {
        EnhancedLogger.debug('BLEManager', 'Constructor called', { options });
        this.options = options || {};
        try {
            this.connectionManager = new BLEConnectionManager(this.options);
            EnhancedLogger.info('BLEManager', 'BLEManager instance created', { options });
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to create BLEConnectionManager', error as Error);
            throw error;
        }
    }

    setEventHandlers(events: BLEManagerEvents): void {
        EnhancedLogger.debug('BLEManager', 'Setting event handlers', { eventKeys: Object.keys(events) });
        this.events = events;
    }

    async initialize(): Promise<boolean> {
        EnhancedLogger.debug('BLEManager', 'Initialize method called');
        try {
            const initialized = await this.connectionManager.initialize();
            EnhancedLogger.info('BLEManager', 'Initialization successful', { success: initialized });
            return initialized;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Initialization failed', error as BLEError, {
                stack: (error as Error).stack,
                name: (error as Error).name,
            });
            this.handleError(error as BLEError, 'initialization');
            throw error;
        }
    }

    async requestPermissions(): Promise<void> {
        EnhancedLogger.debug('BLEManager', 'Request permissions method called');
        if (Platform.OS === 'android') {
            const permissions = [
                PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            ];
            EnhancedLogger.debug('BLEManager', 'Requesting Android permissions', { permissions });
            try {
                const granted = await PermissionsAndroid.requestMultiple(permissions);
                EnhancedLogger.debug('BLEManager', 'Permissions result', { granted });
                if (Object.values(granted).some((status) => status !== PermissionsAndroid.RESULTS.GRANTED)) {
                    throw new Error('Required Android permissions not granted');
                }
                EnhancedLogger.info('BLEManager', 'Android permissions granted');
            } catch (error) {
                EnhancedLogger.error('BLEManager', 'Failed to request permissions', error as Error);
                throw error;
            }
        }
    }

    // In BLEManager.ts
async scan(): Promise<ScanResult[]> {
    EnhancedLogger.debug('BLEManager', 'Scan method called');
    try {
        await this.requestPermissions();
        EnhancedLogger.info('BLEManager', 'Starting device scan');
        const devices = await this.connectionManager.scanForDevices();
        EnhancedLogger.debug('BLEManager', 'Scan completed', { devicesFound: devices.length });

        const scanResults: ScanResult[] = devices.map(device => ({
            device,
            rssi: device.rssi || -100,
            advertisementData: {
                localName: device.name,
                manufacturerData: device.manufacturerData,
                serviceData: device.serviceData,
                serviceUUIDs: device.serviceUUIDs,
                txPowerLevel: device.txPowerLevel,
            }
        }));

        scanResults.forEach((result) => {
            EnhancedLogger.debug('BLEManager', 'Device found', { 
                deviceId: result.device.id, 
                deviceName: result.device.name,
                rssi: result.rssi
            });
            if (this.events.onDeviceFound) {
                this.events.onDeviceFound(result.device);
            }
        });

        return scanResults;
    } catch (error) {
        EnhancedLogger.error('BLEManager', 'Scan failed', error as BLEError, {
            stack: (error as Error).stack,
            name: (error as Error).name,
        });
        this.handleError(error as BLEError, 'scan');
        throw error;
    }
}

async connectToDevice(device: Device, options?: ConnectionOptions): Promise<void> {
    EnhancedLogger.debug('BLEManager', 'Connect to device method called', { deviceId: device.id, options });
    if (!device || !device.id) {
        throw new Error('Invalid device object');
    }
    try {
        EnhancedLogger.info('BLEManager', `Connecting to device: ${device.id}`);
        await this.connectionManager.connectToDevice(device);

        EnhancedLogger.debug('BLEManager', 'Creating communication manager');
        this.communicationManager = new BLECommunicationManager(device);
        await this.communicationManager.setupNotifications();

        EnhancedLogger.debug('BLEManager', 'Setting up transfer progress listener');
        this.communicationManager.addTransferListener((progress: TransferProgress) => {
            EnhancedLogger.debug('BLEManager', 'Transfer progress', { progress });
            if (this.events.onTransferProgress) {
                this.events.onTransferProgress(progress);
            }
        });

        const connectionState = this.connectionManager.getConnectionState();
        EnhancedLogger.debug('BLEManager', 'Notifying connection state change', connectionState);
        if (this.events.onConnectionStateChange) {
            this.events.onConnectionStateChange(connectionState);
        }

        const metrics = this.connectionManager.getDeviceMetrics();
        if (metrics && this.events.onMtuChange) {
            this.events.onMtuChange(metrics.mtu);
        }

        EnhancedLogger.info('BLEManager', 'Connection successful', { deviceId: device.id });
    } catch (error) {
        EnhancedLogger.error('BLEManager', 'Connection failed', error as BLEError, {
            deviceId: device.id,
            stack: (error as Error).stack,
            name: (error as Error).name,
        });
        this.handleError(error as BLEError, 'connection');
        throw error;
    }
}

    async listFiles(): Promise<FileInfo[]> {
        EnhancedLogger.debug('BLEManager', 'List files method called');
        this.ensureCommunicationManager();

        try {
            const files = await this.communicationManager!.listFiles();
            EnhancedLogger.info('BLEManager', 'Files listed successfully', { filesCount: files.length });
            return files;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to list files', error as BLEError);
            this.handleError(error as BLEError, 'list_files');
            throw error;
        }
    }

    async deleteFile(filename: string): Promise<boolean> {
        EnhancedLogger.debug('BLEManager', 'Delete file method called', { filename });
        this.ensureCommunicationManager();

        try {
            const success = await this.communicationManager!.deleteFile(filename);
            EnhancedLogger.info('BLEManager', 'File deleted successfully', { filename, success });
            return success;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to delete file', error as BLEError);
            this.handleError(error as BLEError, 'delete_file');
            throw error;
        }
    }

    async sendCommand(command: BLECommand, params?: string): Promise<BLEResponse> {
        EnhancedLogger.debug('BLEManager', 'Send command method called', { command, params });
        this.ensureCommunicationManager();

        try {
            const response = await this.communicationManager!.writeCommand(command, params);
            EnhancedLogger.info('BLEManager', 'Command sent successfully', { command, response });
            return response;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to send command', error as BLEError);
            this.handleError(error as BLEError, 'send_command');
            throw error;
        }
    }

    getConnectionState(): ConnectionState {
        EnhancedLogger.debug('BLEManager', 'Get connection state method called');
        return this.connectionManager.getConnectionState();
    }

    getDeviceMetrics(): DeviceConnectionMetrics | null {
        EnhancedLogger.debug('BLEManager', 'Get device metrics method called');
        return this.connectionManager.getDeviceMetrics();
    }

    getCurrentDevice(): Device | null {
        EnhancedLogger.debug('BLEManager', 'Get current device method called');
        return this.connectionManager.getCurrentDevice();
    }

    async isDeviceConnected(deviceId: string): Promise<boolean> {
        EnhancedLogger.debug('BLEManager', 'Is device connected method called', { deviceId });
        return this.connectionManager.isDeviceConnected(deviceId);
    }

    async disconnect(): Promise<void> {
        EnhancedLogger.debug('BLEManager', 'Disconnect method called');
        try {
            if (this.communicationManager) {
                EnhancedLogger.debug('BLEManager', 'Cleaning up communication manager');
                this.communicationManager.cleanup();
                this.communicationManager = null;
            }

            await this.connectionManager.disconnect();

            EnhancedLogger.debug('BLEManager', 'Notifying connection state change');
            if (this.events.onConnectionStateChange) {
                this.events.onConnectionStateChange(this.connectionManager.getConnectionState());
            }

            EnhancedLogger.info('BLEManager', 'Disconnection successful');
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Disconnection failed', error as BLEError);
            this.handleError(error as BLEError, 'disconnect');
            throw error;
        }
    }

    async updateRSSI(): Promise<number> {
        EnhancedLogger.debug('BLEManager', 'Update RSSI method called');
        try {
            const rssi = await this.connectionManager.readRSSI();
            if (this.events.onRssiUpdate) {
                this.events.onRssiUpdate(rssi);
            }
            return rssi;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to update RSSI', error as BLEError);
            this.handleError(error as BLEError, 'update_rssi');
            throw error;
        }
    }

    async requestMTUChange(mtu: number): Promise<number> {
        EnhancedLogger.debug('BLEManager', 'Request MTU change method called', { mtu });
        try {
            const newMTU = await this.connectionManager.requestMTU(mtu);
            if (this.events.onMtuChange) {
                this.events.onMtuChange(newMTU);
            }
            return newMTU;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to change MTU', error as BLEError);
            this.handleError(error as BLEError, 'change_mtu');
            throw error;
        }
    }

    async getConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
        EnhancedLogger.debug('BLEManager', 'Get connection diagnostics method called');
        try {
            return await this.connectionManager.getDiagnostics();
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to get connection diagnostics', error as BLEError);
            this.handleError(error as BLEError, 'get_diagnostics');
            throw error;
        }
    }

    async getStorageSpace(): Promise<StorageSpace> {
        EnhancedLogger.debug('BLEManager', 'Get storage space method called');
        this.ensureCommunicationManager();

        try {
            const space = await this.communicationManager!.getStorageSpace();
            EnhancedLogger.info('BLEManager', 'Storage space retrieved successfully', space);
            return space;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to get storage space', error as BLEError);
            this.handleError(error as BLEError, 'get_storage_space');
            throw error;
        }
    }

    destroy(): void {
        EnhancedLogger.debug('BLEManager', 'Destroy method called');
        EnhancedLogger.info('BLEManager', 'Destroying BLEManager instance');

        if (this.communicationManager) {
            this.communicationManager.cleanup();
            this.communicationManager = null;
        }

        this.connectionManager.destroy();
        this.events = {};
    }

    private ensureCommunicationManager(): void {
        EnhancedLogger.debug('BLEManager', 'Ensuring communication manager');
        if (!this.communicationManager) {
            const error = new Error('No active connection. Please connect to a device first.');
            EnhancedLogger.error('BLEManager', 'Communication manager not initialized', error);
            throw error;
        }
    }

    private handleError(error: BLEError, context: string): void {
        EnhancedLogger.debug('BLEManager', 'Handling error', { 
            context, 
            errorMessage: error.message,
            errorName: error.name,
            errorStack: error.stack,
            errorCode: error.errorCode,
            deviceId: error.deviceId,
            serviceUUID: error.serviceUUID,
            characteristicUUID: error.characteristicUUID,
            descriptorUUID: error.descriptorUUID,
        });
        if (this.events.onError) {
            this.events.onError(error, context);
        }
    }
}

let bleManagerInstance: BLEManager | null = null;

export const getBLEManager = async (options?: BLEOptions): Promise<BLEManager> => {
    EnhancedLogger.debug('BLEManager', 'Get BLE Manager called', { options });
    if (!bleManagerInstance) {
        EnhancedLogger.debug('BLEManager', 'Creating new BLEManager instance');
        try {
            bleManagerInstance = new BLEManager(options);
            await bleManagerInstance.initialize();
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Failed to create or initialize BLEManager', error as Error);
            throw error;
        }
    }
    return bleManagerInstance;
};

export const destroyBLEManager = (): void => {
    EnhancedLogger.debug('BLEManager', 'Destroy BLE Manager called');
    if (bleManagerInstance) {
        bleManagerInstance.destroy();
        bleManagerInstance = null;
    }
};

export default BLEManager;
