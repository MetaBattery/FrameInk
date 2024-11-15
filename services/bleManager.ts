// BLEManager.ts

import { Device } from 'react-native-ble-plx';
import { BLEConnectionManager } from './BLEConnectionManager';
import { BLECommunicationManager } from './BLECommunicationManager';
import { EnhancedLogger } from './EnhancedLogger';
import {
    BLEOptions,
    BLEManagerEvents,
    ConnectionState,
    DeviceConnectionMetrics,
    FileInfo,
    TransferProgress
} from './BLETypes';

export class BLEManager {
    private connectionManager: BLEConnectionManager;
    private communicationManager: BLECommunicationManager | null = null;
    private events: BLEManagerEvents = {};

    constructor(options?: BLEOptions) {
        this.connectionManager = new BLEConnectionManager(options);
        
        EnhancedLogger.info('BLEManager', 'Main manager instance created', { options });
    }

    // Event handling methods
    setEventHandlers(events: BLEManagerEvents): void {
        this.events = events;
    }

    // Initialization
    async initialize(): Promise<boolean> {
        try {
            const initialized = await this.connectionManager.initialize();
            EnhancedLogger.info('BLEManager', 'Initialization complete', { success: initialized });
            return initialized;
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Initialization failed', error as Error);
            this.handleError(error as Error, 'initialization');
            throw error;
        }
    }

    // Scanning
    async startScan(): Promise<void> {
        try {
            const devices = await this.connectionManager.scanForDevices();
            
            if (devices.length > 0) {
                const device = devices[0]; // Get the first found device
                if (this.events.onDeviceFound) {
                    this.events.onDeviceFound(device);
                }
                await this.connectToDevice(device);
            }
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Scan failed', error as Error);
            this.handleError(error as Error, 'scan');
            throw error;
        }
    }

    // Connection
    async connectToDevice(device: Device): Promise<void> {
        try {
            await this.connectionManager.connectToDevice(device);
            
            // Create communication manager after successful connection
            this.communicationManager = new BLECommunicationManager(device);
            await this.communicationManager.setupNotifications();

            // Set up transfer progress listener
            this.communicationManager.addTransferListener((progress) => {
                if (this.events.onTransferProgress) {
                    this.events.onTransferProgress(progress);
                }
            });

            // Notify connection state change
            if (this.events.onConnectionStateChange) {
                this.events.onConnectionStateChange(this.connectionManager.getConnectionState());
            }

        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Connection failed', error as Error);
            this.handleError(error as Error, 'connection');
            throw error;
        }
    }

    // File operations
    async listFiles(): Promise<FileInfo[]> {
        this.ensureCommunicationManager();
        
        try {
            return await this.communicationManager!.listFiles();
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'List files failed', error as Error);
            this.handleError(error as Error, 'list_files');
            throw error;
        }
    }

    async deleteFile(filename: string): Promise<boolean> {
        this.ensureCommunicationManager();
        
        try {
            return await this.communicationManager!.deleteFile(filename);
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Delete file failed', error as Error);
            this.handleError(error as Error, 'delete_file');
            throw error;
        }
    }

    // Command operations
    async sendCommand(command: string): Promise<void> {
        this.ensureCommunicationManager();
        
        try {
            await this.communicationManager!.writeCommand(command);
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Send command failed', error as Error);
            this.handleError(error as Error, 'send_command');
            throw error;
        }
    }

    // State getters
    getConnectionState(): ConnectionState {
        return this.connectionManager.getConnectionState();
    }

    getDeviceMetrics(): DeviceConnectionMetrics | null {
        return this.connectionManager.getDeviceMetrics();
    }

    getCurrentDevice(): Device | null {
        return this.connectionManager.getCurrentDevice();
    }

    // Cleanup and disconnection
    async disconnect(): Promise<void> {
        try {
            if (this.communicationManager) {
                this.communicationManager.cleanup();
                this.communicationManager = null;
            }
            
            await this.connectionManager.disconnect();
            
            if (this.events.onConnectionStateChange) {
                this.events.onConnectionStateChange(this.connectionManager.getConnectionState());
            }
        } catch (error) {
            EnhancedLogger.error('BLEManager', 'Disconnect failed', error as Error);
            this.handleError(error as Error, 'disconnect');
            throw error;
        }
    }

    destroy(): void {
        EnhancedLogger.info('BLEManager', 'Destroying manager');
        
        if (this.communicationManager) {
            this.communicationManager.cleanup();
            this.communicationManager = null;
        }
        
        this.connectionManager.destroy();
        this.events = {};
    }

    // Helper methods
    private ensureCommunicationManager(): void {
        if (!this.communicationManager) {
            throw new Error('No active connection. Please connect to a device first.');
        }
    }

    private handleError(error: Error, context: string): void {
        if (this.events.onError) {
            this.events.onError(error, context);
        }
    }
}

// Singleton instance management
let bleManagerInstance: BLEManager | null = null;

export const getBLEManager = async (options?: BLEOptions): Promise<BLEManager> => {
    if (!bleManagerInstance) {
        bleManagerInstance = new BLEManager(options);
        await bleManagerInstance.initialize();
    }
    return bleManagerInstance;
};

export const destroyBLEManager = (): void => {
    if (bleManagerInstance) {
        bleManagerInstance.destroy();
        bleManagerInstance = null;
    }
};

export default BLEManager;