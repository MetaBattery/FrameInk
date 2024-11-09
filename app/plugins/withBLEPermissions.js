// plugins/withBLEPermissions.js
const { withAndroidManifest } = require('@expo/config-plugins');

function addBLEPermissions(androidManifest) {
  const { manifest } = androidManifest;

  // Add permissions
  if (!manifest.$ || !manifest.$.xmlns) {
    manifest.$ = manifest.$ || {};
    manifest.$.xmlns = 'http://schemas.android.com/apk/res/android';
  }

  const permissions = [
    'android.permission.BLUETOOTH',
    'android.permission.BLUETOOTH_ADMIN',
    'android.permission.BLUETOOTH_CONNECT',
    'android.permission.BLUETOOTH_SCAN',
    'android.permission.ACCESS_FINE_LOCATION',
  ];

  manifest['uses-permission'] = manifest['uses-permission'] || [];
  manifest['uses-feature'] = manifest['uses-feature'] || [];

  permissions.forEach((permission) => {
    if (!manifest['uses-permission'].find((p) => p.$['android:name'] === permission)) {
      manifest['uses-permission'].push({
        $: {
          'android:name': permission,
        },
      });
    }
  });

  // Add bluetooth feature
  manifest['uses-feature'].push({
    $: {
      'android:name': 'android.hardware.bluetooth_le',
      'android:required': 'true',
    },
  });

  return androidManifest;
}

module.exports = function withBLEPermissions(config) {
  return withAndroidManifest(config, (config) => {
    config.modResults = addBLEPermissions(config.modResults);
    return config;
  });
};