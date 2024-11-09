// components/ImageCropper.tsx

import React, { useRef, useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  PanResponder,
  Animated,
  Image,
  LayoutRectangle,
  Dimensions,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';
import { Orientation, ORIENTATIONS } from '../services/imageProcessor';
import { logger } from '../services/logger';
import { 
  calculateImageDimensions, 
  calculateCropData, 
  getCropFrameDimensions,
  calculateZoomLimits,
  PADDING,
  BUTTON_BAR_HEIGHT 
} from './ImageCropperUtils';

interface ImageCropperProps {
  imageUri: string;
  onCropComplete: (cropData: {
    originX: number;
    originY: number;
    width: number;
    height: number;
  }, orientation: Orientation) => void;
}

export default function ImageCropper({ imageUri, onCropComplete }: ImageCropperProps) {
  const { colors } = useTheme();
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [orientation, setOrientation] = useState<Orientation>(ORIENTATIONS.PORTRAIT);
  const [frameLayout, setFrameLayout] = useState<LayoutRectangle | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [zoomLimits, setZoomLimits] = useState({ minScale: 1, maxScale: 3 });
  
  const pan = useRef(new Animated.ValueXY()).current;
  const scale = useRef(new Animated.Value(1)).current;
  let lastScale = 1;
  let lastDistance = 0;
  let lastTap = 0;

  useEffect(() => {
    scale.addListener(({ value }) => {
      console.log('Scale value:', value, 'Limits:', zoomLimits);
    });
    return () => scale.removeAllListeners();
  }, [scale, zoomLimits]);

  const resetTransform = () => {
    const { centerX, centerY } = calculateImageDimensions(
      imageSize.width,
      imageSize.height,
      containerSize,
      orientation
    );

    Animated.parallel([
      Animated.spring(scale, {
        toValue: zoomLimits.minScale,
        useNativeDriver: false,
      }),
      Animated.spring(pan, {
        toValue: { x: centerX, y: centerY },
        useNativeDriver: false,
      }),
    ]).start();
    lastScale = zoomLimits.minScale;
  };

  useEffect(() => {
    if (containerSize.width > 0 && containerSize.height > 0) {
      Image.getSize(
        imageUri,
        (width, height) => {
          const { newWidth, newHeight, centerX, centerY } = calculateImageDimensions(
            width,
            height,
            containerSize,
            orientation
          );

          setImageSize({ width: newWidth, height: newHeight });
          
          const cropFrame = getCropFrameDimensions(containerSize, orientation, PADDING);
          const { minScale, maxScale } = calculateZoomLimits(
            { width: newWidth, height: newHeight },
            cropFrame
          );
          setZoomLimits({ minScale, maxScale });

          // Set initial position and scale
          pan.setValue({ x: centerX, y: centerY });
          scale.setValue(minScale);
          lastScale = minScale;
        },
        (error) => logger.error('ImageCropper', 'Image load error', error)
      );
    }
  }, [imageUri, containerSize, orientation]);

  const getDistance = (touches: any[]) => {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => {
      // Handle double tap
      const now = Date.now();
      if (now - lastTap < 300) {
        resetTransform();
      }
      lastTap = now;

      pan.setOffset({
        x: pan.x._value,
        y: pan.y._value,
      });
    },
    onPanResponderMove: (event, gestureState) => {
      const touches = event.nativeEvent.touches;
      
      if (touches.length === 2) {
        const currentDistance = getDistance(touches);
        
        if (lastDistance === 0) {
          lastDistance = currentDistance;
          return;
        }

        const newScale = Math.min(
          Math.max(
            lastScale * (currentDistance / lastDistance),
            zoomLimits.minScale
          ),
          zoomLimits.maxScale
        );
        scale.setValue(newScale);
      } else {
        Animated.event(
          [null, { dx: pan.x, dy: pan.y }],
          { useNativeDriver: false }
        )(event, gestureState);
      }
    },
    onPanResponderRelease: () => {
      pan.flattenOffset();
      lastScale = scale._value;
      lastDistance = 0;
    },
  });

  const handleCrop = () => {
    if (!frameLayout || imageSize.width === 0 || imageSize.height === 0) return;

    Image.getSize(imageUri, (originalWidth, originalHeight) => {
      const cropData = calculateCropData(
        originalWidth,
        originalHeight,
        imageSize,
        containerSize,
        scale._value,
        pan.x._value,
        pan.y._value,
        orientation
      );

      onCropComplete(cropData, orientation);
    });
  };

  const cropFrameDimensions = getCropFrameDimensions(containerSize, orientation, PADDING);
  const styles = makeStyles(colors);

  return (
    <View style={styles.container}>
      <View
        style={styles.imageContainer}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setContainerSize({ width, height });
        }}
      >
        {imageSize.width > 0 && imageSize.height > 0 && cropFrameDimensions.width > 0 && (
          <View style={styles.cropArea}>
            <Animated.View
              style={[
                styles.animatedImageContainer,
                {
                  transform: [
                    { translateX: pan.x },
                    { translateY: pan.y },
                    { scale },
                  ],
                },
              ]}
              {...panResponder.panHandlers}
            >
              <Image
                source={{ uri: imageUri }}
                style={[styles.image, { width: imageSize.width, height: imageSize.height }]}
                resizeMode="contain"
              />
            </Animated.View>

            <View
              style={[
                styles.cropFrame,
                {
                  width: cropFrameDimensions.width,
                  height: cropFrameDimensions.height,
                  left: (containerSize.width - cropFrameDimensions.width) / 2,
                  top: (containerSize.height - cropFrameDimensions.height) / 2,
                },
              ]}
              pointerEvents="none"
              onLayout={(event) => setFrameLayout(event.nativeEvent.layout)}
            />
          </View>
        )}
      </View>

      <View style={styles.buttonContainer}>
        <Button
          mode={orientation === ORIENTATIONS.PORTRAIT ? 'contained' : 'outlined'}
          onPress={() => setOrientation(ORIENTATIONS.PORTRAIT)}
          style={styles.actionButton}
        >
          Portrait
        </Button>
        <Button
          mode={orientation === ORIENTATIONS.LANDSCAPE ? 'contained' : 'outlined'}
          onPress={() => setOrientation(ORIENTATIONS.LANDSCAPE)}
          style={styles.actionButton}
        >
          Landscape
        </Button>
        <Button
          mode="contained"
          onPress={handleCrop}
          style={styles.actionButton}
        >
          Crop
        </Button>
      </View>
    </View>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    imageContainer: {
      flex: 1,
      width: '100%',
      marginBottom: BUTTON_BAR_HEIGHT,
    },
    cropArea: {
      flex: 1,
      position: 'relative',
    },
    animatedImageContainer: {
      position: 'absolute',
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    image: {
      width: '100%',
      height: '100%',
    },
    cropFrame: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: 'transparent',
      pointerEvents: 'none',
    },
    buttonContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: 16,
      paddingVertical: 16,
      backgroundColor: colors.surface,
      height: BUTTON_BAR_HEIGHT,
    },
    actionButton: {
      flex: 1,
      marginHorizontal: 4,
    },
  });