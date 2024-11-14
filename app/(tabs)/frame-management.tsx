import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  StyleSheet, 
  View, 
  SafeAreaView, 
  ScrollView, 
  Alert, 
  Platform, 
  PermissionsAndroid,
  AppState 
} from 'react-native';
import { 
  Surface, 
  Text, 
  Button, 
  List, 
  useTheme, 
  ActivityIndicator,
  IconButton,
  ProgressBar
} from 'react-native-paper';
import { Device } from 'react-native-ble-plx';
import { getBleManager, FileInfo, TransferProgress } from '../../services/bleManager';
import { EnhancedLogger } from '../../services/enhancedLogger';
import { MaterialIcons } from '@expo/vector-icons';

// Constants for retry logic and intervals
const OPERATION_RETRY_LIMIT = 3;
const OPERATION_RETRY_DELAY = 1000;
const CONNECTION_CHECK_INTERVAL = 2000;
const SCAN_TIMEOUT = 10000;

// Interface for enhanced device information
interface DeviceMetrics {
  rssi: number;
  mtu: number;
  connectionParameters?: {
    interval: number;
    latency: number;
    timeout: number;
  };
  lastUpdated: number;
}

const requestPermissions = async () => {
  if (Platform.OS === 'android') {
    try {
      if (Platform.Version >= 31) {
        const permissions = [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        ];

        EnhancedLogger.info('FrameManagement', 'Requesting Android 12+ permissions', { permissions });
        const results = await PermissionsAndroid.requestMultiple(permissions);
        
        const allGranted = Object.values(results).every(
          result => result === PermissionsAndroid.RESULTS.GRANTED
        );

        EnhancedLogger.debug('FrameManagement', 'Permission results', { results });
        return allGranted;
      } else {
        EnhancedLogger.info('FrameManagement', 'Requesting location permission for older Android');
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'Bluetooth scanning requires location permission',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }
    } catch (err) {
      EnhancedLogger.error('FrameManagement', 'Permission request failed', err as Error);
      return false;
    }
  }
  return true;
};

export default function FrameManagementScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  
  // State management
  const [bleManager, setBleManager] = useState<any>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);
  const [deviceFiles, setDeviceFiles] = useState<FileInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [transferProgress, setTransferProgress] = useState<TransferProgress | null>(null);
  const [deviceMetrics, setDeviceMetrics] = useState<DeviceMetrics | null>(null);
  const [permissionsGranted, setPermissionsGranted] = useState(false);

  // Refs for managing intervals and app state
  const connectionCheckInterval = useRef<NodeJS.Timeout>();
  const appStateRef = useRef(AppState.currentState);
  const retryAttemptsRef = useRef<{[key: string]: number}>({});

  useEffect(() => {
    EnhancedLogger.info('FrameManagement', 'Component mounted');
    return () => {
      EnhancedLogger.info('FrameManagement', 'Component unmounting');
    };
  }, []);

  // Initialize BLE manager and handle permissions
  useEffect(() => {
    const initializeBLE = async () => {
      try {
        setIsInitializing(true);
        setError(null);

        EnhancedLogger.info('FrameManagement', 'Starting BLE initialization');
        
        // Request permissions first
        const granted = await requestPermissions();
        setPermissionsGranted(granted);
        
        if (!granted) {
          EnhancedLogger.warn('FrameManagement', 'Permissions not granted');
          setError('Required permissions not granted. Please enable Bluetooth and Location permissions.');
          return;
        }

        EnhancedLogger.info('FrameManagement', 'Permissions granted, initializing BLE manager');
        const manager = await getBleManager();
        
        // Check if Bluetooth is enabled
        const state = await manager.getState();
        EnhancedLogger.debug('FrameManagement', 'Bluetooth state', { state });

        if (state !== 'PoweredOn') {
          EnhancedLogger.warn('FrameManagement', 'Bluetooth not powered on', { state });
          setError('Please enable Bluetooth');
          return;
        }

        EnhancedLogger.info('FrameManagement', 'BLE manager initialized successfully');
        setBleManager(manager);

        // Set up transfer progress listener
        manager.addTransferListener((progress: TransferProgress) => {
          EnhancedLogger.debug('FrameManagement', 'Transfer progress update', {
            transferred: progress.bytesTransferred,
            total: progress.totalBytes,
            speed: progress.currentSpeed
          });
          setTransferProgress(progress.totalBytes > 0 ? progress : null);
        });

      } catch (error) {
        EnhancedLogger.error('FrameManagement', 'BLE initialization failed', error as Error);
        setError(`Bluetooth initialization failed: ${error.message}`);
      } finally {
        setIsInitializing(false);
      }
    };

    initializeBLE();

    return () => {
      if (bleManager) {
        EnhancedLogger.info('FrameManagement', 'Cleaning up BLE manager');
        bleManager.destroy();
      }
    };
  }, []);

  // Handle app state changes
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      EnhancedLogger.debug('FrameManagement', 'App state changed', {
        from: appStateRef.current,
        to: nextAppState
      });

      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        EnhancedLogger.info('FrameManagement', 'App came to foreground, checking connection status');
        checkConnectionStatus();
      }

      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, []);

  // Monitor connection status
  const checkConnectionStatus = useCallback(async () => {
    if (!bleManager || !connectedDevice) return;

    try {
      const state = await bleManager.getState();
      EnhancedLogger.debug('FrameManagement', 'Connection status check', {
        bluetoothState: state,
        deviceId: connectedDevice.id,
        deviceName: connectedDevice.name
      });

      if (state !== 'PoweredOn') {
        EnhancedLogger.warn('FrameManagement', 'Bluetooth not powered on during connection check', {
          currentState: state
        });
        handleDisconnection('Bluetooth turned off');
        return;
      }

      const isConnected = await connectedDevice.isConnected();
      if (!isConnected) {
        EnhancedLogger.warn('FrameManagement', 'Device disconnected unexpectedly', {
          deviceId: connectedDevice.id,
          lastKnownState: state
        });
        handleDisconnection('Device disconnected unexpectedly');
      }
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Connection status check failed', error as Error);
      handleDisconnection('Connection check failed');
    }
  }, [bleManager, connectedDevice]);

  // Setup connection monitoring
  useEffect(() => {
    if (connectedDevice) {
      EnhancedLogger.info('FrameManagement', 'Setting up connection monitoring', {
        deviceId: connectedDevice.id,
        interval: CONNECTION_CHECK_INTERVAL
      });
      
      connectionCheckInterval.current = setInterval(checkConnectionStatus, CONNECTION_CHECK_INTERVAL);

      return () => {
        if (connectionCheckInterval.current) {
          clearInterval(connectionCheckInterval.current);
          EnhancedLogger.debug('FrameManagement', 'Connection monitoring cleared');
        }
      };
    }
  }, [connectedDevice, checkConnectionStatus]);

  // Enhanced scan with retry logic and timeout
  const startScan = async () => {
    if (!bleManager) {
      EnhancedLogger.error('FrameManagement', 'Scan attempted without initialized BLE manager');
      setError('Bluetooth not initialized');
      return;
    }

    if (!permissionsGranted) {
      EnhancedLogger.info('FrameManagement', 'Requesting permissions before scan');
      const granted = await requestPermissions();
      if (!granted) {
        EnhancedLogger.warn('FrameManagement', 'Required permissions not granted for scan');
        setError('Required permissions not granted');
        return;
      }
      setPermissionsGranted(granted);
    }

    try {
      setError(null);
      setIsScanning(true);
      EnhancedLogger.info('FrameManagement', 'Starting device scan', {
        timeout: SCAN_TIMEOUT
      });

      const scanStartTime = Date.now();
      
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Scan timeout')), SCAN_TIMEOUT);
      });

      // Create the scan promise
      const scanPromise = bleManager.scanForDevices();

      // Race between scan and timeout
      const devices = await Promise.race([scanPromise, timeoutPromise]) as Device[];

      EnhancedLogger.info('FrameManagement', 'Scan completed', {
        duration: `${Date.now() - scanStartTime}ms`,
        devicesFound: devices.length,
        deviceDetails: devices.map(d => ({
          id: d.id,
          name: d.name,
          rssi: d.rssi
        }))
      });

      if (devices.length > 0) {
        const selectedDevice = devices[0]; // Usually take the strongest signal
        EnhancedLogger.info('FrameManagement', 'Selected device for connection', {
          id: selectedDevice.id,
          name: selectedDevice.name,
          rssi: selectedDevice.rssi
        });
        await handleDeviceConnection(selectedDevice);
      } else {
        EnhancedLogger.warn('FrameManagement', 'No compatible devices found');
        setError('No devices found. Please ensure your device is powered on and nearby.');
        Alert.alert(
          'No Devices Found',
          'Please ensure your FrameInk device is powered on and nearby.',
          [
            {
              text: 'Try Again',
              onPress: startScan,
            },
            {
              text: 'Cancel',
              style: 'cancel',
            },
          ],
        );
      }
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Scan error', error as Error);
      setError(`Scan failed: ${error.message}`);
      Alert.alert('Scan Error', 'Failed to scan for devices. Please try again.');
    } finally {
      setIsScanning(false);
    }
  };

  // Enhanced connection handling with retry logic
  const handleDeviceConnection = async (device: Device) => {
    if (!bleManager) return;

    const retryKey = `connect_${device.id}`;
    const currentAttempt = (retryAttemptsRef.current[retryKey] || 0) + 1;
    retryAttemptsRef.current[retryKey] = currentAttempt;

    try {
      setError(null);
      setIsConnecting(true);

      EnhancedLogger.info('FrameManagement', 'Initiating device connection', {
        attempt: currentAttempt,
        deviceId: device.id,
        deviceName: device.name,
        rssi: device.rssi,
        maxRetries: OPERATION_RETRY_LIMIT
      });

      const connectionStartTime = Date.now();
      await bleManager.connectToDevice(device);

      EnhancedLogger.info('FrameManagement', 'Device connected successfully', {
        duration: `${Date.now() - connectionStartTime}ms`,
        deviceId: device.id
      });

      setConnectedDevice(device);
      delete retryAttemptsRef.current[retryKey];

      // Update device metrics
      const rssi = await device.readRSSI();
      const mtu = await device.getMtu();
      
      EnhancedLogger.debug('FrameManagement', 'Device metrics updated', {
        rssi,
        mtu,
        deviceId: device.id
      });

      setDeviceMetrics({
        rssi,
        mtu,
        lastUpdated: Date.now()
      });

      await loadDeviceFiles();
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Connection error', error as Error, {
        attempt: currentAttempt,
        deviceId: device.id
      });

      if (currentAttempt < OPERATION_RETRY_LIMIT) {
        EnhancedLogger.info('FrameManagement', 'Retrying connection', {
          attempt: currentAttempt,
          maxRetries: OPERATION_RETRY_LIMIT,
          delay: OPERATION_RETRY_DELAY * currentAttempt
        });
        await new Promise(resolve => setTimeout(resolve, OPERATION_RETRY_DELAY * currentAttempt));
        return handleDeviceConnection(device);
      }

      delete retryAttemptsRef.current[retryKey];
      setError('Failed to connect to device. Please try again.');
      Alert.alert('Connection Error', 'Failed to connect to device. Please try again.');
    } finally {
      setIsConnecting(false);
    }
  };

  // Enhanced file loading with retry logic
  const loadDeviceFiles = async () => {
    if (!bleManager || !connectedDevice) return;

    const retryKey = 'load_files';
    const currentAttempt = (retryAttemptsRef.current[retryKey] || 0) + 1;
    retryAttemptsRef.current[retryKey] = currentAttempt;

    try {
      setError(null);
      setIsLoading(true);
      
      EnhancedLogger.info('FrameManagement', 'Loading device files', {
        deviceId: connectedDevice.id,
        attempt: currentAttempt,
        maxRetries: OPERATION_RETRY_LIMIT
      });

      const loadStartTime = Date.now();
      const files = await bleManager.listFiles();
      
      EnhancedLogger.info('FrameManagement', 'Files loaded successfully', {
        duration: `${Date.now() - loadStartTime}ms`,
        fileCount: files.length,
        totalSize: files.reduce((acc, file) => acc + file.size, 0),
        files: files.map(f => ({ name: f.name, size: f.size }))
      });

      setDeviceFiles(files);
      delete retryAttemptsRef.current[retryKey];
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'File list error', error as Error, {
        attempt: currentAttempt,
        deviceId: connectedDevice.id
      });

      if (currentAttempt < OPERATION_RETRY_LIMIT) {
        EnhancedLogger.info('FrameManagement', 'Retrying file load', {
          attempt: currentAttempt,
          maxRetries: OPERATION_RETRY_LIMIT,
          delay: OPERATION_RETRY_DELAY * currentAttempt
        });
        await new Promise(resolve => setTimeout(resolve, OPERATION_RETRY_DELAY * currentAttempt));
        return loadDeviceFiles();
      }

      delete retryAttemptsRef.current[retryKey];
      setError('Failed to load files');
      Alert.alert('Error', 'Failed to load files from device');
    } finally {
      setIsLoading(false);
    }
  };

  // Enhanced file deletion with retry logic
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
            const retryKey = `delete_${filename}`;
            const currentAttempt = (retryAttemptsRef.current[retryKey] || 0) + 1;
            retryAttemptsRef.current[retryKey] = currentAttempt;

            try {
              setError(null);
              setDeletingFile(filename);
              
              EnhancedLogger.info('FrameManagement', 'Initiating file deletion', {
                filename,
                attempt: currentAttempt,
                deviceId: connectedDevice?.id
              });

              const deleteStartTime = Date.now();
              const success = await bleManager.deleteFile(filename);
              
              if (success) {
                EnhancedLogger.info('FrameManagement', 'File deleted successfully', {
                  filename,
                  duration: `${Date.now() - deleteStartTime}ms`,
                  deviceId: connectedDevice?.id
                });
                
                await loadDeviceFiles();
                Alert.alert('Success', 'File deleted successfully');
                delete retryAttemptsRef.current[retryKey];
              } else {
                throw new Error('Device reported deletion failure');
              }
            } catch (error) {
              EnhancedLogger.error('FrameManagement', 'Delete error', error as Error, {
                filename,
                attempt: currentAttempt,
                deviceId: connectedDevice?.id
              });

              if (currentAttempt < OPERATION_RETRY_LIMIT) {
                EnhancedLogger.info('FrameManagement', 'Retrying file deletion', {
                  attempt: currentAttempt,
                  maxRetries: OPERATION_RETRY_LIMIT,
                  delay: OPERATION_RETRY_DELAY * currentAttempt
                });
                await new Promise(resolve => setTimeout(resolve, OPERATION_RETRY_DELAY * currentAttempt));
                return handleDeleteFile(filename);
              }

              delete retryAttemptsRef.current[retryKey];
              setError('Failed to delete file');
              Alert.alert('Error', 'Failed to delete file');
            } finally {
              setDeletingFile(null);
            }
          },
        },
      ],
    );
  };

  // Enhanced disconnection handling
  const handleDisconnection = async (reason: string = 'User initiated') => {
    if (!bleManager) return;

    try {
      setError(null);
      EnhancedLogger.info('FrameManagement', 'Initiating device disconnection', {
        reason,
        deviceId: connectedDevice?.id,
        deviceName: connectedDevice?.name
      });

      const disconnectStartTime = Date.now();
      await bleManager.disconnect();
      
      EnhancedLogger.info('FrameManagement', 'Device disconnected successfully', {
        duration: `${Date.now() - disconnectStartTime}ms`,
        reason
      });

      setConnectedDevice(null);
      setDeviceFiles([]);
      setTransferProgress(null);
      setDeviceMetrics(null);

      Alert.alert('Disconnected', 'You have been disconnected from the device.');
    } catch (error) {
      EnhancedLogger.error('FrameManagement', 'Disconnect error', error as Error, {
        reason,
        deviceId: connectedDevice?.id
      });
      setError('Failed to disconnect');
      Alert.alert('Error', 'Failed to disconnect from device');
    }
  };

  // Connection status component with enhanced metrics display
  const ConnectionStatus = () => {
    const isConnected = !!connectedDevice;
    const connectionQuality = deviceMetrics?.rssi ? (
      deviceMetrics.rssi >= -60 ? 'Excellent' :
      deviceMetrics.rssi >= -70 ? 'Good' :
      deviceMetrics.rssi >= -80 ? 'Fair' : 'Poor'
    ) : 'Unknown';

    // Log connection quality changes
    useEffect(() => {
      if (deviceMetrics?.rssi) {
        EnhancedLogger.debug('FrameManagement', 'Connection quality update', {
          quality: connectionQuality,
          rssi: deviceMetrics.rssi,
          deviceId: connectedDevice?.id
        });
      }
    }, [deviceMetrics?.rssi]);

    return (
      <View style={styles.statusContainer}>
        <View style={[
          styles.statusIndicator,
          { backgroundColor: isConnected ? colors.success : colors.error }
        ]} />
        <View style={styles.statusTextContainer}>
          <Text style={styles.statusText}>
            Status: {isConnected ? 'Connected' : 'Not Connected'}
          </Text>
          {connectedDevice && (
            <>
              <Text style={styles.deviceName}>
                Device: {connectedDevice.name || 'Unknown'}
              </Text>
              {deviceMetrics && (
                <Text style={styles.connectionDetails}>
                  Signal: {connectionQuality} ({deviceMetrics.rssi} dBm)
                  {deviceMetrics.mtu ? ` • MTU: ${deviceMetrics.mtu}` : ''}
                </Text>
              )}
            </>
          )}
        </View>
      </View>
    );
  };

  // Debug information component (only shown in development)
  const DebugInfo = () => {
    if (!__DEV__) return null;

    const debugInfo = {
      bleManager: bleManager ? 'Initialized' : 'Not Initialized',
      permissions: permissionsGranted ? 'Granted' : 'Not Granted',
      bluetoothState: bleManager ? bleManager.getState() : 'Unknown',
      initializing: isInitializing ? 'Yes' : 'No',
      error: error || 'None',
      scanning: isScanning ? 'Yes' : 'No',
      connecting: isConnecting ? 'Yes' : 'No',
      deviceMetrics: deviceMetrics || 'None'
    };

    EnhancedLogger.debug('FrameManagement', 'Debug state update', debugInfo);

    return (
      <View style={styles.debugContainer}>
        <Text style={styles.debugText}>
          {Object.entries(debugInfo).map(([key, value]) => 
            `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}\n`
          )}
        </Text>
      </View>
    );
  };

  // Main render with enhanced logging for state changes
  useEffect(() => {
    EnhancedLogger.debug('FrameManagement', 'Component state update', {
      isInitializing,
      isConnected: !!connectedDevice,
      isScanning,
      isConnecting,
      hasError: !!error,
      fileCount: deviceFiles.length,
      hasTransferInProgress: !!transferProgress
    });
  }, [isInitializing, connectedDevice, isScanning, isConnecting, error, deviceFiles, transferProgress]);

  if (isInitializing) {
    EnhancedLogger.debug('FrameManagement', 'Rendering initialization state');
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
          {error && (
            <View style={styles.errorContainer}>
              <MaterialIcons name="error" size={24} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <ConnectionStatus />
          <DebugInfo />

          {transferProgress && transferProgress.totalBytes > 0 && (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>
                Transferring: {Math.round((transferProgress.bytesTransferred / transferProgress.totalBytes) * 100)}%
                {transferProgress.currentSpeed && 
                  ` (${(transferProgress.currentSpeed / 1024).toFixed(2)} KB/s)`}
              </Text>
              <ProgressBar
                progress={transferProgress.bytesTransferred / transferProgress.totalBytes}
                color={colors.primary}
                style={styles.progressBar}
              />
            </View>
          )}

          {!connectedDevice ? (
            <Button
              mode="contained"
              onPress={() => {
                EnhancedLogger.info('FrameManagement', 'User initiated device scan');
                startScan();
              }}
              loading={isScanning || isConnecting}
              disabled={isScanning || isConnecting || !bleManager || !permissionsGranted}
              style={styles.button}
              icon={({size, color}) => (
                <MaterialIcons name="bluetooth-searching" size={size} color={color} />
              )}
            >
              {isScanning ? 'Scanning...' : 
               isConnecting ? 'Connecting...' : 
               !bleManager ? 'Bluetooth Not Ready' :
               !permissionsGranted ? 'Permissions Required' :
               'Connect to Device'}
            </Button>
          ) : (
            <Button
              mode="outlined"
              onPress={() => {
                EnhancedLogger.info('FrameManagement', 'User initiated disconnect');
                handleDisconnection('User initiated');
              }}
              style={styles.button}
              icon={({size, color}) => (
                <MaterialIcons name="bluetooth-disabled" size={size} color={color} />
              )}
            >
              Disconnect
            </Button>
          )}

          {connectedDevice && (
            <View style={styles.fileListContainer}>
              <View style={styles.fileListHeader}>
                <Text style={styles.sectionTitle}>Device Files</Text>
                <IconButton
                  icon="refresh"
                  onPress={() => {
                    EnhancedLogger.info('FrameManagement', 'User initiated file refresh');
                    loadDeviceFiles();
                  }}
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
                        onPress={() => {
                          EnhancedLogger.info('FrameManagement', 'User initiated file deletion', {
                            filename: file.name,
                            fileSize: file.size
                          });
                          handleDeleteFile(file.name);
                        }}
                        disabled={isLoading || deletingFile === file.name}
                        loading={deletingFile === file.name}
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
                    onPress={() => {
                      EnhancedLogger.info('FrameManagement', 'User initiated empty state refresh');
                      loadDeviceFiles();
                    }}
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

const makeStyles = (colors: any) => StyleSheet.create({
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
    backgroundColor: colors.surface,
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
});