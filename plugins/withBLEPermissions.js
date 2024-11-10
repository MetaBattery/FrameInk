// plugins/withBLEPermissions.js
const { withAndroidManifest, withAppBuildGradle, withInfoPlist } = require('@expo/config-plugins');

function addBLEPermissions(androidManifest) {
  const { manifest } = androidManifest;

  // Ensure xmlns is set
  if (!manifest.$ || !manifest.$.xmlns) {
    manifest.$ = manifest.$ || {};
    manifest.$.xmlns = 'http://schemas.android.com/apk/res/android';
  }

  // Add permissions
  const permissions = [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.ACCESS_FINE_LOCATION',
    'android.permission.ACCESS_COARSE_LOCATION'
  ];

  manifest['uses-permission'] = manifest['uses-permission'] || [];
  manifest['uses-feature'] = manifest['uses-feature'] || [];

  permissions.forEach((permission) => {
    if (!manifest['uses-permission'].find((p) => p.$?.['android:name'] === permission)) {
      manifest['uses-permission'].push({
        $: {
          'android:name': permission,
        },
      });
    }
  });

  // Add bluetooth feature
  if (!manifest['uses-feature'].find((f) => f.$?.['android:name'] === 'android.hardware.bluetooth_le')) {
    manifest['uses-feature'].push({
      $: {
        'android:name': 'android.hardware.bluetooth_le',
        'android:required': 'true',
      },
    });
  }

  return androidManifest;
}

// Add this function to modify build.gradle
function modifyBuildGradle(buildGradle) {
  if (buildGradle.includes('react-native-ble-plx')) {
    return buildGradle;
  }

  return buildGradle.replace(
    /dependencies {/,
    `dependencies {
    implementation "com.polidea.rxandroidble2:rxandroidble:1.12.1"
    implementation "com.jakewharton.timber:timber:4.7.1"`
  );
}

const withBLEPermissions = (config) => {
  // Add Android permissions
  config = withAndroidManifest(config, (config) => {
    config.modResults = addBLEPermissions(config.modResults);
    return config;
  });

  // Modify build.gradle
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = modifyBuildGradle(config.modResults.contents);
    return config;
  });

  // Add iOS permissions
  config = withInfoPlist(config, (config) => {
    config.modResults.NSBluetoothAlwaysUsageDescription = 
      "This app uses Bluetooth to connect and transfer images to your FrameInk device.";
    config.modResults.NSBluetoothPeripheralUsageDescription = 
      "This app uses Bluetooth to connect and transfer images to your FrameInk device.";
    config.modResults.UIBackgroundModes = config.modResults.UIBackgroundModes || [];
    if (!config.modResults.UIBackgroundModes.includes('bluetooth-central')) {
      config.modResults.UIBackgroundModes.push('bluetooth-central');
    }
    return config;
  });

  return config;
};

module.exports = withBLEPermissions;