// plugins/withBLEPermissions.js
const { withAndroidManifest, withAppBuildGradle, withInfoPlist } = require('@expo/config-plugins');

// Constants
const BLE_PERMISSIONS = [
  'android.permission.BLUETOOTH',
  'android.permission.BLUETOOTH_ADMIN',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION'
];

const BLE_FEATURES = [
  {
    name: 'android.hardware.bluetooth_le',
    required: true
  }
];

const GRADLE_DEPENDENCIES = [
  {
    implementation: 'com.polidea.rxandroidble2:rxandroidble:1.12.1'
  },
  {
    implementation: 'com.jakewharton.timber:timber:4.7.1'
  }
];

/**
 * Add BLE-related permissions and features to Android Manifest
 * @param {object} androidManifest - The Android manifest object
 * @returns {object} Modified Android manifest
 */
function addBLEPermissions(androidManifest) {
  const { manifest } = androidManifest;

  // Ensure proper xmlns
  manifest.$ = manifest.$ || {};
  if (!manifest.$.xmlns) {
    manifest.$.xmlns = 'http://schemas.android.com/apk/res/android';
  }

  // Initialize arrays if they don't exist
  manifest['uses-permission'] = manifest['uses-permission'] || [];
  manifest['uses-feature'] = manifest['uses-feature'] || [];

  // Add permissions
  BLE_PERMISSIONS.forEach((permission) => {
    const exists = manifest['uses-permission'].some(
      (p) => p.$?.['android:name'] === permission
    );

    if (!exists) {
      manifest['uses-permission'].push({
        $: {
          'android:name': permission,
        },
      });
    }
  });

  // Add features
  BLE_FEATURES.forEach((feature) => {
    const exists = manifest['uses-feature'].some(
      (f) => f.$?.['android:name'] === feature.name
    );

    if (!exists) {
      manifest['uses-feature'].push({
        $: {
          'android:name': feature.name,
          'android:required': feature.required.toString(),
        },
      });
    }
  });

  return androidManifest;
}

/**
 * Modify build.gradle to add necessary dependencies
 * @param {string} buildGradle - The build.gradle content
 * @returns {string} Modified build.gradle content
 */
function modifyBuildGradle(buildGradle) {
  // Check if dependencies are already added
  if (buildGradle.includes('rxandroidble')) {
    return buildGradle;
  }

  // Create dependencies string
  const dependenciesString = GRADLE_DEPENDENCIES
    .map(dep => {
      const [key, value] = Object.entries(dep)[0];
      return `    ${key} "${value}"`;
    })
    .join('\n');

  // Add dependencies
  return buildGradle.replace(
    /dependencies\s*{/,
    `dependencies {
${dependenciesString}`
  );
}

/**
 * Configure iOS permissions and background modes
 * @param {object} infoPlist - The Info.plist configuration object
 * @returns {object} Modified Info.plist configuration
 */
function configureIosPermissions(infoPlist) {
  const BLE_USAGE_DESCRIPTION = 
    "This app uses Bluetooth to connect and transfer images to your FrameInk device.";

  // Add Bluetooth usage descriptions
  infoPlist.NSBluetoothAlwaysUsageDescription = BLE_USAGE_DESCRIPTION;
  infoPlist.NSBluetoothPeripheralUsageDescription = BLE_USAGE_DESCRIPTION;

  // Configure background modes
  infoPlist.UIBackgroundModes = infoPlist.UIBackgroundModes || [];
  if (!infoPlist.UIBackgroundModes.includes('bluetooth-central')) {
    infoPlist.UIBackgroundModes.push('bluetooth-central');
  }

  return infoPlist;
}

/**
 * Main plugin function to configure BLE permissions and settings
 * @param {object} config - The Expo config object
 * @returns {object} Modified config
 */
const withBLEPermissions = (config) => {
  // Validate config
  if (!config) {
    throw new Error('Config object is required');
  }

  try {
    // Configure Android
    config = withAndroidManifest(config, (config) => {
      config.modResults = addBLEPermissions(config.modResults);
      return config;
    });

    config = withAppBuildGradle(config, (config) => {
      config.modResults.contents = modifyBuildGradle(config.modResults.contents);
      return config;
    });

    // Configure iOS
    config = withInfoPlist(config, (config) => {
      config.modResults = configureIosPermissions(config.modResults);
      return config;
    });

    return config;
  } catch (error) {
    throw new Error(`Failed to configure BLE permissions: ${error.message}`);
  }
};

module.exports = withBLEPermissions;