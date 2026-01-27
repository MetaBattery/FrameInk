/**
 * services/WifiConnectionManager.ts
 *
 * This file contains the WifiConnectionManager class which manages the WiFi connection
 * state and provides access to the WifiRestApiClient for file operations.
 * It follows the same singleton pattern as BLEConnectionManager.
 */

import { EnhancedLogger } from './EnhancedLogger';
import { WifiRestApiClient } from './WifiRestApiClient';

export class WifiConnectionManager {
  private apiClient: WifiRestApiClient | null = null;
  private deviceIp: string | null = null;
  private _isConnected: boolean = false;

  constructor() {
    EnhancedLogger.debug('WifiConnectionManager', 'Initialized');
  }

  /**
   * Sets up the WiFi connection with the device IP address.
   * @param ipAddress The IP address of the device.
   */
  connect(ipAddress: string): void {
    EnhancedLogger.debug('WifiConnectionManager', 'Connecting', { ipAddress });
    this.deviceIp = ipAddress;
    this.apiClient = new WifiRestApiClient(ipAddress);
    this._isConnected = true;
    EnhancedLogger.info('WifiConnectionManager', 'Connected', { ipAddress });
  }

  /**
   * Disconnects from the WiFi device.
   */
  disconnect(): void {
    EnhancedLogger.debug('WifiConnectionManager', 'Disconnecting');
    this.apiClient = null;
    this.deviceIp = null;
    this._isConnected = false;
    EnhancedLogger.info('WifiConnectionManager', 'Disconnected');
  }

  /**
   * Returns the API client for making requests.
   * @returns The WifiRestApiClient instance or null if not connected.
   */
  getApiClient(): WifiRestApiClient | null {
    return this.apiClient;
  }

  /**
   * Returns the device IP address.
   * @returns The IP address or null if not connected.
   */
  getDeviceIp(): string | null {
    return this.deviceIp;
  }

  /**
   * Checks if WiFi is connected.
   * @returns True if connected, false otherwise.
   */
  isConnected(): boolean {
    return this._isConnected && this.apiClient !== null;
  }

  /**
   * Checks if the device is reachable via the API.
   * @returns A promise that resolves to true if reachable, false otherwise.
   */
  async isReachable(timeout = 5000): Promise<boolean> {
    if (!this.apiClient) {
      return false;
    }
    try {
      return await this.apiClient.isReachable(timeout);
    } catch (error) {
      EnhancedLogger.error('WifiConnectionManager', 'Reachability check failed', error as Error);
      return false;
    }
  }
}

// Export a shared instance so that all screens use the same WiFi connection manager.
export const sharedWifiConnectionManager = new WifiConnectionManager();
