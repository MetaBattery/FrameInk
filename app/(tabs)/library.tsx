import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Dimensions,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import {
  Card,
  IconButton,
  Button,
  Portal,
  Dialog,
  TextInput,
  Searchbar,
  Chip,
  ActivityIndicator,
  useTheme,
  ProgressBar,
} from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { EnhancedLogger } from '../../services/EnhancedLogger';
import { sharedBLEConnectionManager } from '../../services/BLEConnectionManager';
import { BLECommsManager } from '../../services/BLECommsManager';

interface ProcessedImage {
  filename: string;
  path: string;
  timestamp: number;
  dimensions: {
    width: number;
    height: number;
  };
  previewUri?: string;
  fileSize: number;
}

interface SortOption {
  label: string;
  value: keyof ProcessedImage | 'dimensions.width' | 'dimensions.height';
  ascending: boolean;
}

export default function LibraryScreen() {
  const theme = useTheme();
  // Memoize styles so they are not recreated on every render.
  const styles = useMemo(() => makeStyles(theme.colors), [theme.colors]);

  // Use the shared BLE connection manager.
  const [connectionManager] = useState(() => sharedBLEConnectionManager);
  const [commsManager, setCommsManager] = useState<BLECommsManager | null>(null);

  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<ProcessedImage | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [transferProgress, setTransferProgress] = useState<{ bytesTransferred: number; totalBytes: number } | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [sortOption, setSortOption] = useState<SortOption>({
    label: 'Newest',
    value: 'timestamp',
    ascending: false,
  });

  useFocusEffect(
    useCallback(() => {
      loadProcessedImages();

      const setupBLEManagers = async () => {
        try {
          const device = connectionManager.getConnectedDevice();
          if (device) {
            const newCommsManager = new BLECommsManager(device);
            setCommsManager(newCommsManager);
          }
        } catch (error) {
          EnhancedLogger.error('Library', 'Failed to setup BLE managers', error);
        }
      };

      setupBLEManagers();

      return () => {
        setCommsManager(null);
      };
    }, [refreshTrigger])
  );

  // Helper to get image dimensions from a URI.
  const getImageDimensions = (uri: string): Promise<{ width: number; height: number }> =>
    new Promise((resolve, reject) => {
      Image.getSize(
        uri,
        (width, height) => resolve({ width, height }),
        (error) => {
          EnhancedLogger.error('Library', 'Error getting image size', error);
          resolve({ width: 0, height: 0 });
        }
      );
    });

  const loadProcessedImages = async () => {
    try {
      setLoading(true);
      const directory = `${FileSystem.documentDirectory}processed_images/`;
      const dirInfo = await FileSystem.getInfoAsync(directory);
      if (!dirInfo.exists) {
        setImages([]);
        return;
      }
      const files = await FileSystem.readDirectoryAsync(directory);
      // Filter for .bin files—the new processed image format.
      const processedFiles = files.filter((file) => file.endsWith('.bin'));
      const processedImages: ProcessedImage[] = [];

      for (const file of processedFiles) {
        const path = `${directory}${file}`;
        // Derive preview URI from the file name:
        // e.g., frameink_portrait_1738396854591.bin  -> frameink_portrait_1738396854591_preview.jpg
        const previewUri = `${directory}${file.replace('.bin', '_preview.jpg')}`;

        // Extract timestamp from the filename (assuming a pattern like _<timestamp>.bin)
        const timestampMatch = file.match(/_(\d+)\.bin$/);
        const timestamp = timestampMatch ? parseInt(timestampMatch[1], 10) : Date.now();

        // Get dimensions from the preview image
        const dimensions = await getImageDimensions(previewUri);
        const fileInfo = await FileSystem.getInfoAsync(path);

        processedImages.push({
          filename: file,
          path,
          timestamp,
          dimensions: { width: dimensions.width, height: dimensions.height },
          fileSize: fileInfo.size || 0,
          previewUri,
        });
      }

      const sortedImages = sortImages(processedImages);
      setImages(sortedImages);
    } catch (error) {
      EnhancedLogger.error('Library', 'Error loading processed images', error);
      Alert.alert('Error', 'Failed to load processed images');
    } finally {
      setLoading(false);
    }
  };

  const sortImages = (imageList: ProcessedImage[]) => {
    return [...imageList].sort((a, b) => {
      let valueA: any, valueB: any;
      if (sortOption.value.includes('.')) {
        const [obj, prop] = sortOption.value.split('.');
        valueA = (a as any)[obj][prop];
        valueB = (b as any)[obj][prop];
      } else {
        valueA = (a as any)[sortOption.value];
        valueB = (b as any)[sortOption.value];
      }
      if (sortOption.ascending) {
        return valueA > valueB ? 1 : -1;
      } else {
        return valueA < valueB ? 1 : -1;
      }
    });
  };

  const handleRename = async (newName: string) => {
    if (!selectedImage || !newName.trim()) return;
    try {
      const directory = `${FileSystem.documentDirectory}processed_images/`;
      // Preserve the .bin extension.
      const newPath = `${directory}${newName}.bin`;

      await FileSystem.moveAsync({
        from: selectedImage.path,
        to: newPath,
      });

      if (selectedImage.previewUri) {
        const newPreviewPath = newPath.replace('.bin', '_preview.jpg');
        await FileSystem.moveAsync({
          from: selectedImage.previewUri,
          to: newPreviewPath,
        });
      }

      setImages((prevImages) =>
        prevImages.map((img) =>
          img.path === selectedImage.path
            ? {
                ...img,
                filename: newName + '.bin',
                path: newPath,
                previewUri: img.previewUri
                  ? newPath.replace('.bin', '_preview.jpg')
                  : undefined,
              }
            : img
        )
      );
      setRenameDialogVisible(false);
      setSelectedImage(null);
      setNewFileName('');
    } catch (error) {
      EnhancedLogger.error('Library', 'Error renaming image', error);
      Alert.alert('Error', 'Failed to rename image');
    }
  };

  const handleSendToFrame = async (image: ProcessedImage) => {
    try {
      // Use the commsManager (shared from the connection) if available.
      let manager = commsManager;
      if (!manager) {
        const device = connectionManager.getConnectedDevice();
        if (device) {
          manager = new BLECommsManager(device);
          setCommsManager(manager);
        } else {
          Alert.alert(
            'Not Connected',
            'Please connect to your frame first in the Frame Management screen.',
            [{ text: 'OK', onPress: () => setDetailModalVisible(false) }]
          );
          return;
        }
      }
      setIsTransferring(true);
      const fileContent = await FileSystem.readAsStringAsync(image.path, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const buffer = new Uint8Array(Buffer.from(fileContent, 'base64')).buffer;
      await manager.transferFile(image.filename, buffer, (progress) => {
        setTransferProgress(progress);
      });
      Alert.alert('Success', 'Image sent to frame successfully!');
      setDetailModalVisible(false);
    } catch (error) {
      EnhancedLogger.error('Library', 'Error sending image to frame', error);
      Alert.alert('Error', 'Failed to send image to frame');
    } finally {
      setIsTransferring(false);
      setTransferProgress(null);
    }
  };

  const handleDeleteImage = async (image: ProcessedImage) => {
    try {
      await FileSystem.deleteAsync(image.path);
      if (image.previewUri) {
        await FileSystem.deleteAsync(image.previewUri).catch(() => {
          // Ignore error if preview doesn't exist
        });
      }
      setImages(images.filter((img) => img.path !== image.path));
      setDetailModalVisible(false);
      setSelectedImage(null);
      EnhancedLogger.debug('Library', 'Image deleted', { filename: image.filename });
    } catch (error) {
      EnhancedLogger.error('Library', 'Error deleting image', error);
      Alert.alert('Error', 'Failed to delete image');
    }
  };

  const refresh = () => {
    setRefreshTrigger((prev) => prev + 1);
  };

  const filteredImages = images.filter((image) =>
    image.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const renderImageDetail = () => (
    <Modal
      visible={detailModalVisible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={() => setDetailModalVisible(false)}
    >
      {selectedImage && (
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <IconButton icon="close" onPress={() => setDetailModalVisible(false)} />
            <Text style={styles.modalTitle} numberOfLines={1}>
              {selectedImage.filename}
            </Text>
            <IconButton
              icon="pencil"
              onPress={() => {
                // Use the filename without extension for renaming.
                setNewFileName(selectedImage.filename.replace('.bin', ''));
                setRenameDialogVisible(true);
              }}
            />
          </View>
          <ScrollView contentContainerStyle={styles.scrollContainer}>
            <View style={styles.imageContainer}>
              {selectedImage.previewUri ? (
                <Image
                  source={{ uri: selectedImage.previewUri }}
                  style={styles.image}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Text style={styles.imageInfo}>
                    {selectedImage.dimensions.width} × {selectedImage.dimensions.height}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.detailsContainer}>
              <Text style={styles.detailLabel}>Dimensions</Text>
              <Text style={styles.detailValue}>
                {selectedImage.dimensions.width} × {selectedImage.dimensions.height} pixels
              </Text>
              <Text style={styles.detailLabel}>Created</Text>
              <Text style={styles.detailValue}>
                {new Date(selectedImage.timestamp).toLocaleString()}
              </Text>
              <Text style={styles.detailLabel}>File Size</Text>
              <Text style={styles.detailValue}>
                {(selectedImage.fileSize / 1024).toFixed(2)} KB
              </Text>
            </View>
            {transferProgress && (
              <View style={styles.progressContainer}>
                <Text style={styles.progressText}>
                  Transferring:{' '}
                  {Math.round((transferProgress.bytesTransferred / transferProgress.totalBytes) * 100)}%
                </Text>
                <ProgressBar
                  progress={transferProgress.bytesTransferred / transferProgress.totalBytes}
                  color={theme.colors.primary}
                  style={styles.progressBar}
                />
              </View>
            )}
          </ScrollView>
          <View style={styles.modalButtons}>
            <Button
              mode="outlined"
              onPress={() => {
                Alert.alert('Delete Image', 'Are you sure you want to delete this image?', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    onPress: () => handleDeleteImage(selectedImage),
                    style: 'destructive',
                  },
                ]);
              }}
              style={[styles.modalButton, styles.deleteButton]}
            >
              Delete
            </Button>
            <Button
              mode="contained"
              onPress={() => handleSendToFrame(selectedImage)}
              style={styles.modalButton}
              loading={isTransferring}
              disabled={isTransferring}
            >
              {isTransferring ? 'Sending...' : 'Send to E-Paper'}
            </Button>
          </View>
        </View>
      )}
    </Modal>
  );

  const renderRenameDialog = () => (
    <Portal>
      <Dialog
        visible={renameDialogVisible}
        onDismiss={() => {
          setRenameDialogVisible(false);
          setNewFileName('');
        }}
        style={styles.modalContent}
      >
        <Dialog.Title style={styles.modalTitle}>Rename Image</Dialog.Title>
        <Dialog.Content>
          <TextInput
            value={newFileName}
            onChangeText={setNewFileName}
            mode="outlined"
            style={styles.input}
          />
        </Dialog.Content>
        <Dialog.Actions style={styles.modalButtons}>
          <Button
            onPress={() => {
              setRenameDialogVisible(false);
              setNewFileName('');
            }}
            style={styles.modalButton}
          >
            Cancel
          </Button>
          <Button onPress={() => handleRename(newFileName)} style={styles.modalButton}>
            Rename
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );

  const renderItem = ({ item }: { item: ProcessedImage }) => (
    <Card style={[styles.surface, styles.card]}>
      <TouchableOpacity
        onPress={() => {
          setSelectedImage(item);
          setDetailModalVisible(true);
        }}
      >
        <View style={styles.imageContainer}>
          {item.previewUri ? (
            <Image
              source={{ uri: item.previewUri }}
              style={styles.image}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imageInfo}>
                {item.dimensions.width} × {item.dimensions.height}
              </Text>
            </View>
          )}
        </View>
        <Card.Content>
          <Text style={styles.filename} numberOfLines={1}>
            {item.filename}
          </Text>
          <Text style={styles.timestamp}>
            {new Date(item.timestamp).toLocaleDateString()}
          </Text>
        </Card.Content>
      </TouchableOpacity>
    </Card>
  );

  return (
    <View style={styles.container}>
      <View style={styles.headerSpacer} />
      <View style={styles.buttonContainer}>
        <Searchbar
          placeholder="Search images"
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />
        <View style={styles.sortContainer}>
          <Chip
            selected={sortOption.value === 'timestamp'}
            onPress={() =>
              setSortOption({
                label: 'Newest',
                value: 'timestamp',
                ascending: false,
              })
            }
            style={[
              styles.sortChip,
              sortOption.value === 'timestamp' ? styles.activeChip : styles.inactiveChip,
            ]}
            textStyle={styles.chipText}
          >
            Newest
          </Chip>
          <Chip
            selected={sortOption.value === 'filename'}
            onPress={() =>
              setSortOption({
                label: 'Name',
                value: 'filename',
                ascending: true,
              })
            }
            style={[
              styles.sortChip,
              sortOption.value === 'filename' ? styles.activeChip : styles.inactiveChip,
            ]}
            textStyle={styles.chipText}
          >
            Name
          </Chip>
          <Chip
            selected={sortOption.value === 'fileSize'}
            onPress={() =>
              setSortOption({
                label: 'Size',
                value: 'fileSize',
                ascending: false,
              })
            }
            style={[
              styles.sortChip,
              sortOption.value === 'fileSize' ? styles.activeChip : styles.inactiveChip,
            ]}
            textStyle={styles.chipText}
          >
            Size
          </Chip>
        </View>
      </View>
      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      ) : filteredImages.length === 0 ? (
        <View style={styles.centerContainer}>
          <Text style={styles.emptyText}>
            {searchQuery ? 'No matching images found' : 'No processed images yet'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredImages}
          renderItem={renderItem}
          keyExtractor={(item) => item.path}
          numColumns={2}
          contentContainerStyle={styles.scrollContainer}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={refresh}
        />
      )}
      {renderImageDetail()}
      {renderRenameDialog()}
    </View>
  );
}

const makeStyles = (colors: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerSpacer: {
      height: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
      backgroundColor: colors.surface,
    },
    surface: {
      elevation: 4,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    scrollContainer: {
      padding: 16,
      flexGrow: 1,
    },
    buttonContainer: {
      backgroundColor: colors.surface,
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    searchBar: {
      backgroundColor: colors.background,
      marginBottom: 8,
    },
    sortContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    sortChip: {
      flex: 1,
      marginHorizontal: 4,
      borderRadius: 4,
    },
    activeChip: {
      backgroundColor: colors.primary,
    },
    inactiveChip: {
      backgroundColor: colors.surfaceVariant,
    },
    chipText: {
      color: colors.onPrimary,
      textAlign: 'center',
    },
    card: {
      margin: 8,
      width: (Dimensions.get('window').width - 64) / 2,
    },
    imageContainer: {
      alignItems: 'center',
      marginTop: 20,
    },
    image: {
      width: '100%',
      height: 150,
      marginBottom: 20,
    },
    imagePlaceholder: {
      width: '100%',
      height: 150,
      backgroundColor: colors.surfaceVariant,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    imageInfo: {
      marginBottom: 10,
      textAlign: 'center',
      color: colors.text,
    },
    filename: {
      fontSize: 14,
      marginTop: 8,
      color: colors.text,
    },
    timestamp: {
      fontSize: 12,
      color: colors.onSurfaceVariant,
      marginTop: 4,
    },
    centerContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: colors.onSurfaceVariant,
      fontSize: 16,
    },
    modalContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.outline,
      backgroundColor: colors.surface,
    },
    modalTitle: {
      flex: 1,
      fontSize: 18,
      marginHorizontal: 8,
      color: colors.text,
    },
    modalContent: {
      backgroundColor: colors.surface,
      padding: 20,
      margin: 20,
      borderRadius: 8,
    },
    detailsContainer: {
      padding: 16,
    },
    detailLabel: {
      fontSize: 14,
      color: colors.onSurfaceVariant,
      marginTop: 12,
    },
    detailValue: {
      fontSize: 16,
      marginTop: 4,
      color: colors.text,
    },
    progressContainer: {
      marginHorizontal: 16,
      marginBottom: 16,
      padding: 8,
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
    },
    progressText: {
      fontSize: 14,
      color: colors.onSurfaceVariant,
      marginBottom: 4,
    },
    progressBar: {
      height: 4,
      borderRadius: 2,
    },
    modalButtons: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      padding: 16,
      backgroundColor: colors.surface,
    },
    modalButton: {
      marginLeft: 8,
    },
    deleteButton: {
      borderColor: colors.error,
    },
    input: {
      backgroundColor: colors.background,
      padding: 10,
      borderRadius: 4,
      marginBottom: 16,
      color: colors.text,
    },
  });
