/**
 * (tabs)/frame-managment.tsx
 * 
 * This React component provides the UI for managing the connected ePaper device.
 * It handles scanning for devices, connecting, displaying device status, listing files,
 * deleting files, and showing transfer progress.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
  SafeAreaView,
} from 'react-native';
import {
  IconButton,
  Button,
  ActivityIndicator,
  useTheme,
  ProgressBar,
  Surface,
  List,
} from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { EnhancedLogger } from '../../services/EnhancedLogger';
import { sharedBLEConnectionManager } from '../../services/BLEConnectionManager';
import { BLECommsManager, FileInfo } from '../../services/BLECommsManager';
import { MaterialIcons } from '@expo/vector-icons';
import { Device } from 'react-native-ble-plx';


const POST_CONNECT_DELAY = 1000; // Delay after connecting before loading files (in ms)

interface ComponentState {
  isInitializing: boolean;
  isConnected: boolean;
  isScanning: boolean;
  isConnecting: boolean;
  hasError: boolean;
  error: string | null;
  isLoading: boolean;
  deviceFiles: FileInfo[];
  deletingFile: string | null;
  transferProgress: { bytesTransferred: number; totalBytes: number; currentSpeed?: number } | null;
  deviceMetrics: { rssi: number; mtu?: number } | null;
}

export default function FrameManagementScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const styles = makeStyles(theme);

  // State for connection and communication managers.
  const [connectionManager] = useState(() => sharedBLEConnectionManager);
  const [commsManager, setCommsManager] = useState<BLECommsManager | null>(null);
  
  // Component state for UI feedback.
  const [componentState, setComponentState] = useState<ComponentState>({
    isInitializing: false,
    isConnected: false,
    isScanning: false,
    isConnecting: false,
    hasError: false,
    error: null,
    isLoading: false,
    deviceFiles: [],
    deletingFile: null,
    transferProgress: null,
    deviceMetrics: null,
  });

  /**
   * Helper function to update component state.
   * @param updates Partial state updates.
   */
  const updateState = useCallback((updates: Partial<ComponentState>) => {
    EnhancedLogger.debug('FrameManagement', 'Updating state', updates);
    setComponentState(current => ({
      ...current,
      ...updates,
    }));
  }, []);

  // Check for existing connection and load files when screen is focused.
  useFocusEffect(
    useCallback(() => {
      const checkConnectionAndLoadFiles = async () => {
        if (await connectionManager.isDeviceConnected()) {
          loadDeviceFiles();
        }
      };
      checkConnectionAndLoadFiles();
      return () => {
        // Cleanup if needed.
      };
    }, [])
  );

  /**
   * Initiates a scan for BLE devices.
   * If a device is found, proceeds to handle connection.
   */
  const startScan = async () => {
    EnhancedLogger.debug('FrameManagement', 'Start scan initiated');
    try {
      updateState({ isScanning: true, error: null, hasError: false });
      const devices = await connectionManager.scanForDevices();
      if (devices.length > 0) {
        await handleDeviceConnection(devices[0]);
      } else {
        throw new Error('No FrameInk devices found');
      }
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Scan error', error as Error);
      updateState({
        hasError: true,
        error: `Scan failed: ${(error as Error).message}`,
      });
      Alert.alert('Scan Error', 'Failed to scan for devices. Please try again.');
    } finally {
      updateState({ isScanning: false });
    }
  };

  /**
   * Handles connecting to a selected device and initializes communication manager.
   * @param device The BLE device to connect to.
   */
  const handleDeviceConnection = async (device: Device) => {
    EnhancedLogger.debug('FrameManagement', 'Handling device connection', { 
      deviceId: device.id,
      deviceName: device.name,
    });
    try {
      updateState({ isConnecting: true, error: null, hasError: false });
      await connectionManager.connectAndPrepare(device);
      const newCommsManager = new BLECommsManager(device);
      setCommsManager(newCommsManager);
      updateState({ 
        isConnected: true, 
        deviceMetrics: { rssi: device.rssi || 0 },
      });
      // Delay to ensure device is ready before file operations.
      await new Promise(resolve => setTimeout(resolve, POST_CONNECT_DELAY));
      await loadDeviceFiles();
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Connection error', error as Error);
      updateState({
        hasError: true,
        error: 'Failed to connect to device. Please try again.',
      });
      Alert.alert('Connection Error', 'Failed to connect to device. Please try again.');
    } finally {
      updateState({ isConnecting: false });
    }
  };

  /**
   * Loads the list of files from the connected device using BLECommsManager.
   */
  const loadDeviceFiles = async () => {
    if (!commsManager) return;
    try {
      updateState({ isLoading: true, error: null, hasError: false });
      EnhancedLogger.debug('FrameManagement', 'Starting to load device files');
      const files = await commsManager.listFilesWithRetry();
      EnhancedLogger.debug('FrameManagement', 'Files loaded successfully', { fileCount: files.length });
      updateState({ deviceFiles: files });
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'File list error', error as Error);
      updateState({
        hasError: true,
        error: `Failed to load files: ${(error as Error).message}`,
      });
      Alert.alert('Error', `Failed to load files from device: ${(error as Error).message}`);
    } finally {
      updateState({ isLoading: false });
    }
  };

  /**
   * Deletes a file from the device.
   * @param filename The name of the file to delete.
   */
  const handleDeleteFile = async (filename: string) => {
    if (!commsManager) return;
    try {
      updateState({ deletingFile: filename, error: null, hasError: false });
      await commsManager.deleteFile(filename);
      await loadDeviceFiles();
      Alert.alert('Success', 'File deleted successfully');
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Delete error', error as Error);
      updateState({
        hasError: true,
        error: 'Failed to delete file',
      });
      Alert.alert('Error', 'Failed to delete file');
    } finally {
      updateState({ deletingFile: null });
    }
  };

  /**
   * Disconnects from the current BLE device.
   */
  const handleDisconnection = async () => {
    EnhancedLogger.debug('FrameManagement', 'Handling disconnection');
    try {
      await connectionManager.disconnect();
      setCommsManager(null);
      updateState({
        isConnected: false,
        deviceFiles: [],
        transferProgress: null,
        deviceMetrics: null,
      });
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Disconnect error', error as Error);
      updateState({
        hasError: true,
        error: 'Failed to disconnect',
      });
      Alert.alert('Error', 'Failed to disconnect from device');
    }
  };

  /**
   * Component to display the connection status and device metrics.
   */
  const ConnectionStatus = () => {
    const device = connectionManager.getConnectedDevice();
    const metrics = componentState.deviceMetrics;
    
    /**
     * Determines the connection quality based on RSSI value.
     * @param rssi The RSSI value.
     * @returns A string representing connection quality.
     */
    const getConnectionQuality = (rssi: number): string => {
      if (rssi >= -60) return 'Excellent';
      if (rssi >= -70) return 'Good';
      if (rssi >= -80) return 'Fair';
      return 'Poor';
    };

    return (
      <View style={styles.statusContainer}>
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: componentState.isConnected ? theme.colors.success : theme.colors.error },
          ]}
        />
        <View style={styles.statusTextContainer}>
          <Text style={styles.statusText}>
            Status: {componentState.isConnected ? 'Connected' : 'Not Connected'}
          </Text>
          {device && (
            <>
              <Text style={styles.deviceName}>
                Device: {device.name || 'Unknown'}
              </Text>
              {metrics && (
                <Text style={styles.connectionDetails}>
                  Signal: {getConnectionQuality(metrics.rssi)} ({metrics.rssi} dBm)
                  {metrics.mtu ? ` • MTU: ${metrics.mtu}` : ''}
                </Text>
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  // Render the main UI.
  return (
    <SafeAreaView style={styles.container}>
      <Surface style={styles.surface}>
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {componentState.error && (
            <View style={styles.errorContainer}>
              <MaterialIcons name="error" size={24} color={colors.error} />
              <Text style={styles.errorText}>{componentState.error}</Text>
            </View>
          )}

          <ConnectionStatus />

          {componentState.transferProgress && componentState.transferProgress.totalBytes > 0 && (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>
                Transferring: {Math.round((componentState.transferProgress.bytesTransferred / 
                  componentState.transferProgress.totalBytes) * 100)}%
                {componentState.transferProgress.currentSpeed && 
                  ` (${(componentState.transferProgress.currentSpeed / 1024).toFixed(2)} KB/s)`}
              </Text>
              <ProgressBar
                progress={componentState.transferProgress.bytesTransferred / 
                  componentState.transferProgress.totalBytes}
                color={colors.primary}
                style={styles.progressBar}
              />
            </View>
          )}

          {!componentState.isConnected ? (
            <Button
              mode="contained"
              onPress={startScan}
              loading={componentState.isScanning || componentState.isConnecting}
              disabled={componentState.isScanning || componentState.isConnecting}
              style={styles.button}
              icon={({ size, color }) => (
                <MaterialIcons name="bluetooth-searching" size={size} color={color} />
              )}
            >
              {componentState.isScanning
                ? 'Scanning...'
                : componentState.isConnecting
                ? 'Connecting...'
                : 'Connect to Device'}
            </Button>
          ) : (
            <Button
              mode="outlined"
              onPress={handleDisconnection}
              style={styles.button}
              icon={({ size, color }) => (
                <MaterialIcons name="bluetooth-disabled" size={size} color={color} />
              )}
            >
              Disconnect
            </Button>
          )}

          {componentState.isConnected && (
            <View style={styles.fileListContainer}>
              <View style={styles.fileListHeader}>
                <Text style={styles.sectionTitle}>Device Files</Text>
                <IconButton
                  icon="refresh"
                  onPress={loadDeviceFiles}
                  disabled={componentState.isLoading}
                />
              </View>
              
              {componentState.isLoading ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" />
                  <Text style={styles.loadingText}>Loading files...</Text>
                </View>
              ) : componentState.deviceFiles.length > 0 ? (
                componentState.deviceFiles.map((file, index) => (
                  <List.Item
                    key={index}
                    title={file.name}
                    description={`Size: ${(file.size / 1024).toFixed(1)} KB`}
                    right={props => (
                      <IconButton
                        {...props}
                        icon="delete"
                        onPress={() => handleDeleteFile(file.name)}
                        disabled={componentState.isLoading || componentState.deletingFile === file.name}
                        loading={componentState.deletingFile === file.name}
                      />
                    )}
                    style={styles.fileItem}
                  />
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>No files found on device</Text>
                  <Button mode="text" onPress={loadDeviceFiles} style={styles.refreshButton}>
                    Refresh
                  </Button>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </Surface>
    </SafeAreaView>
  );
}

// Define styles for the component.
const makeStyles = ({ colors }: ReturnType<typeof useTheme>) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    surface: {
      flex: 1,
      marginHorizontal: 16,
      marginVertical: 16,
      elevation: 4,
      borderRadius: 8,
      backgroundColor: colors.surface,
    },
    scrollContainer: {
      padding: 16,
      flexGrow: 1,
    },
    centerContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    errorContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 16,
      backgroundColor: colors.errorContainer,
      borderRadius: 8,
      marginBottom: 16,
    },
    errorText: {
      flex: 1,
      color: colors.onErrorContainer,
      marginLeft: 8,
      fontSize: 14,
    },
    statusContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 16,
      padding: 12,
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
    },
    statusIndicator: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 8,
    },
    statusTextContainer: {
      flex: 1,
    },
    statusText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.onSurface,
    },
    deviceName: {
      fontSize: 16,
      color: colors.onSurfaceVariant,
      marginTop: 4,
    },
    connectionDetails: {
      fontSize: 14,
      color: colors.secondary,
      marginTop: 4,
    },
    progressContainer: {
      marginVertical: 8,
      padding: 12,
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
    },
    progressText: {
      fontSize: 14,
      color: colors.onSurfaceVariant,
      marginBottom: 8,
    },
    progressBar: {
      height: 4,
      borderRadius: 2,
    },
    button: {
      marginVertical: 8,
    },
    fileListContainer: {
      marginTop: 24,
    },
    fileListHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 20,
      fontWeight: 'bold',
      color: colors.onSurface,
    },
    fileItem: {
      padding: 0,
      marginVertical: 4,
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
    },
    emptyState: {
      alignItems: 'center',
      padding: 20,
    },
    emptyStateText: {
      color: colors.onSurfaceVariant,
      fontSize: 16,
      textAlign: 'center',
      marginBottom: 12,
    },
    refreshButton: {
      marginTop: 8,
    },
    debugContainer: {
      padding: 12,
      marginBottom: 16,
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
      overflow: 'hidden',
    },
    debugText: {
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      fontSize: 12,
      color: colors.onSurfaceVariant,
    },
    initializingText: {
      marginTop: 16,
      fontSize: 16,
      color: colors.onSurface,
    },
    loadingText: {
      marginTop: 16,
      fontSize: 16,
      color: colors.onSurface,
    },
    divider: {
      marginVertical: 8,
    },
    chipContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
    chip: {
      marginRight: 8,
      marginBottom: 8,
    },
    actionButton: {
      marginVertical: 4,
    },
    warningContainer: {
      padding: 12,
      backgroundColor: colors.warningContainer,
      borderRadius: 8,
      marginBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
    },
    warningText: {
      color: colors.onWarningContainer,
      flex: 1,
      marginLeft: 8,
    },
  });
