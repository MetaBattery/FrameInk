// components/ImageDetailModal.tsx
import React from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Text,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Image
} from 'react-native';
import { IconButton, Button } from 'react-native-paper';
import { ProcessedImage } from '../services/imageProcessor';

interface ImageDetailModalProps {
  image: ProcessedImage | null;
  visible: boolean;
  onClose: () => void;
  onDelete: (image: ProcessedImage) => void;
  onRename: (image: ProcessedImage) => void;
  onSend?: (image: ProcessedImage) => void; // For future e-paper sending feature
}

export function ImageDetailModal({ 
  image, 
  visible, 
  onClose, 
  onDelete, 
  onRename,
  onSend 
}: ImageDetailModalProps) {
  if (!image) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <View style={styles.header}>
          <IconButton icon="close" onPress={onClose} />
          <Text style={styles.title} numberOfLines={1}>
            {image.filename}
          </Text>
          <IconButton 
            icon="dots-vertical" 
            onPress={() => {
              // Add options menu here
            }} 
          />
        </View>

        <ScrollView style={styles.content}>
          <View style={styles.previewContainer}>
            {image.previewUri ? (
              <Image
                source={{ uri: image.previewUri }}
                style={styles.preview}
                resizeMode="contain"
              />
            ) : (
              <View style={styles.placeholderPreview}>
                <Text>No preview available</Text>
              </View>
            )}
          </View>

          <View style={styles.detailsContainer}>
            <Text style={styles.detailLabel}>Dimensions</Text>
            <Text style={styles.detailValue}>
              {image.dimensions.width} × {image.dimensions.height}
            </Text>

            <Text style={styles.detailLabel}>Created</Text>
            <Text style={styles.detailValue}>
              {new Date(image.timestamp).toLocaleString()}
            </Text>

            <Text style={styles.detailLabel}>File Size</Text>
            <Text style={styles.detailValue}>
              {(image.fileSize / 1024).toFixed(2)} KB
            </Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Button 
            mode="outlined" 
            onPress={() => onRename(image)}
            style={styles.footerButton}
          >
            Rename
          </Button>
          {onSend && (
            <Button 
              mode="contained" 
              onPress={() => onSend(image)}
              style={styles.footerButton}
            >
              Send to E-Paper
            </Button>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  title: {
    flex: 1,
    fontSize: 18,
    marginHorizontal: 8,
  },
  content: {
    flex: 1,
  },
  previewContainer: {
    aspectRatio: 9/16,
    width: '100%',
    backgroundColor: '#f5f5f5',
  },
  preview: {
    width: '100%',
    height: '100%',
  },
  placeholderPreview: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  footer: {
    flexDirection: 'row',
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  footerButton: {
    flex: 1,
    marginHorizontal: 8,
  },
});