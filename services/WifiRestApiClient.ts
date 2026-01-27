/**
 * services/WifiRestApiClient.ts
 *
 * This file contains the WifiRestApiClient class which handles communication with the device
 * over WiFi REST API for file operations such as listing files, transferring files, deleting files,
 * and checking storage space.
 */

import { EnhancedLogger } from './EnhancedLogger';
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';

// Interface for representing file information from the device
export interface FileInfo {
  name: string;
  size: number;
}

export class WifiRestApiClient {
  private baseUrl: string;

  /**
   * Constructs a new WifiRestApiClient instance.
   * @param ipAddress The IP address of the device.
   */
  constructor(ipAddress: string) {
    this.baseUrl = `http://${ipAddress}`;
    EnhancedLogger.debug('WifiRestApiClient', 'Initialized', { baseUrl: this.baseUrl });
  }

  /**
   * List files on the device.
   * @returns A promise that resolves to an array of FileInfo objects.
   */
  async listFiles(): Promise<FileInfo[]> {
    EnhancedLogger.debug('WifiRestApiClient', 'Listing files');
    try {
      const response = await fetch(`${this.baseUrl}/api/files`);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      EnhancedLogger.info('WifiRestApiClient', 'Files listed', { fileCount: data.files.length });
      return data.files;
    } catch (error) {
      EnhancedLogger.error('WifiRestApiClient', 'List files error', error as Error);
      throw error;
    }
  }

  /**
   * Uploads a file to the device from an ArrayBuffer.
   * @param filename The name of the file to create on the device.
   * @param data The file data as an ArrayBuffer.
   * @param onProgress Optional callback to report transfer progress.
   */
  async uploadFile(
    filename: string,
    data: ArrayBuffer,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    EnhancedLogger.debug('WifiRestApiClient', 'Uploading file from ArrayBuffer', { filename, size: data.byteLength });

    try {
      // Convert ArrayBuffer to base64 and write to a temp file
      // React Native's FormData requires a file URI, not a Blob
      const base64Data = Buffer.from(data).toString('base64');
      const tempPath = `${FileSystem.cacheDirectory}upload_temp_${Date.now()}_${filename}`;

      await FileSystem.writeAsStringAsync(tempPath, base64Data, {
        encoding: FileSystem.EncodingType.Base64,
      });

      EnhancedLogger.debug('WifiRestApiClient', 'Temp file created', { tempPath });

      try {
        // Use the URI-based upload
        await this.uploadFileFromUri(tempPath, filename, onProgress);
      } finally {
        // Clean up temp file
        try {
          await FileSystem.deleteAsync(tempPath, { idempotent: true });
        } catch (cleanupError) {
          EnhancedLogger.debug('WifiRestApiClient', 'Temp file cleanup failed (non-critical)', cleanupError);
        }
      }
    } catch (error) {
      EnhancedLogger.error('WifiRestApiClient', 'Upload file error', error as Error);
      throw error;
    }
  }

  /**
   * Uploads a file to the device from a local file URI.
   * This is the preferred method when the file already exists on disk.
   * @param fileUri The local file URI (e.g., from expo-file-system).
   * @param filename The name of the file to create on the device.
   * @param onProgress Optional callback to report transfer progress.
   */
  async uploadFileFromUri(
    fileUri: string,
    filename: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    EnhancedLogger.debug('WifiRestApiClient', 'Uploading file from URI', { fileUri, filename });

    try {
      // Get file info to know the size for progress tracking
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        throw new Error(`File not found: ${fileUri}`);
      }

      const fileSize = fileInfo.size || 0;
      EnhancedLogger.debug('WifiRestApiClient', 'File info', { size: fileSize });

      // Create FormData with React Native compatible format
      const formData = new FormData();

      // React Native FormData expects this specific object format for files
      formData.append('file', {
        uri: fileUri,
        type: 'application/octet-stream',
        name: filename,
      } as any);

      // Use XMLHttpRequest for progress monitoring
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${this.baseUrl}/api/upload`, true);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) {
            const progress = e.loaded / e.total;
            EnhancedLogger.debug('WifiRestApiClient', 'Upload progress', {
              loaded: e.loaded,
              total: e.total,
              percent: Math.round(progress * 100),
            });
            onProgress(progress);
          }
        };

        xhr.onload = () => {
          EnhancedLogger.debug('WifiRestApiClient', 'XHR onload', {
            status: xhr.status,
            response: xhr.responseText,
          });

          if (xhr.status >= 200 && xhr.status < 300) {
            EnhancedLogger.info('WifiRestApiClient', 'File uploaded successfully', { filename, size: fileSize });
            resolve();
          } else {
            const error = new Error(`HTTP error! Status: ${xhr.status}, Response: ${xhr.responseText}`);
            EnhancedLogger.error('WifiRestApiClient', 'Upload HTTP error', error);
            reject(error);
          }
        };

        xhr.onerror = () => {
          const error = new Error('Network error during upload');
          EnhancedLogger.error('WifiRestApiClient', 'Upload network error', error);
          reject(error);
        };

        xhr.ontimeout = () => {
          const error = new Error('Upload request timed out');
          EnhancedLogger.error('WifiRestApiClient', 'Upload timeout', error);
          reject(error);
        };

        // Set a generous timeout for large files (5 minutes)
        xhr.timeout = 300000;

        xhr.send(formData);
      });
    } catch (error) {
      EnhancedLogger.error('WifiRestApiClient', 'Upload file from URI error', error as Error);
      throw error;
    }
  }

  /**
   * Deletes a file on the device.
   * @param filename The name of the file to delete.
   */
  async deleteFile(filename: string): Promise<void> {
    EnhancedLogger.debug('WifiRestApiClient', 'Deleting file', { filename });
    try {
      const response = await fetch(`${this.baseUrl}/api/files?filename=${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      EnhancedLogger.info('WifiRestApiClient', 'File deleted', { filename });
    } catch (error) {
      EnhancedLogger.error('WifiRestApiClient', 'Delete file error', error as Error);
      throw error;
    }
  }

  /**
   * Retrieves storage space information from the device.
   * @returns A promise that resolves to an object containing total, used and free storage bytes.
   */
  async getStorageSpace(): Promise<{ total: number; used: number; free: number }> {
    EnhancedLogger.debug('WifiRestApiClient', 'Getting storage space');
    try {
      const response = await fetch(`${this.baseUrl}/api/storage`);
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      const data = await response.json();
      EnhancedLogger.info('WifiRestApiClient', 'Storage space retrieved', data);
      return data;
    } catch (error) {
      EnhancedLogger.error('WifiRestApiClient', 'Get storage space error', error as Error);
      throw error;
    }
  }

  /**
   * Displays an image on the device.
   * @param filename The name of the file to display.
   */
  async displayImage(filename: string): Promise<void> {
    EnhancedLogger.debug('WifiRestApiClient', 'Displaying image', { filename });
    try {
      const response = await fetch(`${this.baseUrl}/api/display?filename=${encodeURIComponent(filename)}`, {
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      EnhancedLogger.info('WifiRestApiClient', 'Image displayed', { filename });
    } catch (error) {
      EnhancedLogger.error('WifiRestApiClient', 'Display image error', error as Error);
      throw error;
    }
  }

  /**
   * Checks if the device is reachable via the API.
   * @returns A promise that resolves to a boolean indicating if the device is reachable.
   */
  async isReachable(timeout = 5000): Promise<boolean> {
    EnhancedLogger.debug('WifiRestApiClient', 'Checking if device is reachable');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      EnhancedLogger.debug('WifiRestApiClient', `Fetching from ${this.baseUrl}/api/storage`);
      
      // Create a fetch request with additional options
      const response = await fetch(`${this.baseUrl}/api/storage`, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        },
      });
      
      clearTimeout(timeoutId);
      
      // Log the response details
      EnhancedLogger.debug('WifiRestApiClient', `Response status: ${response.status}`);
      EnhancedLogger.debug('WifiRestApiClient', `Response OK: ${response.ok}`);
      
      return response.ok;
    } catch (error) {
      // More detailed error logging
      if (error instanceof TypeError) {
        EnhancedLogger.debug('WifiRestApiClient', 'Network error (TypeError)', error);
      } else if (error instanceof DOMException && error.name === 'AbortError') {
        EnhancedLogger.debug('WifiRestApiClient', 'Request aborted due to timeout', error);
      } else {
        EnhancedLogger.debug('WifiRestApiClient', 'Unknown error type', error);
      }
      return false;
    }
  }
}