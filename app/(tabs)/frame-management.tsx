/**
 * (tabs)/frame-managment.tsx
 * 
 * This React component provides the UI for managing the connected ePaper device.
 * It handles scanning for devices, connecting via BLE and WiFi, displaying device status,
 * listing files, deleting files, and showing transfer progress.
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
  TextInput,
  Dialog,
  Chip,
} from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import { EnhancedLogger } from '../../services/EnhancedLogger';
import { sharedBLEConnectionManager } from '../../services/BLEConnectionManager';
import { BLECommsManager, FileInfo as BLEFileInfo } from '../../services/BLECommsManager';
import { WifiRestApiClient, FileInfo as WiFiFileInfo } from '../../services/WifiRestApiClient';
import { MaterialIcons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Device } from 'react-native-ble-plx';

// Type alias to ensure both file info types are compatible
type FileInfo = BLEFileInfo | WiFiFileInfo;

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
  
  // WiFi related states
  wifiConnected: boolean;
  wifiConnecting: boolean;
  deviceIp: string | null;
  connectionType: 'ble' | 'wifi' | null;
  wifiDialogVisible: boolean;
  activeWifiTransfer: boolean;
}

export default function FrameManagementScreen() {
  const theme = useTheme();
  const { colors } = theme;
  const styles = makeStyles(theme);

  // State for connection and communication managers
  const [connectionManager] = useState(() => sharedBLEConnectionManager);
  const [commsManager, setCommsManager] = useState<BLECommsManager | null>(null);
  const [apiClient, setApiClient] = useState<WifiRestApiClient | null>(null);
  
  // Component state for UI feedback
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
    
    // WiFi related states
    wifiConnected: false,
    wifiConnecting: false,
    deviceIp: null,
    connectionType: null,
    wifiDialogVisible: false,
    activeWifiTransfer: false,
  });

  const testApiConnection = async (ipAddress: string, maxRetries = 10, initialDelay = 500): Promise<boolean> => {
    const baseUrl = `http://${ipAddress}`;
    EnhancedLogger.debug('FrameManagement', `Testing API connection to ${baseUrl}`);
    
    for (let i = 0; i < maxRetries; i++) {
      // Exponential backoff with initial delay
      const delayMs = initialDelay * Math.pow(1.5, i);
      EnhancedLogger.debug('FrameManagement', `Attempt ${i+1}/${maxRetries} (delay: ${delayMs}ms)`);
      
      try {
        // Use XMLHttpRequest for more control and potentially different behavior than fetch
        const result = await new Promise<boolean>((resolve) => {
          const xhr = new XMLHttpRequest();
          xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
              EnhancedLogger.debug('FrameManagement', `XHR Status: ${xhr.status}, Response: ${xhr.responseText}`);
              resolve(xhr.status >= 200 && xhr.status < 300);
            }
          };
          xhr.onerror = function(e) {
            EnhancedLogger.debug('FrameManagement', `XHR Error`, e);
            resolve(false);
          };
          xhr.ontimeout = function() {
            EnhancedLogger.debug('FrameManagement', `XHR Timeout`);
            resolve(false);
          };
          xhr.open('GET', `${baseUrl}/api/storage`, true);
          xhr.timeout = 5000; // 5 second timeout
          xhr.send();
        });
        
        if (result) {
          EnhancedLogger.debug('FrameManagement', `API connection successful on attempt ${i+1}`);
          return true;
        }
        
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } catch (error) {
        EnhancedLogger.error('FrameManagement', `API test error on attempt ${i+1}`, error as Error);
        // Wait before next attempt
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    EnhancedLogger.debug('FrameManagement', `API connection failed after ${maxRetries} attempts`);
    return false;
  };

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

  // Check for existing connection and load files when screen is focused
  useFocusEffect(
    useCallback(() => {
      const checkConnectionAndLoadFiles = async () => {
        if (await connectionManager.isDeviceConnected()) {
          // If we have an active WiFi connection, load files via WiFi
          if (componentState.wifiConnected && apiClient) {
            loadDeviceFilesWifi();
          } else {
            loadDeviceFiles();
          }
        }
      };
      checkConnectionAndLoadFiles();
      return () => {
        // Cleanup if needed
      };
    }, [componentState.wifiConnected, apiClient])
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
        connectionType: 'ble',
        deviceMetrics: { rssi: device.rssi || 0 },
      });
      // Delay to ensure device is ready before file operations
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
      EnhancedLogger.debug('FrameManagement', 'Starting to load device files via BLE');
      const files = await commsManager.listFilesWithRetry();
      EnhancedLogger.debug('FrameManagement', 'Files loaded successfully via BLE', { fileCount: files.length });
      updateState({ deviceFiles: files });
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'BLE file list error', error as Error);
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
   * Loads the list of files from the connected device using WiFi REST API.
   */
  const loadDeviceFilesWifi = async () => {
    if (!apiClient) return;
    try {
      updateState({ isLoading: true, error: null, hasError: false });
      EnhancedLogger.debug('FrameManagement', 'Starting to load device files via WiFi');
      const files = await apiClient.listFiles();
      EnhancedLogger.debug('FrameManagement', 'Files loaded successfully via WiFi', { fileCount: files.length });
      updateState({ deviceFiles: files });
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'WiFi file list error', error as Error);
      updateState({
        hasError: true,
        error: `Failed to load files via WiFi: ${(error as Error).message}`,
      });
      
      // If WiFi fails, try to fall back to BLE
      if (commsManager) {
        Alert.alert(
          'WiFi Connection Lost', 
          'WiFi connection lost. Falling back to Bluetooth.',
          [{ text: 'OK' }]
        );
        updateState({ 
          wifiConnected: false, 
          deviceIp: null, 
          connectionType: 'ble' 
        });
        await loadDeviceFiles();
      } else {
        Alert.alert('Error', `Failed to load files from device: ${(error as Error).message}`);
      }
    } finally {
      updateState({ isLoading: false });
    }
  };

  /**
   * Deletes a file from the device.
   * @param filename The name of the file to delete.
   */
  const handleDeleteFile = async (filename: string) => {
    try {
      updateState({ deletingFile: filename, error: null, hasError: false });
      
      if (componentState.connectionType === 'wifi' && apiClient) {
        // Delete via WiFi
        await apiClient.deleteFile(filename);
        await loadDeviceFilesWifi();
      } else if (commsManager) {
        // Delete via BLE
        await commsManager.deleteFile(filename);
        await loadDeviceFiles();
      } else {
        throw new Error('No active connection for file deletion');
      }
      
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
   * Handles displaying an image on the device.
   * @param filename The name of the file to display.
   */
  const handleDisplayImage = async (filename: string) => {
    try {
      updateState({ isLoading: true, error: null, hasError: false });
      
      if (componentState.connectionType === 'wifi' && apiClient) {
        // Display via WiFi
        await apiClient.displayImage(filename);
      } else {
        // Not implemented for BLE yet
        throw new Error('Display function not available via Bluetooth');
      }
      
      Alert.alert('Success', 'Image displayed on device');
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Display error', error as Error);
      updateState({
        hasError: true,
        error: 'Failed to display image',
      });
      Alert.alert('Error', 'Failed to display image');
    } finally {
      updateState({ isLoading: false });
    }
  };

  /**
   * Handles connecting to WiFi via the BLE connection.
   */
  const handleWifiConnection = async (ssid: string, password: string) => {
    if (!commsManager) {
      Alert.alert('Error', 'BLE connection required for WiFi setup');
      return;
    }
    
    try {
      updateState({ wifiConnecting: true, error: null, hasError: false });
      const ipAddress = await commsManager.connectToWifi(ssid, password);
      
      // Test the API connection with retry logic
      const isApiReachable = await testApiConnection(ipAddress);
      
      if (!isApiReachable) {
        throw new Error('WiFi connected but API is not reachable after multiple attempts');
      }
      
      // Now that we know the API is reachable, create the client
      const client = new WifiRestApiClient(ipAddress);
      setApiClient(client);
      
      updateState({ 
        wifiConnected: true, 
        deviceIp: ipAddress,
        connectionType: 'wifi',
        wifiConnecting: false
      });
      
      // Load files via WiFi API
      await loadDeviceFilesWifi();
      
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'WiFi connection error', error as Error);
      updateState({
        hasError: true,
        error: `Failed to connect to WiFi: ${(error as Error).message}`,
        wifiConnecting: false
      });
      Alert.alert('WiFi Error', 'Failed to connect to WiFi. Please try again.');
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
      setApiClient(null);
      updateState({
        isConnected: false,
        wifiConnected: false,
        deviceIp: null,
        connectionType: null,
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
   * Dialog component for WiFi connection.
   */
  const WifiConnectionDialog = () => {
    const [ssid, setSsid] = useState('');
    const [password, setPassword] = useState('');
    
    const handleConnect = () => {
      if (!ssid || !password) {
        Alert.alert('Error', 'Please enter both SSID and password');
        return;
      }
      updateState({ wifiDialogVisible: false });
      handleWifiConnection(ssid, password);
    };
    
    return (
      <Dialog 
        visible={componentState.wifiDialogVisible} 
        onDismiss={() => updateState({ wifiDialogVisible: false })}
      >
        <Dialog.Title>Connect to WiFi</Dialog.Title>
        <Dialog.Content>
          <TextInput
            label="WiFi SSID"
            value={ssid}
            onChangeText={setSsid}
            mode="outlined"
            style={{ marginBottom: 12 }}
          />
          <TextInput
            label="WiFi Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            mode="outlined"
          />
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => updateState({ wifiDialogVisible: false })}>Cancel</Button>
          <Button onPress={handleConnect}>
            Connect
          </Button>
        </Dialog.Actions>
      </Dialog>
    );
  };

  /**
   * Component to display the BLE connection status and device metrics.
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
            Bluetooth: {componentState.isConnected ? 'Connected' : 'Not Connected'}
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
        <View style={styles.connectionTypeIndicator}>
          <MaterialIcons 
            name="bluetooth" 
            size={24} 
            color={componentState.connectionType === 'ble' ? colors.primary : colors.onSurfaceVariant} 
          />
        </View>
      </View>
    );
  };

  /**
   * Component to display the WiFi connection status.
   */
  const WifiConnectionStatus = () => {
    return (
      <View style={styles.statusContainer}>
        <View
          style={[
            styles.statusIndicator,
            { backgroundColor: componentState.wifiConnected ? colors.success : colors.error },
          ]}
        />
        <View style={styles.statusTextContainer}>
          <Text style={styles.statusText}>
            WiFi: {componentState.wifiConnected ? 'Connected' : 'Not Connected'}
          </Text>
          {componentState.wifiConnected && componentState.deviceIp && (
            <Text style={styles.deviceName}>
              IP Address: {componentState.deviceIp}
            </Text>
          )}
        </View>
        <View style={styles.connectionControls}>
          {componentState.isConnected && !componentState.wifiConnected ? (
            <Button
              mode="outlined"
              onPress={() => updateState({ wifiDialogVisible: true })}
              loading={componentState.wifiConnecting}
              disabled={componentState.wifiConnecting}
              icon={({ size, color }) => (
                <MaterialIcons name="wifi" size={size} color={color} />
              )}
              compact
            >
              {componentState.wifiConnecting ? 'Connecting...' : 'Connect'}
            </Button>
          ) : (
            <View style={styles.connectionTypeIndicator}>
              <MaterialIcons 
                name="wifi" 
                size={24} 
                color={componentState.connectionType === 'wifi' ? colors.primary : colors.onSurfaceVariant} 
              />
            </View>
          )}
        </View>
      </View>
    );
  };

  /**
   * Component to display a file item with actions.
   */
  const FileItem = ({ file, index }: { file: FileInfo; index: number }) => {
    return (
      <List.Item
        key={index}
        title={file.name}
        description={`Size: ${(file.size / 1024).toFixed(1)} KB`}
        left={props => (
          <List.Icon {...props} icon="file-image" />
        )}
        right={props => (
          <View style={styles.fileItemActions}>
            {componentState.connectionType === 'wifi' && (
              <IconButton
                {...props}
                icon="monitor"
                onPress={() => handleDisplayImage(file.name)}
                disabled={componentState.isLoading}
              />
            )}
            <IconButton
              {...props}
              icon="delete"
              onPress={() => handleDeleteFile(file.name)}
              disabled={componentState.isLoading || componentState.deletingFile === file.name}
              loading={componentState.deletingFile === file.name}
            />
          </View>
        )}
        style={styles.fileItem}
      />
    );
  };

  // Render the main UI
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

          {componentState.isConnected && (
            <WifiConnectionStatus />
          )}

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
              <Text style={styles.transferMethodText}>
                {componentState.activeWifiTransfer ? 'WiFi Transfer' : 'Bluetooth Transfer'}
              </Text>
            </View>
          )}

          {componentState.wifiConnected && (
            <View style={styles.connectionAdvantageContainer}>
              <MaterialCommunityIcons name="speedometer-medium" size={18} color={colors.success} />
              <Text style={styles.connectionAdvantageText}>
                Using high-speed WiFi for file transfers
              </Text>
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
            <View style={styles.connectionInfo}>
              <Chip 
                icon="information"
                style={styles.chip}
              >
                {componentState.connectionType === 'wifi' 
                  ? 'Using WiFi for faster transfers'
                  : 'Using Bluetooth for transfers'}
              </Chip>
            </View>
          )}

          {componentState.isConnected && (
            <View style={styles.fileListContainer}>
              <View style={styles.fileListHeader}>
                <Text style={styles.sectionTitle}>Device Files</Text>
                <IconButton
                  icon="refresh"
                  onPress={componentState.connectionType === 'wifi' ? loadDeviceFilesWifi : loadDeviceFiles}
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
                  <FileItem key={index} file={file} index={index} />
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>No files found on device</Text>
                  <Button 
                    mode="text" 
                    onPress={componentState.connectionType === 'wifi' ? loadDeviceFilesWifi : loadDeviceFiles} 
                    style={styles.refreshButton}
                  >
                    Refresh
                  </Button>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </Surface>

      <WifiConnectionDialog />
    </SafeAreaView>
  );
}

// Define styles for the component
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
      marginBottom: 12,
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
      fontSize: 16,
      fontWeight: 'bold',
      color: colors.onSurface,
    },
    deviceName: {
      fontSize: 14,
      color: colors.onSurfaceVariant,
      marginTop: 4,
    },
    connectionDetails: {
      fontSize: 12,
      color: colors.secondary,
      marginTop: 4,
    },
    connectionControls: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    connectionTypeIndicator: {
      width: 40,
      height: 40,
      justifyContent: 'center',
      alignItems: 'center',
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
    transferMethodText: {
      fontSize: 12,
      color: colors.secondary,
      marginTop: 4,
      textAlign: 'right',
    },
    progressBar: {
      height: 4,
      borderRadius: 2,
    },
    button: {
      marginVertical: 8,
    },
    fileListContainer: {
      marginTop: 16,
    },
    fileListHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.onSurface,
    },
    fileItem: {
      padding: 0,
      marginVertical: 4,
      backgroundColor: colors.surfaceVariant,
      borderRadius: 8,
    },
    fileItemActions: {
      flexDirection: 'row',
      alignItems: 'center',
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
    connectionInfo: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginVertical: 8,
    },
    chip: {
      marginRight: 8,
      marginBottom: 8,
    },
    connectionAdvantageContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surfaceVariant,
      padding: 8,
      borderRadius: 4,
      marginBottom: 12,
    },
    connectionAdvantageText: {
      color: colors.onSurfaceVariant,
      fontSize: 14,
      marginLeft: 8,
    },
  });