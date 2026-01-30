// services/ImageProcessor.ts

import { File, Directory, Paths } from 'expo-file-system';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { GrayscaleConverter } from './GrayscaleConverter';
import { logger } from './logger';
import { Buffer } from 'buffer';

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
      const saveDir = new Directory(Paths.document, 'processed_images');
      if (!saveDir.exists) {
        saveDir.create({ intermediates: true });
      }

      // Save the preview image
      const previewFilename = `${filename}_preview.jpg`;
      const previewFile = new File(saveDir, previewFilename);
      const sourcePreview = new File(grayscaleResult.previewUri);
      sourcePreview.copy(previewFile);

      logger.debug('ImageProcessor', 'Preview image saved', { previewPath: previewFile.uri });

      // Check if this is a portrait image (height > width) and rotate if needed
      // Device expects landscape format (960x540), so portrait images need rotation
      let finalPackedData = grayscaleResult.packedData;
      let finalWidth = grayscaleResult.width;
      let finalHeight = grayscaleResult.height;

      if (grayscaleResult.height > grayscaleResult.width) {
        logger.debug('ImageProcessor', 'Portrait image detected, rotating for device', {
          originalWidth: grayscaleResult.width,
          originalHeight: grayscaleResult.height,
        });

        // Unpack, rotate 90° clockwise, then repack
        finalPackedData = this.rotatePackedData90CW(
          grayscaleResult.packedData,
          grayscaleResult.width,
          grayscaleResult.height
        );
        // After 90° CW rotation, dimensions are swapped
        finalWidth = grayscaleResult.height;
        finalHeight = grayscaleResult.width;

        logger.debug('ImageProcessor', 'Rotation complete', {
          newWidth: finalWidth,
          newHeight: finalHeight,
        });
      }

      // Create binary file content
      const binaryData = this.formatDataForEInk(
        finalPackedData,
        finalWidth,
        finalHeight
      );

      // Log header bytes for debugging
      const headerHex = Array.from(binaryData.slice(0, 8))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' ');
      logger.debug('ImageProcessor', 'Header bytes', {
        hex: headerHex,
        width: grayscaleResult.width,
        height: grayscaleResult.height,
        totalSize: binaryData.length,
      });

      // Use legacy API for binary file writing (modern API has issues with binary data)
      const binFilePath = `${LegacyFileSystem.documentDirectory}processed_images/${filename}.bin`;

      // Convert Uint8Array to base64 for legacy API
      const base64Data = Buffer.from(binaryData).toString('base64');

      await LegacyFileSystem.writeAsStringAsync(binFilePath, base64Data, {
        encoding: LegacyFileSystem.EncodingType.Base64,
      });

      logger.debug('ImageProcessor', 'Binary data file saved', { filePath: binFilePath });

      return binFilePath;
    } catch (error) {
      logger.error('ImageProcessor', 'Error in saveProcessedData', error);
      throw error;
    }
  }

  /**
   * Rotate packed 4-bit pixel data 90 degrees clockwise.
   * This is needed to convert portrait images to landscape format for the device.
   */
  private static rotatePackedData90CW(
    packedData: Uint8Array,
    width: number,
    height: number
  ): Uint8Array {
    // First, unpack the 4-bit data to individual pixel values
    const totalPixels = width * height;
    const unpacked = new Uint8Array(totalPixels);

    for (let i = 0; i < packedData.length; i++) {
      const byte = packedData[i];
      const pixel1 = (byte >> 4) & 0x0F;  // High nibble
      const pixel2 = byte & 0x0F;          // Low nibble

      const pixelIndex = i * 2;
      if (pixelIndex < totalPixels) {
        unpacked[pixelIndex] = pixel1;
      }
      if (pixelIndex + 1 < totalPixels) {
        unpacked[pixelIndex + 1] = pixel2;
      }
    }

    // Rotate 90 degrees clockwise
    // Original: (x, y) in width x height
    // New: (height - 1 - y, x) in height x width
    const newWidth = height;
    const newHeight = width;
    const rotated = new Uint8Array(totalPixels);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const oldIndex = y * width + x;
        const newX = height - 1 - y;
        const newY = x;
        const newIndex = newY * newWidth + newX;
        rotated[newIndex] = unpacked[oldIndex];
      }
    }

    // Repack the rotated data
    const packedLength = Math.ceil(totalPixels / 2);
    const repacked = new Uint8Array(packedLength);

    for (let i = 0; i < totalPixels; i += 2) {
      const pixel1 = rotated[i];
      const pixel2 = i + 1 < totalPixels ? rotated[i + 1] : 0;
      repacked[Math.floor(i / 2)] = (pixel1 << 4) | pixel2;
    }

    return repacked;
  }

  private static formatDataForEInk(
    packedData: Uint8Array,
    width: number,
    height: number
  ): Uint8Array {
    // Create a header with metadata (8 bytes)
    // Device expects 4-byte little-endian integers for width and height
    const header = new Uint8Array(8);
    // Store width (4 bytes, little-endian)
    header[0] = width & 0xFF;
    header[1] = (width >> 8) & 0xFF;
    header[2] = (width >> 16) & 0xFF;
    header[3] = (width >> 24) & 0xFF;
    // Store height (4 bytes, little-endian)
    header[4] = height & 0xFF;
    header[5] = (height >> 8) & 0xFF;
    header[6] = (height >> 16) & 0xFF;
    header[7] = (height >> 24) & 0xFF;

    // Combine header and image data
    const combinedData = new Uint8Array(header.length + packedData.length);
    combinedData.set(header);
    combinedData.set(packedData, header.length);

    return combinedData;
  }
}