// BLETypes.ts
import { Device } from 'react-native-ble-plx';

export interface BLEOptions {
    timeout?: number;
    retries?: number;
    mtu?: number;
}

export interface ConnectionState {
    connected: boolean;
    connecting: boolean;
    error: string | null;
    rssi?: number;
    mtu?: number;
    lastConnectedTime?: number;
    connectionAttempts: number;
}

export interface DeviceConnectionMetrics {
    rssi: number;
    mtu: number;
    txPower?: number;
    connectionInterval?: number;
    latency?: number;
    supervisionTimeout?: number;
    signalStrength: 'Excellent' | 'Good' | 'Fair' | 'Poor';
    stability: 'Stable' | 'Moderate' | 'Unstable';
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

export interface OperationTiming {
    operationId: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    type: string;
    status: 'started' | 'completed' | 'failed';
    error?: Error;
    metadata?: any; // This allows us to store file transfer metadata
}

export interface ConnectionDiagnostics {
    rssi: number;
    mtu: number;
    connectionTime: number;
    totalOperations: number;
    completedOperations: number;
    failedOperations: number;
    averageOperationTime: number;
    connectionAttempts: number;
    lastError: string | null;
    fileTransfers: {
        total: number;
        successful: number;
        failed: number;
        averageSpeed: number;
    };
}

export type DiagnosticsCallback = (diagnostics: ConnectionDiagnostics) => void;

export interface BLEManagerEvents {
    onConnectionStateChange?: (state: ConnectionState) => void;
    onTransferProgress?: (progress: TransferProgress) => void;
    onError?: (error: Error, context: string) => void;
    onDeviceFound?: (device: Device) => void;
}

// New interfaces based on Arduino code

export interface StorageSpace {
    total: number;
    used: number;
}

export interface BLECommands {
    LIST: 'LIST';
    DELETE: 'DELETE';
    SPACE: 'SPACE';
    START: 'START';
    END: 'END';
}

export interface BLEResponses {
    OK: 'OK';
    FAIL: 'FAIL';
    READY: 'READY';
    ERROR: 'ERROR';
    DONE: 'DONE';
}

export interface FileTransferMetadata {
    filename: string;
    size: number;
}