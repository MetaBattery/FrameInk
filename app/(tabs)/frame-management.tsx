// app/(tabs)/frame-management.tsx

import React, { useState, useEffect } from 'react';
import { StyleSheet, View, SafeAreaView, ScrollView, Alert } from 'react-native';
import { 
  Surface, 
  Text, 
  Button, 
  List, 
  useTheme, 
  ActivityIndicator,
  IconButton
} from 'react-native-paper';
import { Device } from 'react-native-ble-plx';
import { getBleManager } from '../../services/bleManager';
import { logger } from '../../services/logger';
import { MaterialIcons } from '@expo/vector-icons';

interface DeviceFile {
  name: string;
  size: number;
}

export default function FrameManagementScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  
  const [bleManager, setBleManager] = useState<any>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [deviceFiles, setDeviceFiles] = useState<DeviceFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize BLE manager
  useEffect(() => {
    const initializeBLE = async () => {
      try {
        setIsInitializing(true);
        setError(null);
        logger.debug('FrameManagement', 'Initializing BLE manager');
        const manager = await getBleManager();
        setBleManager(manager);
        logger.debug('FrameManagement', 'BLE manager initialized');
      } catch (error) {
        logger.error('FrameManagement', 'BLE initialization error', error);
        setError('Failed to initialize Bluetooth');
      } finally {
        setIsInitializing(false);
      }
    };

    initializeBLE();

    // Cleanup
    return () => {
      if (bleManager) {
        bleManager.disconnect();
      }
    };
  }, []);

  // Check BLE availability when manager is ready
  useEffect(() => {
    if (!bleManager) return;

    const checkBleAvailability = async () => {
      try {
        const state = await bleManager.manager.state();
        if (state !== 'PoweredOn') {
          setError('Bluetooth is not enabled');
          Alert.alert(
            'Bluetooth Required',
            'Please enable Bluetooth to connect to your device.',
            [
              {
                text: 'OK',
                onPress: () => logger.debug('FrameManagement', 'User acknowledged BLE requirement')
              }
            ]
          );
        }
      } catch (error) {
        logger.error('FrameManagement', 'BLE state check failed', error);
        setError('Failed to check Bluetooth status');
      }
    };

    checkBleAvailability();
  }, [bleManager]);

  const startScan = async () => {
    if (!bleManager) {
      setError('Bluetooth not initialized');
      return;
    }

    try {
      setError(null);
      setIsScanning(true);
      logger.debug('FrameManagement', 'Starting device scan');
      
      const devices = await bleManager.scanForDevices();
      
      if (devices.length > 0) {
        handleDeviceConnection(devices[0]);
      } else {
        setError('No devices found');
        Alert.alert(
          'No Devices Found', 
          'Make sure your FrameInk device is powered on and nearby.',
          [
            {
              text: 'Try Again',
              onPress: startScan
            },
            {
              text: 'Cancel',
              style: 'cancel'
            }
          ]
        );
      }
    } catch (error) {
      logger.error('FrameManagement', 'Scan error', error);
      setError('Failed to scan for devices');
      Alert.alert('Scan Error', 'Failed to scan for devices. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  const handleDeviceConnection = async (device: Device) => {
    if (!bleManager) return;

    try {
      setError(null);
      setIsConnecting(true);
      logger.debug('FrameManagement', 'Connecting to device', { deviceId: device.id });
      
      await bleManager.connectToDevice(device);
      setConnectedDevice(device);
      
      await loadDeviceFiles();
    } catch (error) {
      logger.error('FrameManagement', 'Connection error', error);
      setError('Failed to connect to device');
      Alert.alert('Connection Error', 'Failed to connect to device. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  const loadDeviceFiles = async () => {
    if (!bleManager) return;

    try {
      setError(null);
      setIsLoading(true);
      const files = await bleManager.listFiles();
      setDeviceFiles(files.map(file => {
        const [name, size] = file.split(',');
        return { name, size: parseInt(size) };
      }));
    } catch (error) {
      logger.error('FrameManagement', 'File list error', error);
      setError('Failed to load files');
      Alert.alert('Error', 'Failed to load files from device');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteFile = async (filename: string) => {
    if (!bleManager) return;

    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete ${filename}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setError(null);
              setIsLoading(true);
              await bleManager.deleteFile(filename);
              await loadDeviceFiles();
              Alert.alert('Success', 'File deleted successfully');
            } catch (error) {
              logger.error('FrameManagement', 'Delete error', error);
              setError('Failed to delete file');
              Alert.alert('Error', 'Failed to delete file');
            } finally {
              setIsLoading(false);
            }
          }
        }
      ]
    );
  };

  const handleDisconnect = async () => {
    if (!bleManager) return;

    try {
      setError(null);
      await bleManager.disconnect();
      setConnectedDevice(null);
      setDeviceFiles([]);
    } catch (error) {
      logger.error('FrameManagement', 'Disconnect error', error);
      setError('Failed to disconnect');
      Alert.alert('Error', 'Failed to disconnect from device');
    }
  };

  const handleRefresh = async () => {
    if (connectedDevice) {
      await loadDeviceFiles();
    }
  };

  const ConnectionStatus = () => (
    <View style={[
      styles.statusIndicator,
      { backgroundColor: connectedDevice ? colors.success : colors.error }
    ]} />
  );

  if (isInitializing) {
    return (
      <SafeAreaView style={styles.container}>
        <Surface style={styles.surface}>
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" />
            <Text style={styles.initializingText}>Initializing Bluetooth...</Text>
          </View>
        </Surface>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Surface style={styles.surface}>
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          {/* Error Display */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Connection Status */}
          <View style={styles.statusContainer}>
            <ConnectionStatus />
            <View>
              <Text style={styles.statusText}>
                Status: {connectedDevice ? 'Connected' : 'Not Connected'}
              </Text>
              {connectedDevice && (
                <Text style={styles.deviceName}>
                  Device: {connectedDevice.name || 'Unknown'}
                </Text>
              )}
            </View>
          </View>

          {/* Connect/Disconnect Button */}
          {!connectedDevice ? (
            <Button
              mode="contained"
              onPress={startScan}
              loading={isScanning || isConnecting}
              disabled={isScanning || isConnecting || !bleManager}
              style={styles.button}
              icon={({size, color}) => (
                <MaterialIcons name="bluetooth-searching" size={size} color={color} />
              )}
            >
              {isScanning ? 'Scanning...' : isConnecting ? 'Connecting...' : 'Connect to Device'}
            </Button>
          ) : (
            <Button
              mode="outlined"
              onPress={handleDisconnect}
              style={styles.button}
              icon={({size, color}) => (
                <MaterialIcons name="bluetooth-disabled" size={size} color={color} />
              )}
            >
              Disconnect
            </Button>
          )}

          {/* File List */}
          {connectedDevice && (
            <View style={styles.fileListContainer}>
              <View style={styles.fileListHeader}>
                <Text style={styles.sectionTitle}>Device Files</Text>
                <IconButton
                  icon="refresh"
                  onPress={handleRefresh}
                  disabled={isLoading}
                />
              </View>
              
              {isLoading ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" />
                  <Text style={styles.loadingText}>Loading files...</Text>
                </View>
              ) : deviceFiles.length > 0 ? (
                deviceFiles.map((file, index) => (
                  <List.Item
                    key={index}
                    title={file.name}
                    description={`Size: ${(file.size / 1024).toFixed(1)} KB`}
                    right={props => (
                      <IconButton
                        {...props}
                        icon="delete"
                        onPress={() => handleDeleteFile(file.name)}
                      />
                    )}
                    style={styles.fileItem}
                  />
                ))
              ) : (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyStateText}>
                    No files found on device
                  </Text>
                  <Button
                    mode="text"
                    onPress={handleRefresh}
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
      marginBottom: 16,
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
      padding: 16,
      backgroundColor: colors.error,
      borderRadius: 8,
      marginBottom: 16,
    },
    errorText: {
      color: colors.surface,
      textAlign: 'center',
      fontSize: 14,
    },
    statusContainer: {
      marginBottom: 16,
      flexDirection: 'row',
      alignItems: 'center',
    },
    statusIndicator: {
      width: 12,
      height: 12,
      borderRadius: 6,
      marginRight: 8,
    },
    statusText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: colors.text,
    },
    deviceName: {
      fontSize: 16,
      color: colors.text,
      marginTop: 4,
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
      color: colors.text,
    },
    fileItem: {
      padding: 0,
      marginVertical: 4,
      backgroundColor: colors.surface,
    },
    emptyState: {
      alignItems: 'center',
      padding: 20,
    },
    emptyStateText: {
      color: colors.text,
      fontSize: 16,
      textAlign: 'center',
      marginBottom: 12,
    },
    refreshButton: {
      marginTop: 8,
    },
    initializingText: {
      marginTop: 16,
      fontSize: 16,
      color: colors.text,
    },
    loadingText: {
      marginTop: 16,
      fontSize: 16,
      color: colors.text,
    }
  });