// BLEOperationTracker.ts

import { EnhancedLogger } from './EnhancedLogger';
import { 
    OperationTiming, 
    ConnectionDiagnostics,
    DiagnosticsCallback 
} from './BLETypes';

interface FileTransferMetadata {
    filename: string;
    size: number;
}

export abstract class OperationTracker {
    protected operationTimings: OperationTiming[] = [];
    protected diagnosticsInterval: NodeJS.Timer | null = null;
    protected diagnosticsCallbacks: DiagnosticsCallback[] = [];

    protected generateTransactionId(): string {
        return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    protected trackOperation(type: string, operationId: string): void {
        const timing: OperationTiming = {
            operationId,
            startTime: Date.now(),
            type,
            status: 'started'
        };
        
        this.operationTimings.push(timing);
        EnhancedLogger.debug('OperationTracker', 'Operation started', {
            operationId,
            type,
            timestamp: new Date(timing.startTime).toISOString()
        });
    }

    protected trackFileTransfer(filename: string, size: number): string {
        const operationId = this.generateTransactionId();
        const timing: OperationTiming = {
            operationId,
            startTime: Date.now(),
            type: 'file_transfer',
            status: 'started',
            metadata: { filename, size } as FileTransferMetadata
        };
        
        this.operationTimings.push(timing);
        EnhancedLogger.debug('OperationTracker', 'File transfer started', {
            operationId,
            filename,
            size,
            timestamp: new Date(timing.startTime).toISOString()
        });
        
        return operationId;
    }

    protected completeOperation(operationId: string, error?: Error): void {
        const timing = this.operationTimings.find(t => t.operationId === operationId);
        if (timing) {
            timing.endTime = Date.now();
            timing.duration = timing.endTime - timing.startTime;
            timing.status = error ? 'failed' : 'completed';
            timing.error = error;

            const logData: any = {
                operationId,
                type: timing.type,
                duration: `${timing.duration}ms`,
                status: timing.status,
            };

            if (timing.type === 'file_transfer' && timing.metadata) {
                const metadata = timing.metadata as FileTransferMetadata;
                logData.filename = metadata.filename;
                logData.size = metadata.size;
                logData.transferSpeed = this.calculateTransferSpeed(operationId);
            }

            if (error) {
                logData.error = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                };
            }

            EnhancedLogger.debug('OperationTracker', 'Operation completed', logData);
        }
    }

    protected startDiagnosticsMonitoring(interval: number = 30000): void {
        if (this.diagnosticsInterval) {
            clearInterval(this.diagnosticsInterval);
        }

        this.diagnosticsInterval = setInterval(async () => {
            try {
                const diagnostics = await this.runConnectionDiagnostics();
                this.diagnosticsCallbacks.forEach(callback => {
                    try {
                        callback(diagnostics);
                    } catch (error) {
                        EnhancedLogger.error('OperationTracker', 'Diagnostics callback error', error as Error);
                    }
                });
            } catch (error) {
                EnhancedLogger.error('OperationTracker', 'Diagnostics monitoring failed', error as Error);
            }
        }, interval);
    }

    protected stopDiagnosticsMonitoring(): void {
        if (this.diagnosticsInterval) {
            clearInterval(this.diagnosticsInterval);
            this.diagnosticsInterval = null;
        }
    }

    protected calculateAverageOperationTime(): number {
        const completedOps = this.operationTimings.filter(t => t.duration);
        if (completedOps.length === 0) return 0;
        
        const totalTime = completedOps.reduce((sum, op) => sum + (op.duration || 0), 0);
        return Math.round(totalTime / completedOps.length);
    }

    protected calculateTransferSpeed(operationId: string): number {
        const timing = this.operationTimings.find(t => t.operationId === operationId);
        if (timing && timing.type === 'file_transfer' && timing.metadata && timing.duration) {
            const metadata = timing.metadata as FileTransferMetadata;
            const durationInSeconds = timing.duration / 1000;
            return metadata.size / durationInSeconds; // bytes per second
        }
        return 0;
    }

    protected async runConnectionDiagnostics(): Promise<ConnectionDiagnostics> {
        const fileTransfers = this.operationTimings.filter(t => t.type === 'file_transfer');
        const successfulTransfers = fileTransfers.filter(t => t.status === 'completed');
        const failedTransfers = fileTransfers.filter(t => t.status === 'failed');
        const totalTransferSpeed = successfulTransfers.reduce((sum, t) => sum + this.calculateTransferSpeed(t.operationId), 0);

        const completedOperations = this.operationTimings.filter(t => t.status === 'completed');
        const failedOperations = this.operationTimings.filter(t => t.status === 'failed');

        return {
            rssi: 0, // This should be implemented in a derived class
            mtu: 0, // This should be implemented in a derived class
            connectionTime: 0, // This should be implemented in a derived class
            totalOperations: this.operationTimings.length,
            completedOperations: completedOperations.length,
            failedOperations: failedOperations.length,
            averageOperationTime: this.calculateAverageOperationTime(),
            connectionAttempts: 0, // This should be implemented in a derived class
            lastError: this.operationTimings.filter(t => t.error).pop()?.error?.message || null,
            fileTransfers: {
                total: fileTransfers.length,
                successful: successfulTransfers.length,
                failed: failedTransfers.length,
                averageSpeed: successfulTransfers.length > 0 ? totalTransferSpeed / successfulTransfers.length : 0
            }
        };
    }

    public getOperationHistory(): OperationTiming[] {
        return [...this.operationTimings];
    }

    public addDiagnosticsCallback(callback: DiagnosticsCallback): void {
        this.diagnosticsCallbacks.push(callback);
    }

    public removeDiagnosticsCallback(callback: DiagnosticsCallback): void {
        this.diagnosticsCallbacks = this.diagnosticsCallbacks.filter(cb => cb !== callback);
    }

    public clearOperationHistory(): void {
        this.operationTimings = [];
    }
}