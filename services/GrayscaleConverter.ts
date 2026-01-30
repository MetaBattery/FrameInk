// services/GrayscaleConverter.ts

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { logger } from './logger';
import { ProcessedImage, GrayscaleResult } from './imageProcessor';
import { Buffer } from 'buffer';
import UPNG from 'upng-js';

export class GrayscaleConverter {
  static async convert(processedImage: ProcessedImage): Promise<GrayscaleResult> {
    try {
      logger.debug('GrayscaleConverter', 'Starting conversion', {
        width: processedImage.width,
        height: processedImage.height,
        uri: processedImage.uri,
      });

      // Read image file as base64
      const imageFile = new File(processedImage.uri);
      const base64 = await imageFile.base64();

      // Convert base64 to ArrayBuffer
      const binaryData = Buffer.from(base64, 'base64');
      const arrayBuffer = binaryData.buffer.slice(
        binaryData.byteOffset,
        binaryData.byteOffset + binaryData.byteLength
      );

      // Decode PNG image using UPNG
      const pngData = UPNG.decode(arrayBuffer);

      if (!pngData || !pngData.width || !pngData.height) {
        throw new Error('Failed to decode PNG image');
      }

      // Convert to RGBA8 format (returns array of frame buffers, we need first frame)
      const rgbaFrames = UPNG.toRGBA8(pngData);
      const pixelData = new Uint8Array(rgbaFrames[0]); // First frame RGBA data

      // Convert to grayscale
      const grayscaleData = new Uint8Array(pngData.width * pngData.height);
      for (let i = 0; i < grayscaleData.length; i++) {
        const r = pixelData[i * 4];
        const g = pixelData[i * 4 + 1];
        const b = pixelData[i * 4 + 2];
        // Use standard luminance formula
        const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
        grayscaleData[i] = gray;
      }

      logger.debug('GrayscaleConverter', 'Pixel data extracted and converted to grayscale', {
        pixelDataLength: grayscaleData.length,
      });

      // Pack pixels
      const packedData = this.packPixels(grayscaleData);
      logger.debug('GrayscaleConverter', 'Pixels packed', {
        packedDataLength: packedData.length,
      });

      // Generate preview image
      let previewUri;
      try {
        previewUri = await this.generatePreview(
          processedImage.uri,
          processedImage.width,
          processedImage.height
        );
      } catch (previewError) {
        logger.debug(
          'GrayscaleConverter',
          'Failed to generate preview, using original image',
          previewError
        );
        previewUri = processedImage.uri;
      }

      return {
        width: processedImage.width,
        height: processedImage.height,
        packedData,
        previewUri,
      };
    } catch (error) {
      logger.error('GrayscaleConverter', 'Conversion failed', error);
      throw error;
    }
  }

  private static packPixels(pixelData: Uint8Array): Uint8Array {
    try {
      const packedLength = Math.ceil(pixelData.length / 2);
      const packedData = new Uint8Array(packedLength);

      for (let i = 0; i < pixelData.length; i += 2) {
        // Convert to 4-bit (0-15)
        const pixel1 = Math.floor(pixelData[i] / 16);
        const pixel2 = i + 1 < pixelData.length ? Math.floor(pixelData[i + 1] / 16) : 0;

        // Pack two 4-bit values into one byte
        packedData[Math.floor(i / 2)] = (pixel1 << 4) | pixel2;
      }

      return packedData;
    } catch (error) {
      logger.error('GrayscaleConverter', 'Error packing pixels', error);
      throw error;
    }
  }

  private static async generatePreview(
    imageUri: string,
    width: number,
    height: number
  ): Promise<string> {
    try {
      // Calculate preview dimensions while maintaining aspect ratio
      const maxPreviewWidth = 300;
      const maxPreviewHeight = 533;
      let previewWidth = width;
      let previewHeight = height;

      if (width > maxPreviewWidth || height > maxPreviewHeight) {
        const ratio = Math.min(maxPreviewWidth / width, maxPreviewHeight / height);
        previewWidth = Math.round(width * ratio);
        previewHeight = Math.round(height * ratio);
      }

      // Create preview image
      const preview = await manipulateAsync(
        imageUri,
        [
          {
            resize: {
              width: previewWidth,
              height: previewHeight,
            },
          },
        ],
        {
          compress: 0.7,
          format: SaveFormat.JPEG,
        }
      );

      logger.debug('GrayscaleConverter', 'Preview generated', {
        width: previewWidth,
        height: previewHeight,
        uri: preview.uri,
      });

      // Return the preview URI (temporary location)
      return preview.uri;
    } catch (error) {
      logger.error('GrayscaleConverter', 'Error generating preview', error);
      // Return the original image URI as a fallback
      return imageUri;
    }
  }
}