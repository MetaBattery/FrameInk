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
import { EnhancedLogger } from './EnhancedLogger';
import { Buffer } from 'buffer'; // Ensure you have the 'buffer' package installed

// Define BLE Service and Characteristic UUIDs for the device.
const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const FILE_CHAR_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
const COMMAND_CHAR_UUID = 'beb5483f-36e1-4688-b7f5-ea07361b26a8';

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
   * Transfers a file to the device in chunks.
   * @param filename The name of the file to create on the device.
   * @param data The file data as an ArrayBuffer.
   * @param onProgress Optional callback to report transfer progress.
   */
  async transferFile(filename: string, data: ArrayBuffer, onProgress?: (progress: number) => void): Promise<void> {
    EnhancedLogger.debug('BLECommsManager', 'Transferring file', { filename, size: data.byteLength });
    try {
      // --- START the file transfer ---
      const startCommand = `START:${filename}`;
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        FILE_CHAR_UUID,
        Buffer.from(startCommand).toString('base64')
      );
      // Wait briefly so that the Arduino can process the command and notify.
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Read the response from the device.
      const response = await this.device.readCharacteristicForService(SERVICE_UUID, FILE_CHAR_UUID);
      const responseStr = Buffer.from(response.value!, 'base64').toString('utf-8');
      if (responseStr !== 'READY') {
        throw new Error('Device not ready for file transfer');
      }
  
      // --- Send file data in chunks ---
      const chunkSize = 512; // adjust based on MTU
      const totalChunks = Math.ceil(data.byteLength / chunkSize);
  
      for (let i = 0; i < totalChunks; i++) {
        const chunk = new Uint8Array(data.slice(i * chunkSize, (i + 1) * chunkSize));
        await this.device.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          FILE_CHAR_UUID,
          Buffer.from(chunk).toString('base64')
        );
  
        const chunkResponse = await this.device.readCharacteristicForService(SERVICE_UUID, FILE_CHAR_UUID);
        if (Buffer.from(chunkResponse.value!, 'base64').toString('utf-8') !== 'OK') {
          throw new Error(`File transfer chunk error at chunk ${i}`);
        }
  
        if (onProgress) {
          onProgress((i + 1) / totalChunks);
        }
      }
  
      // --- End file transfer ---
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        FILE_CHAR_UUID,
        Buffer.from('END').toString('base64')
      );
      const endResponse = await this.device.readCharacteristicForService(SERVICE_UUID, FILE_CHAR_UUID);
      if (Buffer.from(endResponse.value!, 'base64').toString('utf-8') !== 'DONE') {
        throw new Error('File transfer end error');
      }
  
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
      const value = Buffer.from(response.value!, 'base64').toString('utf-8');

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
      const value = Buffer.from(response.value!, 'base64').toString('utf-8');
      const [total, used] = value.split(',').map(Number);

      EnhancedLogger.info('BLECommsManager', 'Storage space retrieved', { total, used });
      return { total, used };
    } catch (error) {
      EnhancedLogger.error('BLECommsManager', 'Get storage space error', error as Error);
      throw error;
    }
  }
}
