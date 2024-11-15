// src/services/index.ts
export { BLEManager, getBLEManager, destroyBLEManager } from './BLEManager';
export type { 
    BLEOptions,
    ConnectionState,
    DeviceConnectionMetrics,
    FileInfo,
    TransferProgress,
    BLEManagerEvents 
} from './BLETypes';