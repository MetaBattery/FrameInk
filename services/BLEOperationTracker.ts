// BLEOperationTracker.ts
import { EnhancedLogger } from './EnhancedLogger';
import { 
    OperationTiming, 
    ConnectionDiagnostics,
    DiagnosticsCallback 
} from './BLETypes';

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

    protected completeOperation(operationId: string, error?: Error): void {
        const timing = this.operationTimings.find(t => t.operationId === operationId);
        if (timing) {
            timing.endTime = Date.now();
            timing.duration = timing.endTime - timing.startTime;
            timing.status = error ? 'failed' : 'completed';
            timing.error = error;

            EnhancedLogger.debug('OperationTracker', 'Operation completed', {
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

    protected abstract runConnectionDiagnostics(): Promise<ConnectionDiagnostics>;

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