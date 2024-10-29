// app/(tabs)/library.tsx

import React, { useEffect, useState } from 'react';
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
  Image
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
  ActivityIndicator
} from 'react-native-paper';
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
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<ProcessedImage | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [renameDialogVisible, setRenameDialogVisible] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>({
    label: 'Newest',
    value: 'timestamp',
    ascending: false
  });

  useEffect(() => {
    loadProcessedImages();
  }, []);

  const loadProcessedImages = async () => {
    try {
      setLoading(true);
      const directory = `${FileSystem.documentDirectory}processed_images/`;
      
      // Ensure directory exists
      const dirInfo = await FileSystem.getInfoAsync(directory);
      if (!dirInfo.exists) {
        setLoading(false);
        return;
      }

      // Read directory contents
      const files = await FileSystem.readDirectoryAsync(directory);
      const headerFiles = files.filter(file => file.endsWith('.h'));

      // Process each header file
      const processedImages: ProcessedImage[] = [];
      
      for (const file of headerFiles) {
        const path = `${directory}${file}`;
        const content = await FileSystem.readAsStringAsync(path);
        const fileInfo = await FileSystem.getInfoAsync(path);
        
        // Check for preview file
        const previewPath = path.replace('.h', '_preview.jpg');
        const previewExists = await FileSystem.getInfoAsync(previewPath);
        
        // Extract dimensions from header file
        const widthMatch = content.match(/image_width = (\d+)/);
        const heightMatch = content.match(/image_height = (\d+)/);
        
        if (widthMatch && heightMatch) {
          const width = parseInt(widthMatch[1]);
          const height = parseInt(heightMatch[1]);
          
          // Extract timestamp from filename
          const timestampMatch = file.match(/frameink_\w+_(\d+)/);
          const timestamp = timestampMatch ? parseInt(timestampMatch[1]) : Date.now();

          processedImages.push({
            filename: file,
            path,
            timestamp,
            dimensions: { width, height },
            fileSize: fileInfo.size || 0,
            previewUri: previewExists.exists ? previewPath : undefined
          });
        }
      }

      // Sort images
      sortImages(processedImages);
      setImages(processedImages);

    } catch (error) {
      logger.error('Library', 'Error loading processed images', error);
      Alert.alert('Error', 'Failed to load processed images');
    } finally {
      setLoading(false);
    }
  };

  const sortImages = (imageList: ProcessedImage[]) => {
    return imageList.sort((a, b) => {
      let valueA, valueB;

      if (sortOption.value.includes('.')) {
        const [obj, prop] = sortOption.value.split('.');
        valueA = a[obj as keyof ProcessedImage][prop as keyof typeof a.dimensions];
        valueB = b[obj as keyof ProcessedImage][prop as keyof typeof b.dimensions];
      } else {
        valueA = a[sortOption.value as keyof ProcessedImage];
        valueB = b[sortOption.value as keyof ProcessedImage];
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
      const newPath = `${directory}${newName}`;
      
      await FileSystem.moveAsync({
        from: selectedImage.path,
        to: newPath
      });

      // If preview exists, rename it too
      if (selectedImage.previewUri) {
        const newPreviewPath = newPath.replace('.h', '_preview.jpg');
        await FileSystem.moveAsync({
          from: selectedImage.previewUri,
          to: newPreviewPath
        });
      }

      setImages(prevImages => 
        prevImages.map(img => 
          img.path === selectedImage.path
            ? { 
                ...img, 
                filename: newName, 
                path: newPath,
                previewUri: img.previewUri 
                  ? newPath.replace('.h', '_preview.jpg')
                  : undefined
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
      
      // Delete preview if it exists
      if (image.previewUri) {
        await FileSystem.deleteAsync(image.previewUri).catch(() => {
          // Ignore error if preview doesn't exist
        });
      }

      setImages(images.filter(img => img.path !== image.path));
      setDetailModalVisible(false);
      setSelectedImage(null);
      logger.debug('Library', 'Image deleted', { filename: image.filename });
    } catch (error) {
      logger.error('Library', 'Error deleting image', error);
      Alert.alert('Error', 'Failed to delete image');
    }
  };

  const filteredImages = images.filter(image => 
    image.filename.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Render functions
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
            <IconButton 
              icon="close" 
              onPress={() => setDetailModalVisible(false)} 
            />
            <Text style={styles.modalTitle} numberOfLines={1}>
              {selectedImage.filename}
            </Text>
            <IconButton 
              icon="pencil" 
              onPress={() => {
                setNewFileName(selectedImage.filename);
                setRenameDialogVisible(true);
              }} 
            />
          </View>

          <ScrollView style={styles.modalContent}>
            <View style={styles.previewContainer}>
              {selectedImage.previewUri ? (
                <Image
                  source={{ uri: selectedImage.previewUri }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Text style={styles.dimensionsText}>
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

          <View style={styles.modalFooter}>
            <Button 
              mode="outlined" 
              onPress={() => {
                Alert.alert(
                  'Delete Image',
                  'Are you sure you want to delete this image?',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { 
                      text: 'Delete', 
                      onPress: () => handleDeleteImage(selectedImage),
                      style: 'destructive'
                    }
                  ]
                );
              }}
              style={[styles.footerButton, styles.deleteButton]}
            >
              Delete
            </Button>
            <Button 
              mode="contained" 
              onPress={() => {
                // TODO: Implement send to e-paper
                Alert.alert('Coming Soon', 'Send to e-paper feature coming soon!');
              }}
              style={styles.footerButton}
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
      >
        <Dialog.Title>Rename Image</Dialog.Title>
        <Dialog.Content>
          <TextInput
            value={newFileName}
            onChangeText={setNewFileName}
            mode="outlined"
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => {
            setRenameDialogVisible(false);
            setNewFileName('');
          }}>
            Cancel
          </Button>
          <Button onPress={() => handleRename(newFileName)}>
            Rename
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );

  const renderItem = ({ item }: { item: ProcessedImage }) => (
    <Card style={styles.card}>
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
              <Text style={styles.dimensionsText}>
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

  // Main render
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Searchbar
          placeholder="Search images"
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
        />
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          style={styles.sortContainer}
        >
          <Chip 
            selected={sortOption.value === 'timestamp'}
            onPress={() => setSortOption({
              label: 'Newest',
              value: 'timestamp',
              ascending: false
            })}
            style={styles.sortChip}
          >
            Newest
          </Chip>
          <Chip 
            selected={sortOption.value === 'filename'}
            onPress={() => setSortOption({
              label: 'Name',
              value: 'filename',
              ascending: true
            })}
            style={styles.sortChip}
          >
            Name
          </Chip>
          <Chip 
            selected={sortOption.value === 'fileSize'}
            onPress={() => setSortOption({
              label: 'Size',
              value: 'fileSize',
              ascending: false
            })}
            style={styles.sortChip}
          >
            Size
          </Chip>
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" />
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
          keyExtractor={item => item.path}
          numColumns={2}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      )}

      {renderImageDetail()}
      {renderRenameDialog()}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  searchBar: {
    marginBottom: 8,
  },
  sortContainer: {
    flexDirection: 'row',
    paddingVertical: 8,
  },
  sortChip: {
    marginRight: 8,
  },
  list: {
    padding: 8,
  },
  card: {
    flex: 1,
    margin: 8,
    maxWidth: Dimensions.get('window').width / 2 - 24,
  },
  imageContainer: {
    aspectRatio: 9/16,
    width: '100%',
    backgroundColor: '#e0e0e0',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
    backgroundColor: '#f5f5f5',
  },
  imagePlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#d0d0d0',
  },
  dimensionsText: {
    color: '#666',
    fontSize: 12,
  },
  filename: {
    fontSize: 14,
    marginTop: 8,
  },
  timestamp: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  modalTitle: {
    flex: 1,
    fontSize: 18,
    marginHorizontal: 8,
  },
  modalContent: {
    flex: 1,
  },
  previewContainer: {
    aspectRatio: 9/16,
    width: '100%',
    backgroundColor: '#f5f5f5',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  detailsContainer: {
    padding: 16,
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
    marginTop: 12,
  },
  detailValue: {
    fontSize: 16,
    marginTop: 4,
  },
  modalFooter: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  footerButton: {
    flex: 1,
    marginHorizontal: 8,
  },
  deleteButton: {
    borderColor: '#ff4444',
  },
});