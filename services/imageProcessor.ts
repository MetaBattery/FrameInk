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

      // Prepare the .h file content
      const fileContent = this.formatDataForEInk(
        grayscaleResult.packedData,
        grayscaleResult.width,
        grayscaleResult.height,
        previewPath
      );

      const filePath = `${saveDir}${filename}.h`;

      // Save the .h file
      await FileSystem.writeAsStringAsync(filePath, fileContent, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      logger.debug('ImageProcessor', 'Data file saved', { filePath });

      return filePath;
    } catch (error) {
      logger.error('ImageProcessor', 'Error in saveProcessedData', error);
      throw error;
    }
  }

  private static formatDataForEInk(
    packedData: Uint8Array,
    width: number,
    height: number,
    previewPath: string
  ): string {
    // Create the content of the .h file, including the preview_path
    const headerContent = `
    // E-Ink Image Data
    image_width = ${width};
    image_height = ${height};
    preview_path = "${previewPath}";
    image_data = {${Array.from(packedData).join(',')}};
    `;

    return headerContent;
  }
}