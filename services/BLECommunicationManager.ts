// BLECommunicationManager.ts

import { Device, Characteristic } from 'react-native-ble-plx';
import base64 from 'react-native-base64';
import { EnhancedLogger } from './EnhancedLogger';
import { OperationTracker } from './BLEOperationTracker';
import { 
    TransferProgress, 
    FileInfo,
    ConnectionDiagnostics,
    BLECommands,
    BLEResponses,
    StorageSpace,
    FileTransferMetadata
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

            EnhancedLogger.debug('BLECommunicationManager', 'Discovering services and characteristics');
            await this.device.discoverAllServicesAndCharacteristics();
            
            EnhancedLogger.debug('BLECommunicationManager', 'Getting services');
            const services = await this.device.services();
            EnhancedLogger.debug('BLECommunicationManager', `Found ${services.length} services`);
            
            const service = services.find(s => s.uuid === this.SERVICE_UUID);
            if (!service) {
                throw new Error(`Required service ${this.SERVICE_UUID} not found`);
            }

            EnhancedLogger.debug('BLECommunicationManager', 'Getting characteristics');
            const characteristics = await service.characteristics();
            EnhancedLogger.debug('BLECommunicationManager', `Found ${characteristics.length} characteristics`);

            this.fileCharacteristic = characteristics.find(c => c.uuid === this.FILE_CHAR_UUID);
            this.commandCharacteristic = characteristics.find(c => c.uuid === this.COMMAND_CHAR_UUID);

            if (!this.fileCharacteristic || !this.commandCharacteristic) {
                throw new Error('Required characteristics not found');
            }

            EnhancedLogger.debug('BLECommunicationManager', 'Setting up file notifications');
            const fileSub = await this.setupCharacteristicNotification(
                this.fileCharacteristic,
                this.handleFileNotification.bind(this)
            );

            EnhancedLogger.debug('BLECommunicationManager', 'Setting up command notifications');
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
        try {
            EnhancedLogger.debug('BLECommunicationManager', 'Starting notifications', { characteristicUUID: characteristic.uuid });
            await characteristic.startNotifications();

            EnhancedLogger.debug('BLECommunicationManager', 'Setting up monitor', { characteristicUUID: characteristic.uuid });
            const subscription = characteristic.monitor((error, char) => {
                if (error) {
                    EnhancedLogger.error('BLECommunicationManager', 'Notification error', error as Error, {
                        characteristicUUID: characteristic.uuid
                    });
                    return;
                }

                if (char?.value) {
                    const data = base64.decode(char.value);
                    EnhancedLogger.debug('BLECommunicationManager', 'Received notification', {
                        characteristicUUID: characteristic.uuid,
                        dataLength: data.length
                    });
                    handler(data);
                }
            });

            EnhancedLogger.debug('BLECommunicationManager', 'Notification setup complete', { characteristicUUID: characteristic.uuid });
            return subscription;
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'Failed to setup characteristic notification', error as Error, {
                characteristicUUID: characteristic.uuid
            });
            throw error;
        }
    }

    async writeCommand(command: BLECommands | string): Promise<void> {
        if (!this.commandCharacteristic) {
            throw new Error('Command characteristic not initialized');
        }

        const writeOperationId = this.generateTransactionId();
        this.trackOperation('write_command', writeOperationId);

        try {
            EnhancedLogger.debug('BLECommunicationManager', 'Writing command', { command });
            const encodedCommand = base64.encode(command);
            
            await this.commandCharacteristic.writeWithResponse(encodedCommand);
            
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
            
            await this.writeCommand(BLECommands.LIST);
            
            return new Promise<FileInfo[]>((resolve, reject) => {
                let fileListData = '';
                let timeoutHandle: NodeJS.Timeout;

                const fileNotificationHandler = (data: string) => {
                    fileListData += data;
                    EnhancedLogger.debug('BLECommunicationManager', 'Received file list data', { dataLength: data.length });
                    if (fileListData.includes('END_LIST')) {
                        clearTimeout(timeoutHandle);
                        const files = this.parseFileList(fileListData);
                        EnhancedLogger.info('BLECommunicationManager', 'File list received', { fileCount: files.length });
                        this.completeOperation(listOperationId);
                        resolve(files);
                    }
                };

                timeoutHandle = setTimeout(() => {
                    const error = new Error('File list operation timed out');
                    EnhancedLogger.error('BLECommunicationManager', 'File list operation timed out');
                    this.completeOperation(listOperationId, error);
                    reject(error);
                }, 10000);

                if (this.fileCharacteristic) {
                    this.fileCharacteristic.monitor((error, characteristic) => {
                        if (error) {
                            clearTimeout(timeoutHandle);
                            EnhancedLogger.error('BLECommunicationManager', 'File characteristic monitor error', error as Error);
                            this.completeOperation(listOperationId, error as Error);
                            reject(error);
                            return;
                        }

                        if (characteristic?.value) {
                            const data = base64.decode(characteristic.value);
                            fileNotificationHandler(data);
                        }
                    });
                } else {
                    const error = new Error('File characteristic not initialized');
                    EnhancedLogger.error('BLECommunicationManager', 'File characteristic not initialized');
                    this.completeOperation(listOperationId, error);
                    reject(error);
                }
            });
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'List files operation failed', error as Error);
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
            
            await this.writeCommand(`${BLECommands.DELETE}:${filename}`);
            
            return new Promise<boolean>((resolve, reject) => {
                const timeoutHandle = setTimeout(() => {
                    const error = new Error('File deletion timed out');
                    EnhancedLogger.error('BLECommunicationManager', 'File deletion timed out', { filename });
                    this.completeOperation(deleteOperationId, error);
                    reject(error);
                }, 5000);

                if (this.commandCharacteristic) {
                    this.commandCharacteristic.monitor((error, characteristic) => {
                        if (error) {
                            clearTimeout(timeoutHandle);
                            EnhancedLogger.error('BLECommunicationManager', 'Command characteristic monitor error', error as Error);
                            this.completeOperation(deleteOperationId, error as Error);
                            reject(error);
                            return;
                        }

                        if (characteristic?.value) {
                            const response = base64.decode(characteristic.value);
                            clearTimeout(timeoutHandle);
                            const success = response === BLEResponses.OK;
                            EnhancedLogger.info('BLECommunicationManager', 'File deletion response', { success, filename });
                            this.completeOperation(deleteOperationId);
                            resolve(success);
                        }
                    });
                } else {
                    const error = new Error('Command characteristic not initialized');
                    EnhancedLogger.error('BLECommunicationManager', 'Command characteristic not initialized');
                    this.completeOperation(deleteOperationId, error);
                    reject(error);
                }
            });
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'Delete file operation failed', error as Error);
            this.completeOperation(deleteOperationId, error as Error);
            throw error;
        }
    }

    async getStorageSpace(): Promise<StorageSpace> {
        const spaceOperationId = this.generateTransactionId();
        this.trackOperation('get_storage_space', spaceOperationId);

        try {
            EnhancedLogger.info('BLECommunicationManager', 'Retrieving storage space information');
            
            await this.writeCommand(BLECommands.SPACE);
            
            return new Promise<StorageSpace>((resolve, reject) => {
                const timeoutHandle = setTimeout(() => {
                    const error = new Error('Storage space retrieval timed out');
                    EnhancedLogger.error('BLECommunicationManager', 'Storage space retrieval timed out');
                    this.completeOperation(spaceOperationId, error);
                    reject(error);
                }, 5000);

                if (this.commandCharacteristic) {
                    this.commandCharacteristic.monitor((error, characteristic) => {
                        if (error) {
                            clearTimeout(timeoutHandle);
                            EnhancedLogger.error('BLECommunicationManager', 'Command characteristic monitor error', error as Error);
                            this.completeOperation(spaceOperationId, error as Error);
                            reject(error);
                            return;
                        }

                        if (characteristic?.value) {
                            const response = base64.decode(characteristic.value);
                            clearTimeout(timeoutHandle);
                            const [total, used] = response.split(',').map(Number);
                            const storageSpace: StorageSpace = { total, used };
                            EnhancedLogger.info('BLECommunicationManager', 'Storage space retrieved', storageSpace);
                            this.completeOperation(spaceOperationId);
                            resolve(storageSpace);
                        }
                    });
                } else {
                    const error = new Error('Command characteristic not initialized');
                    EnhancedLogger.error('BLECommunicationManager', 'Command characteristic not initialized');
                    this.completeOperation(spaceOperationId, error);
                    reject(error);
                }
            });
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'Get storage space operation failed', error as Error);
            this.completeOperation(spaceOperationId, error as Error);
            throw error;
        }
    }

    async transferFile(fileData: ArrayBuffer, filename: string): Promise<void> {
        const transferOperationId = this.generateTransactionId();
        this.trackOperation('file_transfer', transferOperationId);

        try {
            EnhancedLogger.info('BLECommunicationManager', 'Starting file transfer', { filename, size: fileData.byteLength });
            
            // Start file transfer
            await this.writeCommand(`${BLECommands.START}:${filename}`);
            await this.waitForResponse(BLEResponses.READY);

            // Transfer file in chunks
            const totalChunks = Math.ceil(fileData.byteLength / this.CHUNK_SIZE);
            for (let i = 0; i < totalChunks; i++) {
                const chunk = fileData.slice(i * this.CHUNK_SIZE, (i + 1) * this.CHUNK_SIZE);
                const encodedChunk = base64.encodeFromByteArray(new Uint8Array(chunk));
                await this.writeCommand(encodedChunk);
                await this.waitForResponse(BLEResponses.OK);
                
                this.updateTransferProgress((i + 1) * this.CHUNK_SIZE, fileData.byteLength);
            }

            // End file transfer
            await this.writeCommand(BLECommands.END);
            await this.waitForResponse(BLEResponses.DONE);

            EnhancedLogger.info('BLECommunicationManager', 'File transfer completed', { filename });
            this.completeOperation(transferOperationId);
        } catch (error) {
            EnhancedLogger.error('BLECommunicationManager', 'File transfer failed', error as Error);
            this.completeOperation(transferOperationId, error as Error);
            throw error;
        }
    }

    private async waitForResponse(expectedResponse: BLEResponses, timeout: number = 5000): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                reject(new Error(`Timeout waiting for response: ${expectedResponse}`));
            }, timeout);

            if (this.commandCharacteristic) {
                this.commandCharacteristic.monitor((error, characteristic) => {
                    if (error) {
                        clearTimeout(timeoutHandle);
                        reject(error);
                        return;
                    }

                    if (characteristic?.value) {
                        const response = base64.decode(characteristic.value);
                        if (response === expectedResponse) {
                            clearTimeout(timeoutHandle);
                            resolve();
                        }
                    }
                });
            } else {
                clearTimeout(timeoutHandle);
                reject(new Error('Command characteristic not initialized'));
            }
        });
    }

    addTransferListener(callback: (progress: TransferProgress) => void): void {
        this.transferListeners.push(callback);
        EnhancedLogger.debug('BLECommunicationManager', 'Transfer listener added', { listenerCount: this.transferListeners.length });
    }

    removeTransferListener(callback: (progress: TransferProgress) => void): void {
        this.transferListeners = this.transferListeners.filter(listener => listener !== callback);
        EnhancedLogger.debug('BLECommunicationManager', 'Transfer listener removed', { listenerCount: this.transferListeners.length });
    }

    private handleFileNotification(data: string): void {
        try {
            const notificationId = this.generateTransactionId();
            EnhancedLogger.debug('BLECommunicationManager', 'Processing file notification', {
                notificationId,
                dataLength: data.length
            });

            if (data.startsWith('TRANSFER:')) {
                const [, bytesTransferred, totalBytes] = data.split(':');
                this.updateTransferProgress(parseInt(bytesTransferred), parseInt(totalBytes));
            } else {
                EnhancedLogger.debug('BLECommunicationManager', 'Unhandled file notification', { data });
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

            switch (data) {
                case BLEResponses.READY:
                    EnhancedLogger.info('BLECommunicationManager', 'Device is ready');
                    break;
                case BLEResponses.OK:
                    EnhancedLogger.info('BLECommunicationManager', 'Operation successful');
                    break;
                case BLEResponses.FAIL:
                    EnhancedLogger.warn('BLECommunicationManager', 'Operation failed');
                    break;
                case BLEResponses.ERROR:
                    EnhancedLogger.error('BLECommunicationManager', 'Device reported an error');
                    break;
                case BLEResponses.DONE:
                    EnhancedLogger.info('BLECommunicationManager', 'Operation completed');
                    break;
                default:
                    EnhancedLogger.debug('BLECommunicationManager', 'Unhandled command notification', { data });
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
        EnhancedLogger.debug('BLECommunicationManager', 'Transfer progress updated', { 
            bytesTransferred, 
            totalBytes, 
            currentSpeed: progress.currentSpeed 
        });
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
        // This method should be implemented based on specific requirements
        // Here's a placeholder implementation
        const diagnostics: ConnectionDiagnostics = {
            rssi: await this.device.readRSSI(),
            mtu: (await this.device.mtu()) || 0,
            connectionTime: 0, // This should be tracked from the moment of connection
            totalOperations: this.operationTimings.length,
            completedOperations: this.operationTimings.filter(op => op.status === 'completed').length,
            failedOperations: this.operationTimings.filter(op => op.status === 'failed').length,
            averageOperationTime: this.calculateAverageOperationTime(),
            connectionAttempts: 1, // This should be tracked and incremented on each connection attempt
            lastError: this.operationTimings.find(op => op.status === 'failed')?.error?.message || null,
            fileTransfers: {
                total: this.operationTimings.filter(op => op.type === 'file_transfer').length,
                successful: this.operationTimings.filter(op => op.type === 'file_transfer' && op.status === 'completed').length,
                failed: this.operationTimings.filter(op => op.type === 'file_transfer' && op.status === 'failed').length,
                averageSpeed: 0 // This should be calculated based on completed file transfers
            }
        };

        return diagnostics;
    }

    cleanup(): void {
        EnhancedLogger.debug('BLECommunicationManager', 'Starting cleanup');
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
        EnhancedLogger.info('BLECommunicationManager', 'Cleanup completed');
    }
}