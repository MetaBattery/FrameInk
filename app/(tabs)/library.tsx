// app/(tabs)/library.tsx

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Dimensions,
  TouchableOpacity,
  Modal,
  ScrollView,
  Alert,
  Image,
  Platform,
  StatusBar,
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
} from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { logger } from '../../services/logger';

// Types
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
  const styles = makeStyles(theme.colors);

  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<ProcessedImage | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [sortOption, setSortOption] = useState<SortOption>({
    label: 'Newest',
    value: 'timestamp',
    ascending: false,
  });

  useFocusEffect(
    useCallback(() => {
      loadProcessedImages();
    }, [refreshTrigger])
  );

  const loadProcessedImages = async () => {
    try {
      setLoading(true);
      const directory = `${FileSystem.documentDirectory}processed_images/`;

      const dirInfo = await FileSystem.getInfoAsync(directory);
      if (!dirInfo.exists) {
        setImages([]);
        setLoading(false);
        return;
      }

      const files = await FileSystem.readDirectoryAsync(directory);
      const headerFiles = files.filter((file) => file.endsWith('.h'));
      const processedImages: ProcessedImage[] = [];

      for (const file of headerFiles) {
        const path = `${directory}${file}`;
        const content = await FileSystem.readAsStringAsync(path);
        const fileInfo = await FileSystem.getInfoAsync(path);

        // Extract preview path from .h file
        const previewPathMatch = content.match(/preview_path = "([^"]+)"/);
        let validPreviewPath: string | undefined;

        if (previewPathMatch) {
          const previewPath = previewPathMatch[1];
          const previewExists = await FileSystem.getInfoAsync(previewPath);

          if (previewExists.exists) {
            validPreviewPath = previewPath;
            logger.debug('Library', 'Preview found', {
              filename: file,
              previewPath,
            });
          } else {
            logger.warn('Library', 'Preview path in .h file not found', {
              filename: file,
              previewPath,
            });
          }
        } else {
          // Construct preview path based on filename
          const possiblePreviewPath = `${directory}${file.replace('.h', '_preview.jpg')}`;
          const previewExists = await FileSystem.getInfoAsync(possiblePreviewPath);
          if (previewExists.exists) {
            validPreviewPath = possiblePreviewPath;
            logger.debug('Library', 'Preview found by filename', {
              filename: file,
              previewPath: validPreviewPath,
            });
          } else {
            logger.warn('Library', 'No preview found', {
              filename: file,
              attemptedPaths: [possiblePreviewPath],
            });
          }
        }

        // Extract dimensions
        const widthMatch = content.match(/image_width = (\d+)/);
        const heightMatch = content.match(/image_height = (\d+)/);

        if (widthMatch && heightMatch) {
          const width = parseInt(widthMatch[1]);
          const height = parseInt(heightMatch[1]);

          const timestampMatch = file.match(/_(\d+)\./);
          const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : Date.now();

          processedImages.push({
            filename: file,
            path,
            timestamp,
            dimensions: { width, height },
            fileSize: fileInfo.size || 0,
            previewUri: validPreviewPath,
          });
        }
      }

      // Sort images
      const sortedImages = sortImages(processedImages);
      setImages(sortedImages);
    } catch (error) {
      logger.error('Library', 'Error loading processed images', error);
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
      const newPath = `${directory}${newName}.h`;

      await FileSystem.moveAsync({
        from: selectedImage.path,
        to: newPath,
      });

      if (selectedImage.previewUri) {
        const newPreviewPath = newPath.replace('.h', '_preview.jpg');
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
                filename: newName + '.h',
                path: newPath,
                previewUri: img.previewUri
                  ? newPath.replace('.h', '_preview.jpg')
                  : undefined,
              }
            : img
        )
      );

      setRenameDialogVisible(false);
      setSelectedImage(null);
      setNewFileName('');
    } catch (error) {
      logger.error('Library', 'Error renaming image', error);
      Alert.alert('Error', 'Failed to rename image');
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
      logger.debug('Library', 'Image deleted', { filename: image.filename });
    } catch (error) {
      logger.error('Library', 'Error deleting image', error);
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
                setNewFileName(selectedImage.filename.replace('.h', ''));
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
              onPress={() => {
                Alert.alert('Coming Soon', 'Send to e-paper feature coming soon!');
              }}
              style={styles.modalButton}
            >
              Send to E-Paper
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
      marginHorizontal: 16,
      marginTop: 16,
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
      width: (Dimensions.get('window').width - 64) / 2, // Adjust for padding and margins
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