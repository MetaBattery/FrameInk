// app/index.tsx

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Image,
  ScrollView,
  TextInput,
  Alert,
  SafeAreaView,
} from 'react-native';
import {
  Button,
  Surface,
  Text,
  ActivityIndicator,
  Portal,
  Modal,
  useTheme,
} from 'react-native-paper';
import * as ImagePicker from 'expo-image-picker';
import {
  ImageProcessor,
  ProcessedImage,
  GrayscaleResult,
  Orientation,
  ORIENTATIONS,
} from '../../services/imageProcessor';
import ImageCropper from '../../components/ImageCropper';
import { logger } from '../../services/logger';

export default function HomeScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [croppedImage, setCroppedImage] = useState<ProcessedImage | null>(null);
  const [processedResult, setProcessedResult] = useState<GrayscaleResult | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [isCropping, setIsCropping] = useState<boolean>(false);
  const [fileName, setFileName] = useState<string>('');
  const [showSaveModal, setShowSaveModal] = useState<boolean>(false);
  const [selectedOrientation, setSelectedOrientation] = useState<Orientation>(
    ORIENTATIONS.PORTRAIT
  );

  const pickImage = async () => {
    try {
      logger.debug('ImagePicker', 'Requesting permissions');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (status !== 'granted') {
        logger.error('ImagePicker', 'Permission denied', { status });
        Alert.alert(
          'Permission Required',
          'Sorry, we need camera roll permissions to make this work!'
        );
        return;
      }

      logger.debug('ImagePicker', 'Launching image picker');
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });

      logger.debug('ImagePicker', 'Picker result', result);

      if (!result.canceled) {
        logger.debug('ImagePicker', 'Image selected', {
          uri: result.assets[0].uri,
          width: result.assets[0].width,
          height: result.assets[0].height,
        });

        setSelectedImage(result.assets[0].uri);
        setCroppedImage(null);
        setProcessedResult(null);
        setIsCropping(false);
      } else {
        logger.debug('ImagePicker', 'Image selection cancelled');
      }
    } catch (error) {
      logger.error('ImagePicker', 'Error picking image', error);
      Alert.alert('Error', 'Failed to pick image');
    }
  };

  const takePhoto = async () => {
    try {
      logger.debug('ImagePicker', 'Requesting camera permissions');
      const { status } = await ImagePicker.requestCameraPermissionsAsync();

      if (status !== 'granted') {
        logger.error('ImagePicker', 'Camera permission denied', { status });
        Alert.alert(
          'Permission Required',
          'Sorry, we need camera permissions to make this work!'
        );
        return;
      }

      logger.debug('ImagePicker', 'Launching camera');
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 1,
      });

      logger.debug('ImagePicker', 'Camera result', result);

      if (!result.canceled) {
        logger.debug('ImagePicker', 'Photo taken', {
          uri: result.assets[0].uri,
          width: result.assets[0].width,
          height: result.assets[0].height,
        });

        setSelectedImage(result.assets[0].uri);
        setCroppedImage(null);
        setProcessedResult(null);
        setIsCropping(false);
      } else {
        logger.debug('ImagePicker', 'Photo capture cancelled');
      }
    } catch (error) {
      logger.error('ImagePicker', 'Error taking photo', error);
      Alert.alert('Error', 'Failed to take photo');
    }
  };

  const handleCropComplete = async (
    cropData: { originX: number; originY: number; width: number; height: number },
    orientation: Orientation
  ) => {
    try {
      setProcessing(true);
      setSelectedOrientation(orientation);
      const processed = await ImageProcessor.cropAndResize(
        selectedImage!,
        cropData,
        orientation
      );
      setCroppedImage(processed);
      setIsCropping(false);
      setProcessedResult(null);
    } catch (error) {
      console.error('Error processing image:', error);
      Alert.alert('Error', 'Failed to process image');
    } finally {
      setProcessing(false);
    }
  };

  const handleProcessImage = async () => {
    if (!croppedImage) return;

    try {
      setProcessing(true);
      const result = await ImageProcessor.convertToGrayscale4bit(croppedImage);
      setProcessedResult(result);
      setFileName(`frameink_${selectedOrientation}_${Date.now()}`);
      setShowSaveModal(true);
    } catch (error) {
      console.error('Error converting image:', error);
      Alert.alert('Error', 'Failed to convert image');
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveImage = async () => {
    if (!processedResult || !fileName) return;

    try {
      setProcessing(true);
      const savedPath = await ImageProcessor.saveProcessedData(processedResult, fileName);
      Alert.alert('Success', `Image saved successfully to:\n${savedPath}`);
      setShowSaveModal(false);
    } catch (error) {
      console.error('Error saving image:', error);
      Alert.alert('Error', 'Failed to save image');
    } finally {
      setProcessing(false);
    }
  };

  const SaveModal = () => {
    const { colors } = useTheme();

    return (
      <Portal>
        <Modal
          visible={showSaveModal}
          onDismiss={() => setShowSaveModal(false)}
          contentContainerStyle={styles.modalContent}
        >
          <Text style={styles.modalTitle}>Save Processed Image</Text>
          <TextInput
            style={styles.input}
            value={fileName}
            onChangeText={setFileName}
            placeholder="Enter filename"
            placeholderTextColor={colors.placeholder}
          />
          <Text style={styles.modalSubtitle}>
            Orientation: {selectedOrientation}
            {'\n'}Resolution: {processedResult?.width}x{processedResult?.height}
          </Text>
          <View style={styles.modalButtons}>
            <Button
              mode="outlined"
              onPress={() => setShowSaveModal(false)}
              style={styles.modalButton}
            >
              Cancel
            </Button>
            <Button mode="contained" onPress={handleSaveImage} style={styles.modalButton}>
              Save
            </Button>
          </View>
        </Modal>
      </Portal>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Surface style={styles.surface}>
        {processing && (
          <ActivityIndicator animating={true} size="large" style={styles.loader} />
        )}

        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {selectedImage && !isCropping && !croppedImage && (
            <View style={styles.imageContainer}>
              <Image
                source={{ uri: selectedImage }}
                style={styles.image}
                resizeMode="contain"
              />
              <Button
                mode="contained"
                onPress={() => setIsCropping(true)}
                style={styles.button}
              >
                Crop Image
              </Button>
              <Button
                mode="outlined"
                onPress={() => {
                  setSelectedImage(null);
                  setCroppedImage(null);
                  setProcessedResult(null);
                }}
                style={styles.button}
              >
                Select Different Image
              </Button>
            </View>
          )}

          {selectedImage && isCropping && (
            <View style={styles.cropperContainer}>
              <ImageCropper imageUri={selectedImage} onCropComplete={handleCropComplete} />
            </View>
          )}

          {croppedImage && !processedResult && (
            <View style={styles.imageContainer}>
              <Text style={styles.imageInfo}>
                Orientation: {selectedOrientation}
                {'\n'}Resolution: {croppedImage.width}x{croppedImage.height}
              </Text>
              <Image
                source={{ uri: croppedImage.uri }}
                style={styles.image}
                resizeMode="contain"
              />
              <Button
                mode="contained"
                onPress={handleProcessImage}
                style={styles.button}
              >
                Convert to 4-bit Grayscale
              </Button>
              <Button
                mode="outlined"
                onPress={() => {
                  setCroppedImage(null);
                  setIsCropping(true);
                }}
                style={styles.button}
              >
                Crop Again
              </Button>
            </View>
          )}

          {processedResult && (
            <View style={styles.imageContainer}>
              <Text style={styles.imageInfo}>
                Orientation: {selectedOrientation}
                {'\n'}Resolution: {processedResult.width}x{processedResult.height}
              </Text>
              <Image
                source={{ uri: processedResult.previewUri }}
                style={styles.image}
                resizeMode="contain"
              />
              <Button
                mode="contained"
                onPress={() => setShowSaveModal(true)}
                style={styles.button}
              >
                Save Processed Image
              </Button>
              <Button
                mode="outlined"
                onPress={() => {
                  setProcessedResult(null);
                  setCroppedImage(null);
                  setIsCropping(true);
                }}
                style={styles.button}
              >
                Process Again
              </Button>
            </View>
          )}
        </ScrollView>
      </Surface>

      {!selectedImage && !processing && (
        <View style={styles.buttonContainer}>
          <Button mode="contained" onPress={pickImage} style={styles.actionButton}>
            Select Image
          </Button>

          <Button mode="contained" onPress={takePhoto} style={styles.actionButton}>
            Take Photo
          </Button>
        </View>
      )}

      <SaveModal />
    </SafeAreaView>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    surface: {
      flex: 1,
      marginHorizontal: 16,
      marginTop: 16,
      elevation: 4,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    scrollContainer: {
      padding: 16,
      flexGrow: 1,
    },
    buttonContainer: {
      flexDirection: 'row',
      justifyContent: 'space-around',
      paddingHorizontal: 16,
      paddingVertical: 16,
      backgroundColor: colors.surface,
    },
    actionButton: {
      flex: 1,
      marginHorizontal: 8,
    },
    button: {
      marginVertical: 8,
      width: '100%',
    },
    imageContainer: {
      alignItems: 'center',
      marginTop: 20,
    },
    image: {
      width: '100%',
      height: 300,
      marginBottom: 20,
    },
    imageInfo: {
      marginBottom: 10,
      textAlign: 'center',
      color: colors.text,
    },
    loader: {
      marginVertical: 20,
    },
    cropperContainer: {
      height: 400,
      marginVertical: 20,
    },
    modalContent: {
      backgroundColor: colors.surface,
      padding: 20,
      margin: 20,
      borderRadius: 8,
    },
    modalTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      marginBottom: 16,
      color: colors.text,
    },
    modalSubtitle: {
      marginVertical: 8,
      color: colors.text,
    },
    input: {
      backgroundColor: colors.background,
      padding: 10,
      borderRadius: 4,
      marginBottom: 16,
      color: colors.text,
    },
    modalButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    modalButton: {
      marginLeft: 8,
    },
  });