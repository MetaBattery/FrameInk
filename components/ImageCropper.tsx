// components/ImageCropper.tsx

import React, { useRef, useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  PanResponder,
  Animated,
  Dimensions,
  Image,
  LayoutRectangle,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';
import { Orientation, ORIENTATIONS } from '../services/imageProcessor';
import { logger } from '../services/logger';

interface ImageCropperProps {
  imageUri: string;
  onCropComplete: (cropData: {
    originX: number;
    originY: number;
    width: number;
    height: number;
  }, orientation: Orientation) => void;
}

// Move PADDING and CONTROL_HEIGHT outside the component function
const PADDING = 16;
const CONTROL_HEIGHT = 140;

export default function ImageCropper({ imageUri, onCropComplete }: ImageCropperProps) {
  const { colors } = useTheme();
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [orientation, setOrientation] = useState<Orientation>(ORIENTATIONS.PORTRAIT);
  const [frameLayout, setFrameLayout] = useState<LayoutRectangle | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const pan = useRef(new Animated.ValueXY()).current;

  useEffect(() => {
    if (containerSize.width > 0 && containerSize.height > 0) {
      Image.getSize(
        imageUri,
        (width, height) => {
          const widthRatio = containerSize.width / width;
          const heightRatio = containerSize.height / height;
          const scale = Math.min(widthRatio, heightRatio);

          setImageSize({
            width: width * scale,
            height: height * scale,
          });
        },
        (error) => logger.error('ImageCropper', 'Image load error', error)
      );
    }
  }, [imageUri, containerSize]);

  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      pan.setOffset({
        x: pan.x._value,
        y: pan.y._value,
      });
    },
    onPanResponderMove: Animated.event(
      [null, { dx: pan.x, dy: pan.y }],
      { useNativeDriver: false }
    ),
    onPanResponderRelease: () => {
      pan.flattenOffset();
    },
  });

  const handleCrop = () => {
    if (!frameLayout || imageSize.width === 0 || imageSize.height === 0) return;

    Image.getSize(imageUri, (originalWidth, originalHeight) => {
      const scaleX = originalWidth / imageSize.width;
      const scaleY = originalHeight / imageSize.height;

      const cropData = {
        originX: Math.max(0, -pan.x._value) * scaleX,
        originY: Math.max(0, -pan.y._value) * scaleY,
        width: frameLayout.width * scaleX,
        height: frameLayout.height * scaleY,
      };

      onCropComplete(cropData, orientation);
    });
  };

  const getCropFrameDimensions = () => {
    if (containerSize.width === 0 || containerSize.height === 0)
      return { width: 0, height: 0 };

    const maxWidth = containerSize.width - PADDING * 2;

    if (orientation === ORIENTATIONS.PORTRAIT) {
      const aspectRatio = 540 / 960;
      const frameWidth = maxWidth;
      const frameHeight = frameWidth / aspectRatio;
      return { width: frameWidth, height: frameHeight };
    } else {
      const aspectRatio = 960 / 540;
      const frameWidth = maxWidth;
      const frameHeight = frameWidth / aspectRatio;
      return { width: frameWidth, height: frameHeight };
    }
  };

  const cropFrameDimensions = getCropFrameDimensions();

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
                  transform: [{ translateX: pan.x }, { translateY: pan.y }],
                },
              ]}
              {...panResponder.panHandlers}
            >
              <Image
                source={{ uri: imageUri }}
                style={[styles.image, { width: imageSize.width, height: imageSize.height }]}
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
              onLayout={(event) => setFrameLayout(event.nativeEvent.layout)}
            />
          </View>
        )}
      </View>

      <View style={styles.controls}>
        <View style={styles.buttonContainer}>
          <Button
            mode={orientation === ORIENTATIONS.PORTRAIT ? 'contained' : 'outlined'}
            onPress={() => setOrientation(ORIENTATIONS.PORTRAIT)}
            style={styles.orientationButton}
          >
            Portrait (540x960)
          </Button>
          <Button
            mode={orientation === ORIENTATIONS.LANDSCAPE ? 'contained' : 'outlined'}
            onPress={() => setOrientation(ORIENTATIONS.LANDSCAPE)}
            style={styles.orientationButton}
          >
            Landscape (960x540)
          </Button>
        </View>
        <Button mode="contained" onPress={handleCrop} style={styles.cropButton}>
          Crop Image
        </Button>
      </View>
    </View>
  );
}

// Now CONTROL_HEIGHT is accessible here
const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    imageContainer: {
      flex: 1,
      width: '100%',
    },
    cropArea: {
      flex: 1,
      position: 'relative',
      overflow: 'hidden',
    },
    animatedImageContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
    },
    image: {
      resizeMode: 'contain',
    },
    cropFrame: {
      position: 'absolute',
      borderWidth: 2,
      borderColor: colors.primary,
      backgroundColor: 'transparent',
    },
    controls: {
      height: CONTROL_HEIGHT,
      backgroundColor: colors.surface,
      padding: 16,
      paddingBottom: 24,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    orientationButton: {
      flex: 1,
      marginHorizontal: 4,
    },
    cropButton: {
      marginTop: 4,
    },
  });