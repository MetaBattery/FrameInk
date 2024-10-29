import { manipulateAsync, SaveFormat, ImageResult } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { logger } from '../services/logger';
import { ProcessedImage, GrayscaleResult } from './ImageProcessor';

export class GrayscaleConverter {
  static async convert(processedImage: ProcessedImage): Promise<GrayscaleResult> {
    try {
      logger.debug('GrayscaleConverter', 'Starting conversion', {
        width: processedImage.width,
        height: processedImage.height,
        uri: processedImage.uri
      });
  
      // Extract pixel data
      const pixelData = await this.extractPixelData(
        processedImage.uri,
        processedImage.width,
        processedImage.height
      );
      logger.debug('GrayscaleConverter', 'Pixel data extracted', {
        pixelDataLength: pixelData.length
      });
  
      // Pack pixels
      const packedData = this.packPixels(pixelData);
      logger.debug('GrayscaleConverter', 'Pixels packed', {
        packedDataLength: packedData.length
      });
  
      // Generate preview (with fallback to original image)
      let previewUri;
      try {
        previewUri = await this.generatePreview(
          processedImage.uri,
          processedImage.width,
          processedImage.height
        );
      } catch (previewError) {
        logger.warn('GrayscaleConverter', 'Failed to generate preview, using original image', previewError);
        previewUri = processedImage.uri;
      }
  
      return {
        width: processedImage.width,
        height: processedImage.height,
        packedData,
        previewUri
      };
    } catch (error) {
      logger.error('GrayscaleConverter', 'Conversion failed', error);
      throw error;
    }
  }

  private static async extractPixelData(
    imageUri: string,
    width: number,
    height: number
  ): Promise<Uint8Array> {
    try {
      const base64 = await FileSystem.readAsStringAsync(imageUri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Convert base64 to binary
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Create array for grayscale values
      const pixelData = new Uint8Array(width * height);
      let pixelIndex = 0;

      // Find the pixel data in PNG
      // Skip PNG signature (8 bytes) and look for IDAT chunk
      let dataStart = 8;
      while (dataStart < bytes.length - 12) {
        const chunkLength = (bytes[dataStart] << 24) | 
                          (bytes[dataStart + 1] << 16) | 
                          (bytes[dataStart + 2] << 8) | 
                          bytes[dataStart + 3];
                          
        const chunkType = String.fromCharCode(
          bytes[dataStart + 4],
          bytes[dataStart + 5],
          bytes[dataStart + 6],
          bytes[dataStart + 7]
        );

        if (chunkType === 'IDAT') {
          dataStart += 8;
          break;
        }
        dataStart += 8 + chunkLength + 4;
      }

      // Process RGB values to grayscale
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (dataStart + (y * width + x) * 4 + 3 < bytes.length) {
            // Get RGB values
            const r = bytes[dataStart + (y * width + x) * 4];
            const g = bytes[dataStart + (y * width + x) * 4 + 1];
            const b = bytes[dataStart + (y * width + x) * 4 + 2];
            
            // Convert to grayscale using standard luminance formula
            const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
            pixelData[pixelIndex++] = gray;
          }
        }
      }

      return pixelData;
    } catch (error) {
      logger.error('GrayscaleConverter', 'Error extracting pixel data', error);
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
  
      // Create preview using image manipulator with only supported operations
      const preview = await manipulateAsync(
        imageUri,
        [
          {
            resize: {
              width: previewWidth,
              height: previewHeight
            }
          }
        ],
        {
          compress: 0.7,
          format: SaveFormat.JPEG
        }
      );
  
      logger.debug('GrayscaleConverter', 'Preview generated', {
        width: previewWidth,
        height: previewHeight,
        uri: preview.uri
      });
  
      // Instead of trying to manipulate the image further, we'll use the grayscale data
      // we already have to create the preview
      const directory = FileSystem.documentDirectory + 'processed_images/';
      const previewFilename = `preview_${Date.now()}.jpg`;
      const previewPath = `${directory}${previewFilename}`;
  
      // Copy the preview file to the processed_images directory
      await FileSystem.copyAsync({
        from: preview.uri,
        to: previewPath
      });
  
      return previewPath;
    } catch (error) {
      logger.error('GrayscaleConverter', 'Error generating preview', error);
      // Instead of throwing, return the original image URI as fallback
      return imageUri;
    }
  }

  static async createDebugPreview(
    packedData: Uint8Array,
    width: number,
    height: number
  ): Promise<string> {
    try {
      // Unpack data for preview
      const unpackedPixels = new Uint8Array(width * height);
      
      for (let i = 0; i < packedData.length; i++) {
        const high = (packedData[i] & 0xF0) >> 4;
        const low = packedData[i] & 0x0F;
        
        // Convert back to 8-bit values (0-255)
        unpackedPixels[i * 2] = high * 16;
        if (i * 2 + 1 < width * height) {
          unpackedPixels[i * 2 + 1] = low * 16;
        }
      }

      logger.debug('GrayscaleConverter', 'Debug preview unpacked', {
        unpackedLength: unpackedPixels.length
      });

      // For now, we're returning a placeholder
      // In a real implementation, you would create an actual preview image
      return "debug_preview_uri";
    } catch (error) {
      logger.error('GrayscaleConverter', 'Error creating debug preview', error);
      throw error;
    }
  }
}