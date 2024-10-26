//services/imageProcessor.ys
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { logger } from '../services/logger';

export interface ProcessedImage {
  uri: string;
  width: number;
  height: number;
  data?: Uint8Array;
}

export interface GrayscaleResult {
  width: number;
  height: number;
  packedData: Uint8Array;
  previewUri: string;
}

export const ORIENTATIONS = {
  PORTRAIT: 'portrait',
  LANDSCAPE: 'landscape'
} as const;

export type Orientation = typeof ORIENTATIONS[keyof typeof ORIENTATIONS];

export class ImageProcessor {
  static getDimensionsForOrientation(orientation: Orientation) {
    return orientation === ORIENTATIONS.PORTRAIT 
      ? { width: 540, height: 960 }
      : { width: 960, height: 540 };
  }

  static async cropAndResize(
    imageUri: string, 
    crop: { originX: number; originY: number; width: number; height: number },
    orientation: Orientation
  ): Promise<ProcessedImage> {
    try {
      logger.debug('ImageProcessor', 'Starting crop and resize', {
        orientation,
        crop,
        imageUri
      });
  
      const dimensions = this.getDimensionsForOrientation(orientation);
      
      // First crop the image
      const croppedImage = await manipulateAsync(
        imageUri,
        [
          {
            crop: {
              originX: Math.round(crop.originX),
              originY: Math.round(crop.originY),
              width: Math.round(crop.width),
              height: Math.round(crop.height)
            },
          }
        ],
        { format: SaveFormat.PNG }
      );
  
      logger.debug('ImageProcessor', 'Crop complete, starting resize');
  
      // Then resize to final dimensions
      const resizedImage = await manipulateAsync(
        croppedImage.uri,
        [
          {
            resize: {
              width: dimensions.width,
              height: dimensions.height,
            }
          }
        ],
        { format: SaveFormat.PNG }
      );
  
      logger.debug('ImageProcessor', 'Resize complete', {
        finalWidth: dimensions.width,
        finalHeight: dimensions.height,
        resultUri: resizedImage.uri
      });
  
      return {
        uri: resizedImage.uri,
        width: dimensions.width,
        height: dimensions.height,
      };
    } catch (error) {
      logger.error('ImageProcessor', 'Error in crop and resize', error);
      throw error;
    }
  }

  static async convertToGrayscale4bit(processedImage: ProcessedImage): Promise<GrayscaleResult> {
    try {
      logger.debug('ImageProcessor', 'Starting grayscale conversion', {
        width: processedImage.width,
        height: processedImage.height,
        uri: processedImage.uri
      });

      // First convert to grayscale using image manipulator
      const grayImage = await manipulateAsync(
        processedImage.uri,
        [{ grayscale: true }],
        { format: SaveFormat.PNG }
      );

      logger.debug('ImageProcessor', 'Grayscale conversion complete', {
        resultUri: grayImage.uri
      });

      // Read the image data
      const base64 = await FileSystem.readAsStringAsync(grayImage.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      logger.debug('ImageProcessor', 'Read image as base64', { 
        length: base64.length 
      });

      // Create the packed data array (2 pixels per byte for 4-bit)
      const packedLength = Math.ceil((processedImage.width * processedImage.height) / 2);
      const packedData = new Uint8Array(packedLength);

      logger.debug('ImageProcessor', 'Created packed data array', {
        packedLength,
        expectedPixels: processedImage.width * processedImage.height
      });

      // We'll use the grayscale image as the preview for now
      // In a production app, we might want to generate a proper preview
      // showing the actual 4-bit conversion
      const previewUri = grayImage.uri;

      // Convert the base64 image data to 4-bit grayscale
      // For now, we're creating a placeholder packed data array
      // This should be replaced with actual pixel processing
      for (let i = 0; i < packedLength; i++) {
        packedData[i] = 0x00;
      }

      logger.debug('ImageProcessor', 'Conversion complete');

      return {
        width: processedImage.width,
        height: processedImage.height,
        packedData,
        previewUri
      };
    } catch (error) {
      logger.error('ImageProcessor', 'Error converting to grayscale', error);
      throw error;
    }
  }

  static async saveProcessedData(grayscaleResult: GrayscaleResult, filename: string): Promise<string> {
    try {
      logger.debug('ImageProcessor', 'Starting save process', { filename });

      // Format the data as C-style array
      const formattedData = this.formatForEink(grayscaleResult);
      
      // Determine the save location
      const saveDir = `${FileSystem.documentDirectory}processed_images/`;
      const filePath = `${saveDir}${filename}.h`;

      logger.debug('ImageProcessor', 'Saving to path', { 
        saveDir, 
        filePath 
      });

      // Create directory if it doesn't exist
      await FileSystem.makeDirectoryAsync(saveDir, { 
        intermediates: true 
      }).catch(error => {
        logger.debug('ImageProcessor', 'Directory already exists or created', error);
      });

      // Save the file
      await FileSystem.writeAsStringAsync(filePath, formattedData);

      logger.debug('ImageProcessor', 'File saved successfully', { 
        filePath 
      });

      return filePath;
    } catch (error) {
      logger.error('ImageProcessor', 'Error saving processed data', error);
      throw error;
    }
  }

  static formatForEink(grayscaleResult: GrayscaleResult): string {
    logger.debug('ImageProcessor', 'Formatting data for e-ink', {
      width: grayscaleResult.width,
      height: grayscaleResult.height,
      dataLength: grayscaleResult.packedData.length
    });

    const header = `// Generated by FrameInk\n` +
                  `// Resolution: ${grayscaleResult.width}x${grayscaleResult.height}\n\n` +
                  `const uint32_t image_width = ${grayscaleResult.width};\n` +
                  `const uint32_t image_height = ${grayscaleResult.height};\n` +
                  `const uint8_t image_data[${grayscaleResult.packedData.length}] = {\n`;

    // Format data in rows of 16 bytes
    const dataHex = Array.from(grayscaleResult.packedData)
      .map(byte => `0x${byte.toString(16).padStart(2, '0')}`)
      .reduce((acc, hex, i) => {
        if (i % 16 === 0) {
          return acc + (i === 0 ? '  ' : ',\n  ') + hex;
        }
        return acc + ', ' + hex;
      }, '');

    const formattedData = header + dataHex + '\n};';

    logger.debug('ImageProcessor', 'Formatting complete', {
      dataLength: formattedData.length
    });

    return formattedData;
  }
}