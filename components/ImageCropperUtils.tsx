import { Orientation, ORIENTATIONS } from '../services/imageProcessor';
import { logger } from '../services/logger';

export const PADDING = 16;
export const BUTTON_BAR_HEIGHT = 80;

export const calculateZoomLimits = (
  imageSize: { width: number; height: number },
  frameSize: { width: number; height: number }
) => {
  const widthRatio = frameSize.width / imageSize.width;
  const heightRatio = frameSize.height / imageSize.height;
  
  // Minimum zoom should ensure the image covers the crop frame
  const minScale = Math.max(widthRatio, heightRatio);
  // Maximum zoom could be 3x the minimum or a fixed value
  const maxScale = Math.max(minScale * 3, 3);
  
  return { minScale, maxScale };
};

export const getCropFrameDimensions = (
  containerSize: { width: number; height: number },
  orientation: Orientation,
  padding: number
) => {
  if (containerSize.width === 0 || containerSize.height === 0)
    return { width: 0, height: 0 };

  const maxWidth = containerSize.width - padding * 2;
  const maxHeight = containerSize.height - padding * 2;

  if (orientation === ORIENTATIONS.PORTRAIT) {
    const aspectRatio = 540 / 960;
    const frameHeight = Math.min(maxHeight, maxWidth / aspectRatio);
    const frameWidth = frameHeight * aspectRatio;
    
    return { width: frameWidth, height: frameHeight };
  } else {
    const aspectRatio = 960 / 540;
    const frameWidth = Math.min(maxWidth, maxHeight * aspectRatio);
    const frameHeight = frameWidth / aspectRatio;
    
    return { width: frameWidth, height: frameHeight };
  }
};

export const calculateImageDimensions = (
  width: number,
  height: number,
  containerSize: { width: number; height: number },
  orientation: Orientation
) => {
  const cropFrameDimensions = getCropFrameDimensions(containerSize, orientation, PADDING);
  const frameAspect = cropFrameDimensions.width / cropFrameDimensions.height;
  const imageAspect = width / height;
  
  let newWidth, newHeight;
  if (frameAspect > imageAspect) {
    newHeight = cropFrameDimensions.height;
    newWidth = newHeight * imageAspect;
  } else {
    newWidth = cropFrameDimensions.width;
    newHeight = newWidth / imageAspect;
  }

  // Center the image in the container
  const centerX = (containerSize.width - newWidth) / 2;
  const centerY = (containerSize.height - newHeight) / 2;

  logger.debug('ImageCropper', 'Initial image dimensions', {
    original: { width, height },
    container: containerSize,
    frame: cropFrameDimensions,
    calculated: { width: newWidth, height: newHeight },
    center: { x: centerX, y: centerY }
  });

  return { newWidth, newHeight, centerX, centerY };
};

export const calculateCropData = (
  originalWidth: number,
  originalHeight: number,
  imageSize: { width: number; height: number },
  containerSize: { width: number; height: number },
  currentScale: number,
  panX: number,
  panY: number,
  orientation: Orientation
) => {
  const frame = getCropFrameDimensions(containerSize, orientation, PADDING);
  
  // Calculate the actual displayed image dimensions after scaling
  const displayedImageWidth = imageSize.width * currentScale;
  const displayedImageHeight = imageSize.height * currentScale;

  // Get the frame position (centered in container)
  const frameX = (containerSize.width - frame.width) / 2;
  const frameY = (containerSize.height - frame.height) / 2;

  // Calculate the image's position relative to the container's top-left corner
  const imageLeft = panX + (containerSize.width - displayedImageWidth) / 2;
  const imageTop = panY + (containerSize.height - displayedImageHeight) / 2;

  // Calculate the frame's position relative to the image
  const relativeX = (frameX - imageLeft) / currentScale;
  const relativeY = (frameY - imageTop) / currentScale;

  // Calculate the scale factor between original and displayed image
  const scaleToOriginal = originalWidth / imageSize.width;
  
  // Calculate crop dimensions in original image space
  const rawCropData = {
    originX: relativeX * scaleToOriginal,
    originY: relativeY * scaleToOriginal,
    width: (frame.width / currentScale) * scaleToOriginal,
    height: (frame.height / currentScale) * scaleToOriginal
  };

  // Ensure we stay within image bounds
  const cropData = {
    originX: Math.max(0, Math.min(rawCropData.originX, originalWidth - rawCropData.width)),
    originY: Math.max(0, Math.min(rawCropData.originY, originalHeight - rawCropData.height)),
    width: Math.min(rawCropData.width, originalWidth),
    height: Math.min(rawCropData.height, originalHeight)
  };

  // Add detailed logging
  logger.debug('ImageCropper', 'Crop calculation', {
    originalDimensions: { width: originalWidth, height: originalHeight },
    displayedDimensions: { width: displayedImageWidth, height: displayedImageHeight },
    imageSize: { width: imageSize.width, height: imageSize.height },
    frame: {
      dimensions: frame,
      position: { x: frameX, y: frameY }
    },
    image: {
      position: { x: panX, y: panY },
      displayedPosition: { x: imageLeft, y: imageTop },
      scale: currentScale
    },
    calculations: {
      relativePosition: { x: relativeX, y: relativeY },
      scaleToOriginal,
      rawCrop: rawCropData
    },
    finalCrop: cropData
  });

  return cropData;
};