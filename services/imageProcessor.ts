// services/ImageProcessor.ts

import * as FileSystem from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { GrayscaleConverter } from './GrayscaleConverter';
import { logger } from './logger';

export type Orientation = 'portrait' | 'landscape';
export const ORIENTATIONS = {
  PORTRAIT: 'portrait' as Orientation,
  LANDSCAPE: 'landscape' as Orientation,
};

export interface ProcessedImage {
  uri: string;
  width: number;
  height: number;
}

export interface GrayscaleResult {
  width: number;
  height: number;
  packedData: Uint8Array;
  previewUri: string;
}

export class ImageProcessor {
  static async cropAndResize(
    imageUri: string,
    cropData: { originX: number; originY: number; width: number; height: number },
    orientation: Orientation
  ): Promise<ProcessedImage> {
    try {
      // Perform cropping and resizing operations
      const result = await manipulateAsync(
        imageUri,
        [
          {
            crop: cropData,
          },
          {
            resize: {
              width: orientation === ORIENTATIONS.PORTRAIT ? 540 : 960,
              height: orientation === ORIENTATIONS.PORTRAIT ? 960 : 540,
            },
          },
        ],
        { compress: 1, format: SaveFormat.PNG }
      );

      logger.debug('ImageProcessor', 'Crop and resize complete', {
        uri: result.uri,
        width: result.width,
        height: result.height,
      });

      return {
        uri: result.uri,
        width: result.width,
        height: result.height,
      };
    } catch (error) {
      logger.error('ImageProcessor', 'Error in cropAndResize', error);
      throw error;
    }
  }

  static async convertToGrayscale4bit(
    processedImage: ProcessedImage
  ): Promise<GrayscaleResult> {
    const grayscaleResult = await GrayscaleConverter.convert(processedImage);
    return grayscaleResult;
  }

  static async saveProcessedData(
    grayscaleResult: GrayscaleResult,
    filename: string
  ): Promise<string> {
    try {
      const saveDir = `${FileSystem.documentDirectory}processed_images/`;
      await FileSystem.makeDirectoryAsync(saveDir, { intermediates: true });

      // Save the preview image
      const previewFilename = `${filename}_preview.jpg`;
      const previewPath = `${saveDir}${previewFilename}`;
      await FileSystem.copyAsync({
        from: grayscaleResult.previewUri,
        to: previewPath,
      });

      logger.debug('ImageProcessor', 'Preview image saved', { previewPath });

      // Create binary file content
      const binaryData = this.formatDataForEInk(
        grayscaleResult.packedData,
        grayscaleResult.width,
        grayscaleResult.height
      );

      const filePath = `${saveDir}${filename}.bin`;

      // Save the binary file
      await FileSystem.writeAsStringAsync(filePath, binaryData, {
        encoding: FileSystem.EncodingType.Base64,
      });

      logger.debug('ImageProcessor', 'Binary data file saved', { filePath });

      return filePath;
    } catch (error) {
      logger.error('ImageProcessor', 'Error in saveProcessedData', error);
      throw error;
    }
  }

  private static formatDataForEInk(
    packedData: Uint8Array,
    width: number,
    height: number
  ): string {
    // Create a header with metadata (8 bytes)
    const header = new Uint8Array(8);
    // Store width (2 bytes)
    header[0] = width & 0xFF;
    header[1] = (width >> 8) & 0xFF;
    // Store height (2 bytes)
    header[2] = height & 0xFF;
    header[3] = (height >> 8) & 0xFF;
    // Reserved bytes for future use
    header[4] = 0;
    header[5] = 0;
    header[6] = 0;
    header[7] = 0;

    // Combine header and image data
    const combinedData = new Uint8Array(header.length + packedData.length);
    combinedData.set(header);
    combinedData.set(packedData, header.length);

    // Convert to base64 for FileSystem.writeAsStringAsync
    return Buffer.from(combinedData).toString('base64');
  }
}