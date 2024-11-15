import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  StyleSheet, 
  View, 
  SafeAreaView, 
  ScrollView, 
  Alert, 
  Platform, 
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
import { MaterialIcons } from '@expo/vector-icons';
import { 
    BLEManager, 
    getBLEManager, 
    type BLEManagerEvents, 
    type ConnectionState,
    type TransferProgress,
    type FileInfo,
    type DeviceConnectionMetrics 
} from '../../services';
import { EnhancedLogger } from '../../services/EnhancedLogger';

console.log('BLEManager imported:', !!BLEManager);

// Constants
const OPERATION_RETRY_LIMIT = 3;
const OPERATION_RETRY_DELAY = 1000;
const SCAN_TIMEOUT = 10000;

// Component state interface
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
    transferProgress: TransferProgress | null;
    deviceMetrics: DeviceConnectionMetrics | null;
}

export default function FrameManagementScreen() {
    const { colors } = useTheme();
    const styles = makeStyles(colors);

    // State management
    const [bleManager, setBleManager] = useState<BLEManager | null>(null);
    const [componentState, setComponentState] = useState<ComponentState>({
        isInitializing: true,
        isConnected: false,
        isScanning: false,
        isConnecting: false,
        hasError: false,
        error: null,
        isLoading: false,
        deviceFiles: [],
        deletingFile: null,
        transferProgress: null,
        deviceMetrics: null
    });
    const [connectedDevice, setConnectedDevice] = useState<Device | null>(null);

    // Refs for cleanup and event management
    const bleEventsRef = useRef<BLEManagerEvents | null>(null);
    const appStateRef = useRef(AppState.currentState);
    const retryAttemptsRef = useRef<{[key: string]: number}>({});

    // Update state helper
    const updateState = useCallback((updates: Partial<ComponentState>) => {
        setComponentState(current => ({
            ...current,
            ...updates
        }));
        
        // Log state changes in development
        if (__DEV__) {
            EnhancedLogger.debug('FrameManagement', 'State updated', updates);
        }
    }, []);

    // Setup BLE event handlers
    const setupBLEEvents = useCallback(() => {
        if (!bleManager) return;

        const events: BLEManagerEvents = {
            onConnectionStateChange: (state: ConnectionState) => {
                updateState({
                    isConnected: state.connected,
                    isConnecting: state.connecting,
                    error: state.error
                });

                if (!state.connected && connectedDevice) {
                    setConnectedDevice(null);
                    updateState({
                        deviceFiles: [],
                        transferProgress: null,
                        deviceMetrics: null
                    });
                }
            },
            onTransferProgress: (progress: TransferProgress) => {
                updateState({ transferProgress: progress });
            },
            onError: (error: Error, context: string) => {
                EnhancedLogger.error('FrameManagement', `BLE error in ${context}`, error);
                updateState({
                    hasError: true,
                    error: `${context}: ${error.message}`
                });
            },
            onDeviceFound: (device: Device) => {
                EnhancedLogger.info('FrameManagement', 'Device found', {
                    id: device.id,
                    name: device.name,
                    rssi: device.rssi
                });
            }
        };

        bleManager.setEventHandlers(events);
        bleEventsRef.current = events;

    }, [bleManager, connectedDevice, updateState]);

    // Initialize BLE manager
    useEffect(() => {
        const initializeBLE = async () => {
            try {
                updateState({
                    isInitializing: true,
                    error: null,
                    hasError: false
                });

                EnhancedLogger.info('FrameManagement', 'Starting BLE initialization');
                
                const manager = await getBLEManager({
                    timeout: SCAN_TIMEOUT,
                    retries: OPERATION_RETRY_LIMIT
                });

                setBleManager(manager);
                setupBLEEvents();

                EnhancedLogger.info('FrameManagement', 'BLE manager initialized successfully');
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown initialization error';
                EnhancedLogger.error('FrameManagement', 'BLE initialization failed', error as Error);
                updateState({
                    hasError: true,
                    error: `Bluetooth initialization failed: ${errorMessage}`
                });
            } finally {
                updateState({ isInitializing: false });
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

    // App state monitoring
    useEffect(() => {
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (
                appStateRef.current.match(/inactive|background/) && 
                nextAppState === 'active'
            ) {
                EnhancedLogger.info('FrameManagement', 'App foregrounded - checking BLE state');
                if (bleManager && connectedDevice) {
                    // Check connection state and reconnect if necessary
                    bleManager.isDeviceConnected(connectedDevice.id).then(isConnected => {
                        if (!isConnected) {
                            EnhancedLogger.warn('FrameManagement', 'Device disconnected while app was in background');
                            updateState({
                                isConnected: false,
                                deviceFiles: [],
                                transferProgress: null,
                                deviceMetrics: null
                            });
                            setConnectedDevice(null);
                        }
                    });
                }
            }
            appStateRef.current = nextAppState;
        });

        return () => {
            subscription.remove();
        };
    }, [bleManager, connectedDevice]);

// Scanning functionality
const startScan = async () => {
    if (!bleManager) {
        EnhancedLogger.error('FrameManagement', 'Scan attempted without initialized BLE manager');
        updateState({
            hasError: true,
            error: 'Bluetooth not initialized'
        });
        return;
    }

    try {
        updateState({
            isScanning: true,
            error: null,
            hasError: false
        });

        EnhancedLogger.info('FrameManagement', 'Starting device scan', {
            timeout: SCAN_TIMEOUT
        });

        const devices = await bleManager.scanForDevices();

        if (devices.length > 0) {
            const selectedDevice = devices[0];
            EnhancedLogger.info('FrameManagement', 'Selected device for connection', {
                id: selectedDevice.id,
                name: selectedDevice.name,
                rssi: selectedDevice.rssi
            });
            await handleDeviceConnection(selectedDevice);
        } else {
            EnhancedLogger.warn('FrameManagement', 'No compatible devices found');
            updateState({
                hasError: true,
                error: 'No devices found. Please ensure your device is powered on and nearby.'
            });
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
        const errorMessage = error instanceof Error ? error.message : 'Unknown scan error';
        EnhancedLogger.error('FrameManagement', 'Scan error', error as Error);
        updateState({
            hasError: true,
            error: `Scan failed: ${errorMessage}`
        });
        Alert.alert('Scan Error', 'Failed to scan for devices. Please try again.');
    } finally {
        updateState({ isScanning: false });
    }
};

// Connection handling
const handleDeviceConnection = async (device: Device) => {
    if (!bleManager) return;

    const retryKey = `connect_${device.id}`;
    const currentAttempt = (retryAttemptsRef.current[retryKey] || 0) + 1;
    retryAttemptsRef.current[retryKey] = currentAttempt;

    try {
        updateState({
            isConnecting: true,
            error: null,
            hasError: false
        });

        EnhancedLogger.info('FrameManagement', 'Initiating device connection', {
            attempt: currentAttempt,
            deviceId: device.id,
            deviceName: device.name
        });

        await bleManager.connectToDevice(device);
        
        setConnectedDevice(device);
        delete retryAttemptsRef.current[retryKey];

        // Update initial metrics after connection
        const metrics = await bleManager.getDeviceMetrics();
        if (metrics) {
            updateState({ deviceMetrics: metrics });
        }

        await loadDeviceFiles();

    } catch (error) {
        EnhancedLogger.error('FrameManagement', 'Connection error', error as Error, {
            attempt: currentAttempt,
            deviceId: device.id
        });

        if (currentAttempt < OPERATION_RETRY_LIMIT) {
            EnhancedLogger.info('FrameManagement', 'Retrying connection', {
                attempt: currentAttempt,
                maxRetries: OPERATION_RETRY_LIMIT
            });
            await new Promise(resolve => setTimeout(resolve, OPERATION_RETRY_DELAY * currentAttempt));
            return handleDeviceConnection(device);
        }

        delete retryAttemptsRef.current[retryKey];
        updateState({
            hasError: true,
            error: 'Failed to connect to device. Please try again.'
        });
        Alert.alert('Connection Error', 'Failed to connect to device. Please try again.');
    } finally {
        updateState({ isConnecting: false });
    }
};

// File operations
const loadDeviceFiles = async () => {
    if (!bleManager || !connectedDevice) return;

    const retryKey = 'load_files';
    const currentAttempt = (retryAttemptsRef.current[retryKey] || 0) + 1;
    retryAttemptsRef.current[retryKey] = currentAttempt;

    try {
        updateState({
            isLoading: true,
            error: null,
            hasError: false
        });

        EnhancedLogger.info('FrameManagement', 'Loading device files', {
            deviceId: connectedDevice.id,
            attempt: currentAttempt
        });

        const files = await bleManager.listFiles();
        
        updateState({ deviceFiles: files });
        delete retryAttemptsRef.current[retryKey];

    } catch (error) {
        EnhancedLogger.error('FrameManagement', 'File list error', error as Error, {
            attempt: currentAttempt,
            deviceId: connectedDevice.id
        });

        if (currentAttempt < OPERATION_RETRY_LIMIT) {
            await new Promise(resolve => setTimeout(resolve, OPERATION_RETRY_DELAY * currentAttempt));
            return loadDeviceFiles();
        }

        delete retryAttemptsRef.current[retryKey];
        updateState({
            hasError: true,
            error: 'Failed to load files'
        });
        Alert.alert('Error', 'Failed to load files from device');
    } finally {
        updateState({ isLoading: false });
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
                    const retryKey = `delete_${filename}`;
                    const currentAttempt = (retryAttemptsRef.current[retryKey] || 0) + 1;
                    retryAttemptsRef.current[retryKey] = currentAttempt;

                    try {
                        updateState({
                            deletingFile: filename,
                            error: null,
                            hasError: false
                        });

                        await bleManager.deleteFile(filename);
                        await loadDeviceFiles();
                        Alert.alert('Success', 'File deleted successfully');
                        delete retryAttemptsRef.current[retryKey];

                    } catch (error) {
                        EnhancedLogger.error('FrameManagement', 'Delete error', error as Error, {
                            filename,
                            attempt: currentAttempt
                        });

                        if (currentAttempt < OPERATION_RETRY_LIMIT) {
                            await new Promise(resolve => 
                                setTimeout(resolve, OPERATION_RETRY_DELAY * currentAttempt)
                            );
                            return handleDeleteFile(filename);
                        }

                        delete retryAttemptsRef.current[retryKey];
                        updateState({
                            hasError: true,
                            error: 'Failed to delete file'
                        });
                        Alert.alert('Error', 'Failed to delete file');
                    } finally {
                        updateState({ deletingFile: null });
                    }
                },
            },
        ],
    );
};

// Disconnection handling
const handleDisconnection = async () => {
    if (!bleManager) return;

    try {
        updateState({
            error: null,
            hasError: false
        });

        await bleManager.disconnect();
        
        setConnectedDevice(null);
        updateState({
            deviceFiles: [],
            transferProgress: null,
            deviceMetrics: null
        });

    } catch (error) {
        EnhancedLogger.error('FrameManagement', 'Disconnect error', error as Error);
        updateState({
            hasError: true,
            error: 'Failed to disconnect'
        });
        Alert.alert('Error', 'Failed to disconnect from device');
    }
};

// Connection status component
const ConnectionStatus = () => {
    const isConnected = !!connectedDevice;
    const metrics = componentState.deviceMetrics;
    
    const getConnectionQuality = (rssi: number): string => {
        if (rssi >= -60) return 'Excellent';
        if (rssi >= -70) return 'Good';
        if (rssi >= -80) return 'Fair';
        return 'Poor';
    };

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

// Debug information component
const DebugInfo = () => {
    if (!__DEV__) return null;

    const debugInfo = {
        bleManager: bleManager ? 'Initialized' : 'Not Initialized',
        isInitializing: componentState.isInitializing,
        isConnected: componentState.isConnected,
        isScanning: componentState.isScanning,
        isConnecting: componentState.isConnecting,
        error: componentState.error || 'None',
        deviceMetrics: componentState.deviceMetrics || 'None',
        fileCount: componentState.deviceFiles.length,
        transferProgress: componentState.transferProgress || 'None'
    };

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

// Main render logic
if (componentState.isInitializing) {
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
                {componentState.error && (
                    <View style={styles.errorContainer}>
                        <MaterialIcons name="error" size={24} color={colors.error} />
                        <Text style={styles.errorText}>{componentState.error}</Text>
                    </View>
                )}

                <ConnectionStatus />
                <DebugInfo />

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

                {!connectedDevice ? (
                    <Button
                        mode="contained"
                        onPress={() => {
                            EnhancedLogger.info('FrameManagement', 'User initiated device scan');
                            startScan();
                        }}
                        loading={componentState.isScanning || componentState.isConnecting}
                        disabled={componentState.isScanning || componentState.isConnecting || !bleManager}
                        style={styles.button}
                        icon={({size, color}) => (
                            <MaterialIcons name="bluetooth-searching" size={size} color={color} />
                        )}
                    >
                        {componentState.isScanning ? 'Scanning...' : 
                         componentState.isConnecting ? 'Connecting...' : 
                         !bleManager ? 'Bluetooth Not Ready' :
                         'Connect to Device'}
                    </Button>
                ) : (
                    <Button
                        mode="outlined"
                        onPress={() => {
                            EnhancedLogger.info('FrameManagement', 'User initiated disconnect');
                            handleDisconnection();
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
                                            disabled={componentState.isLoading || 
                                                componentState.deletingFile === file.name}
                                            loading={componentState.deletingFile === file.name}
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

// Styles at the bottom of the file
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