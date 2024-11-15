// BLECommunicationManager.ts

import { Device, Characteristic } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import { EnhancedLogger } from './EnhancedLogger';
import { OperationTracker } from './BLEOperationTracker';
import { 
    TransferProgress, 
    FileInfo,
    ConnectionDiagnostics 
} from './BLETypes';

export class BLECommunicationManager extends OperationTracker {
    private readonly SERVICE_UUID: string = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
    private readonly FILE_CHAR_UUID: string = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
    private readonly COMMAND_CHAR_UUID: string = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';
    private CHUNK_SIZE: number = 512;
    private transferProgress?: TransferProgress;
    private transferListeners: ((progress: TransferProgress) => void)[] = [];
    private subscriptions: { remove: () => void }[] = [];
    private fileCharacteristic?: Characteristic;
    private commandCharacteristic?: Characteristic;

    constructor(private device: Device) {
        super();
        EnhancedLogger.info('BLECommunicationManager', 'Instance created', {
            deviceId: device.id,
            deviceName: device.name
        });
    }

    async setupNotifications(): Promise<void> {
        const notificationOperationId = this.generateTransactionId();
        this.trackOperation('setup_notifications', notificationOperationId);

        try {
            EnhancedLogger.debug('BLECommunicationManager', 'Setting up notifications');
            const setupStartTime = Date.now();

            // Discover services and characteristics
            await this.device.discoverAllServicesAndCharacteristics();
            const services = await this.device.services();
            
            const service = services.find(s => s.uuid === this.SERVICE_UUID);
            if (!service) {
                throw new Error('Required service not found');
            }

            const characteristics = await service.characteristics();
            this.fileCharacteristic = characteristics.find(c => c.uuid === this.FILE_CHAR_UUID);
            this.commandCharacteristic = characteristics.find(c => c.uuid === this.COMMAND_CHAR_UUID);

            if (!this.fileCharacteristic || !this.commandCharacteristic) {
                throw new Error('Required characteristics not found');
            }

            // Setup file notifications
            const fileSub = await this.setupCharacteristicNotification(
                this.fileCharacteristic,
                this.handleFileNotification.bind(this)
            );

            // Setup command notifications
            const commandSub = await this.setupCharacteristicNotification(
                this.commandCharacteristic,
                this.handleCommandNotification.bind(this)
            );

            this.subscriptions.push(fileSub, commandSub);

            const setupDuration = Date.now() - setupStartTime;
            EnhancedLogger.info('BLECommunicationManager', 'Notifications setup complete', {
                duration: `${setupDuration}ms`
            });

            this.completeOperation(notificationOperationId);
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'Failed to setup notifications', error as Error);
            this.completeOperation(notificationOperationId, error as Error);
            throw error;
        }
    }

    private async setupCharacteristicNotification(
        characteristic: Characteristic,
        handler: (data: string) => void
    ): Promise<{ remove: () => void }> {
        await characteristic.startNotifications();

        const subscription = characteristic.monitor((error, char) => {
            if (error) {
                EnhancedLogger.error('BLECommunicationManager', 'Notification error', error as Error, {
                    characteristicUUID: characteristic.uuid
                });
                return;
            }

            if (char?.value) {
                const data = Buffer.from(char.value, 'base64').toString('utf8');
                handler(data);
            }
        });

        return subscription;
    }

    async writeCommand(command: string): Promise<void> {
        if (!this.commandCharacteristic) {
            throw new Error('Command characteristic not initialized');
        }

        const writeOperationId = this.generateTransactionId();
        this.trackOperation('write_command', writeOperationId);

        try {
            EnhancedLogger.debug('BLECommunicationManager', 'Writing command', { command });
            const data = Buffer.from(command).toString('base64');
            
            await this.commandCharacteristic.writeWithResponse(data);
            
            EnhancedLogger.debug('BLECommunicationManager', 'Command written successfully', {
                command,
                dataLength: command.length
            });

            this.completeOperation(writeOperationId);
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'Write command failed', error as Error);
            this.completeOperation(writeOperationId, error as Error);
            throw error;
        }
    }

    async listFiles(): Promise<FileInfo[]> {
        const listOperationId = this.generateTransactionId();
        this.trackOperation('list_files', listOperationId);

        try {
            EnhancedLogger.info('BLECommunicationManager', 'Starting file list operation');
            
            await this.writeCommand('LIST');
            
            return new Promise<FileInfo[]>((resolve, reject) => {
                let fileListData = '';
                let timeoutHandle: NodeJS.Timeout;

                const fileNotificationHandler = (data: string) => {
                    fileListData += data;
                    if (fileListData.includes('END_LIST')) {
                        clearTimeout(timeoutHandle);
                        const files = this.parseFileList(fileListData);
                        this.completeOperation(listOperationId);
                        resolve(files);
                    }
                };

                timeoutHandle = setTimeout(() => {
                    const error = new Error('File list operation timed out');
                    this.completeOperation(listOperationId, error);
                    reject(error);
                }, 10000);

                this.fileCharacteristic?.monitor((error, characteristic) => {
                    if (error) {
                        clearTimeout(timeoutHandle);
                        this.completeOperation(listOperationId, error as Error);
                        reject(error);
                        return;
                    }

                    if (characteristic?.value) {
                        const data = Buffer.from(characteristic.value, 'base64').toString('utf8');
                        fileNotificationHandler(data);
                    }
                });
            });
        } catch (error) {
            this.completeOperation(listOperationId, error as Error);
            throw error;
        }
    }

    private parseFileList(data: string): FileInfo[] {
        const fileList: FileInfo[] = [];
        const fileData = data.replace('END_LIST', '');
        const entries = fileData.split(';').filter(entry => entry.trim());

        for (const entry of entries) {
            const [name, size] = entry.split(',');
            if (name && size) {
                fileList.push({
                    name: name.trim(),
                    size: parseInt(size.trim(), 10)
                });
            }
        }

        return fileList;
    }

    async deleteFile(filename: string): Promise<boolean> {
        const deleteOperationId = this.generateTransactionId();
        this.trackOperation('delete_file', deleteOperationId);

        try {
            EnhancedLogger.info('BLECommunicationManager', 'Starting file deletion', { filename });
            
            await this.writeCommand(`DELETE ${filename}`);
            
            return new Promise<boolean>((resolve, reject) => {
                const timeoutHandle = setTimeout(() => {
                    const error = new Error('File deletion timed out');
                    this.completeOperation(deleteOperationId, error);
                    reject(error);
                }, 5000);

                this.commandCharacteristic?.monitor((error, characteristic) => {
                    if (error) {
                        clearTimeout(timeoutHandle);
                        this.completeOperation(deleteOperationId, error as Error);
                        reject(error);
                        return;
                    }

                    if (characteristic?.value) {
                        const response = Buffer.from(characteristic.value, 'base64').toString('utf8');
                        clearTimeout(timeoutHandle);
                        const success = response === 'DELETE_OK';
                        this.completeOperation(deleteOperationId);
                        resolve(success);
                    }
                });
            });
        } catch (error) {
            this.completeOperation(deleteOperationId, error as Error);
            throw error;
        }
    }

    addTransferListener(callback: (progress: TransferProgress) => void): void {
        this.transferListeners.push(callback);
    }

    removeTransferListener(callback: (progress: TransferProgress) => void): void {
        this.transferListeners = this.transferListeners.filter(listener => listener !== callback);
    }

    private handleFileNotification(data: string): void {
        try {
            const notificationId = this.generateTransactionId();
            EnhancedLogger.debug('BLECommunicationManager', 'Processing file notification', {
                notificationId,
                dataLength: data.length
            });

            // Process file data according to your protocol
            // This is just an example:
            if (data.startsWith('TRANSFER:')) {
                const [, bytesTransferred, totalBytes] = data.split(':');
                this.updateTransferProgress(parseInt(bytesTransferred), parseInt(totalBytes));
            }
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'Error handling file notification', error as Error);
        }
    }

    private handleCommandNotification(data: string): void {
        try {
            const notificationId = this.generateTransactionId();
            EnhancedLogger.debug('BLECommunicationManager', 'Processing command notification', {
                notificationId,
                command: data
            });

            // Process command according to your protocol
            switch (data) {
                case 'READY':
                    // Handle ready state
                    break;
                case 'BUSY':
                    // Handle busy state
                    break;
                // Add other command handlers
            }
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'Error handling command notification', error as Error);
        }
    }

    private updateTransferProgress(bytesTransferred: number, totalBytes: number): void {
        const progress: TransferProgress = {
            bytesTransferred,
            totalBytes,
            startTime: this.transferProgress?.startTime || Date.now(),
            currentSpeed: this.calculateTransferSpeed(bytesTransferred)
        };

        this.transferProgress = progress;
        this.notifyTransferListeners(progress);
    }

    private calculateTransferSpeed(bytesTransferred: number): number {
        if (!this.transferProgress?.startTime) return 0;
        const duration = (Date.now() - this.transferProgress.startTime) / 1000; // in seconds
        return duration > 0 ? bytesTransferred / duration : 0;
    }

    private notifyTransferListeners(progress: TransferProgress): void {
        this.transferListeners.forEach(listener => {
            try {
                listener(progress);
            } catch (error) {
                EnhancedLogger.error('BLECommunicationManager', 'Transfer listener error', error as Error);
            }
        });
    }

    protected async runConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
        // Implement diagnostics specific to communication
        throw new Error('Method not implemented.');
    }

    cleanup(): void {
        this.subscriptions.forEach(sub => {
            try {
                sub.remove();
            } catch (error) {
                EnhancedLogger.warn('BLECommunicationManager', 'Error removing subscription', {
                    error
                });
            }
        });
        this.subscriptions = [];
        this.transferListeners = [];
    }
}