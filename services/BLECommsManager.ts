/**
 * services/BLECommsManager.ts
 * 
 * This file contains the BLECommsManager class which handles communication with the device
 * over BLE for file operations such as listing files, transferring files, deleting files,
 * and checking storage space.
 * 
 * It uses the react-native-ble-plx library for BLE operations.
 */

import { Device, Subscription } from 'react-native-ble-plx';
import { EnhancedLogger } from './enhancedLogger';
import { Buffer } from 'buffer'; // Ensure you have the 'buffer' package installed

// Define BLE Service and Characteristic UUIDs for the device.
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const FILE_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const COMMAND_CHAR_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a9';

// Interface for representing file information from the device.
export interface FileInfo {
  name: string;
  size: number;
}

export class BLECommsManager {
  private device: Device;

  /**
   * Constructs a new BLECommsManager instance.
   * @param device The BLE device to communicate with.
   */
  constructor(device: Device) {
    this.device = device;
    EnhancedLogger.debug('BLECommsManager', 'Initialized', { deviceId: device.id });
  }

  /**
   * List files on the device with a timeout retry mechanism.
   * @param timeout The maximum time to wait for listing files (in ms).
   * @returns A promise that resolves to an array of FileInfo objects.
   */
  async listFilesWithRetry(timeout = 10000): Promise<FileInfo[]> {
    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Listing files timed out'));
      }, timeout);

      try {
        const files = await this.listFiles();
        clearTimeout(timeoutId);
        resolve(files);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Initiates the file listing process by sending a "LIST" command to the device
   * and monitoring for file info notifications.
   * 
   * Since BLE notifications may be fragmented, this function accumulates incoming data
   * until complete messages (terminated by ";" or marked by "END_LIST") are received.
   * 
   * Expected file info messages are of the form: "filename.bin,filesize;".
   * 
   * @returns A promise that resolves to an array of FileInfo objects.
   */
  private async listFiles(): Promise<FileInfo[]> {
    EnhancedLogger.debug('BLECommsManager', 'Starting to list files');

    return new Promise<FileInfo[]>(async (resolve, reject) => {
      let subscription: Subscription | null = null;
      const files: FileInfo[] = [];
      let completed = false; // Indicates when the listing is finished
      let accumulatedData = ""; // Holds partial data across notifications

      subscription = this.device.monitorCharacteristicForService(
        SERVICE_UUID,
        FILE_CHAR_UUID,
        (error, characteristic) => {
          if (error) {
            // If we already completed the listing, ignore cancellation errors.
            if (
              completed &&
              error.message &&
              error.message.includes("Operation was cancelled")
            ) {
              return;
            }
            EnhancedLogger.error('BLECommsManager', 'Monitor error', error);
            if (subscription) {
              subscription.remove();
            }
            return reject(error);
          }
          if (!characteristic?.value) return; // Ignore empty notifications.

          // Convert the base64-encoded value to a UTF-8 string.
          let rawValue = Buffer.from(characteristic.value, 'base64').toString('utf-8');
          // Remove any null characters.
          rawValue = rawValue.replace(/\0/g, '').trim();

          EnhancedLogger.debug('BLECommsManager', 'Received file info fragment', { value: rawValue });

          // Check for the special END_LIST marker.
          if (rawValue === "END_LIST") {
            completed = true;
            EnhancedLogger.info('BLECommsManager', 'Files listed', { fileCount: files.length });
            if (subscription) subscription.remove();
            return resolve(files);
          }

          // Accumulate the received data.
          accumulatedData += rawValue;

          // Process any complete messages (delimited by semicolon).
          while (accumulatedData.indexOf(';') !== -1) {
            const delimiterIndex = accumulatedData.indexOf(';');
            const message = accumulatedData.substring(0, delimiterIndex).trim();
            // Remove the processed portion from accumulatedData.
            accumulatedData = accumulatedData.substring(delimiterIndex + 1);

            // Skip empty messages.
            if (message.length === 0) continue;

            // If the message is the END_LIST marker (in case it comes appended with a semicolon)
            if (message === "END_LIST") {
              completed = true;
              EnhancedLogger.info('BLECommsManager', 'Files listed', { fileCount: files.length });
              if (subscription) subscription.remove();
              return resolve(files);
            }

            // Expected format: "filename,filesize"
            const parts = message.split(',');
            if (parts.length >= 2) {
              const name = parts[0];
              const size = parseInt(parts[1], 10);
              if (name && !isNaN(size)) {
                files.push({ name, size });
                EnhancedLogger.debug('BLECommsManager', 'Parsed file info', { name, size });
              } else {
                EnhancedLogger.error('BLECommsManager', 'Invalid file info format', { message });
              }
            } else {
              EnhancedLogger.error('BLECommsManager', 'Incomplete file info received', { message });
            }
          }
        }
      );

      // Small delay to ensure the subscription is active before sending the command.
      await new Promise(resolve => setTimeout(resolve, 50));

      // Send the "LIST" command to start the file listing.
      try {
        await this.device.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          COMMAND_CHAR_UUID,
          Buffer.from('LIST').toString('base64')
        );
        EnhancedLogger.debug('BLECommsManager', 'LIST command sent');
      } catch (error) {
        if (subscription) subscription.remove();
        EnhancedLogger.error('BLECommsManager', 'List command write error', error as Error);
        return reject(error);
      }
    });
  }

  

  /**
   * Helper method to read a response from the FILE characteristic with a timeout.
   * @param expected The expected string response.
   * @param timeout The maximum time to wait for the response (in ms).
   */
  private async readResponse(expected: string, timeout = 5000): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for response: ${expected}`));
      }, timeout);
      try {
        const response = await this.device.readCharacteristicForService(SERVICE_UUID, FILE_CHAR_UUID);
        clearTimeout(timer);
        const responseStr = Buffer.from(response.value!, 'base64').toString('utf-8').trim();
        if (responseStr === expected) {
          EnhancedLogger.debug('BLECommsManager', `Received expected response: ${expected}`);
          resolve();
        } else {
          reject(new Error(`Unexpected response: ${responseStr} (expected: ${expected})`));
        }
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Transfers a file to the device in chunks.
   * 
   * Improvements:
   * - Uses a chunk size that matches the negotiated MTU (here set to 120 bytes).
   * - Adds extra delays after sending the START command and between each chunk.
   * - Uses a helper (readResponse) to wait for acknowledgments with a timeout.
   * - Appends a newline delimiter ("\n") after each base64–encoded chunk so that the device
   *   can reassemble fragmented writes.
   * 
   * @param filename The name of the file to create on the device.
   * @param data The file data as an ArrayBuffer.
   * @param onProgress Optional callback to report transfer progress.
   */
  async transferFile(filename: string, data: ArrayBuffer, onProgress?: (progress: number) => void): Promise<void> {
    // Adjust chunkSize to match the MTU in use. For MTU = 200, we use a chunk size of 120 bytes.
    const chunkSize = 120;
    EnhancedLogger.debug('BLECommsManager', 'Transferring file', { filename, size: data.byteLength, chunkSize });
    try {
      // --- START the file transfer ---
      const startCommand = `START:${filename}`;
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        FILE_CHAR_UUID,
        Buffer.from(startCommand).toString('base64')
      );
      // Increase the delay slightly to give the device time to process the start command.
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Wait for the device to signal that it is ready.
      await this.readResponse('READY', 5000);
      
      // --- Send file data in chunks ---
      const totalChunks = Math.ceil(data.byteLength / chunkSize);
  
      for (let i = 0; i < totalChunks; i++) {
        const chunk = new Uint8Array(data.slice(i * chunkSize, (i + 1) * chunkSize));
        // Encode the chunk to base64 and append a newline delimiter.
        const base64Chunk = Buffer.from(chunk).toString('base64') + "\n";
        await this.device.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          FILE_CHAR_UUID,
          Buffer.from(base64Chunk).toString('base64')
        );
  
        // Wait for an "OK" response for this chunk.
        await this.readResponse('OK', 3000);
  
        if (onProgress) {
          onProgress((i + 1) / totalChunks);
        }
  
        // A small delay to avoid overloading the device.
        await new Promise(resolve => setTimeout(resolve, 10));
      }
  
      // --- End file transfer ---
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        FILE_CHAR_UUID,
        Buffer.from('END').toString('base64')
      );
      await this.readResponse('DONE', 5000);
  
      EnhancedLogger.info('BLECommsManager', 'File transfer completed', { filename, size: data.byteLength });
    } catch (error) {
      EnhancedLogger.error('BLECommsManager', 'File transfer error', error as Error);
      throw error;
    }
  }
  
  /**
   * Deletes a file on the device.
   * @param filename The name of the file to delete.
   */
  async deleteFile(filename: string): Promise<void> {
    EnhancedLogger.debug('BLECommsManager', 'Deleting file', { filename });
    try {
      const command = `DELETE:${filename}`;
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        COMMAND_CHAR_UUID,
        Buffer.from(command).toString('base64')
      );

      // Read response from the device.
      const response = await this.device.readCharacteristicForService(SERVICE_UUID, COMMAND_CHAR_UUID);
      const value = Buffer.from(response.value!, 'base64').toString('utf-8').trim();

      // Check if deletion was successful.
      if (value !== 'OK') {
        throw new Error(`Failed to delete file: ${value}`);
      }

      EnhancedLogger.info('BLECommsManager', 'File deleted', { filename });
    } catch (error) {
      EnhancedLogger.error('BLECommsManager', 'Delete file error', error as Error);
      throw error;
    }
  }

  /**
   * Retrieves storage space information from the device.
   * @returns A promise that resolves to an object containing total and used storage bytes.
   */
  async getStorageSpace(): Promise<{ total: number; used: number }> {
    EnhancedLogger.debug('BLECommsManager', 'Getting storage space');
    try {
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        COMMAND_CHAR_UUID,
        Buffer.from('SPACE').toString('base64')
      );

      const response = await this.device.readCharacteristicForService(SERVICE_UUID, COMMAND_CHAR_UUID);
      const value = Buffer.from(response.value!, 'base64').toString('utf-8').trim();
      const [total, used] = value.split(',').map(Number);

      EnhancedLogger.info('BLECommsManager', 'Storage space retrieved', { total, used });
      return { total, used };
    } catch (error) {
      EnhancedLogger.error('BLECommsManager', 'Get storage space error', error as Error);
      throw error;
    }
  }

/**
 * Sends WiFi credentials to the device and gets back the IP address.
 * @param ssid The WiFi SSID to connect to.
 * @param password The WiFi password.
 * @returns A promise that resolves to the device's IP address when connected.
 */
async connectToWifi(ssid: string, password: string): Promise<string> {
  EnhancedLogger.debug('BLECommsManager', 'Connecting to WiFi', { ssid });
  
  return new Promise<string>(async (resolve, reject) => {
    let subscription: Subscription | null = null;
    let timeoutId: NodeJS.Timeout | null = null;
    let completed = false; // Flag to indicate whether we've already resolved or rejected

    try {
      // Set up a timeout to fail the connection after 30 seconds.
      timeoutId = setTimeout(() => {
        if (subscription) subscription.remove();
        if (!completed) {
          completed = true;
          reject(new Error('WiFi connection timeout'));
        }
      }, 30000);

      // Monitor for responses from the device.
      subscription = this.device.monitorCharacteristicForService(
        SERVICE_UUID,
        COMMAND_CHAR_UUID,
        (error, characteristic) => {
          if (error) {
            // If we've already completed and this is just a cancellation error, ignore it.
            if (completed && error.message && error.message.includes("Operation was cancelled")) {
              return;
            }
            if (timeoutId) clearTimeout(timeoutId);
            EnhancedLogger.error('BLECommsManager', 'WiFi connection monitor error', error);
            if (!completed) {
              completed = true;
              reject(error);
            }
            if (subscription) subscription.remove();
            return;
          }

          if (!characteristic?.value) return;

          const rawValue = Buffer.from(characteristic.value, 'base64').toString('utf-8').trim();
          EnhancedLogger.debug('BLECommsManager', 'Received WiFi response', { response: rawValue });

          if (rawValue.startsWith('W_IP:')) {
            const ipAddress = rawValue.substring(5).trim();
            EnhancedLogger.info('BLECommsManager', 'WiFi connected', { ipAddress });
            if (timeoutId) clearTimeout(timeoutId);
            if (!completed) {
              completed = true;
              resolve(ipAddress);
            }
            if (subscription) subscription.remove();
          } else if (rawValue.includes('ERROR')) {
            if (timeoutId) clearTimeout(timeoutId);
            if (!completed) {
              completed = true;
              reject(new Error('WiFi connection failed'));
            }
            if (subscription) subscription.remove();
          }
        }
      );

      // Send the WiFi credentials command.
      const command = `WIFI:${ssid},${password}`;
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        COMMAND_CHAR_UUID,
        Buffer.from(command).toString('base64')
      );
      EnhancedLogger.debug('BLECommsManager', 'WiFi credentials sent');
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      if (subscription) subscription.remove();
      EnhancedLogger.error('BLECommsManager', 'WiFi connection error', error as Error);
      reject(error);
    }
  });
}


}