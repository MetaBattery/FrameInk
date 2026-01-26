# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

FrameInk is a React Native/Expo mobile application for managing a WiFi-connected e-paper display device (FrankeInk). The app allows users to:
- Connect to the device via WiFi or BLE
- Upload images to the device
- List and delete files on the device
- Display images on the e-paper display
- Monitor device storage and connectivity

## Key Technologies
- **Frontend**: React Native with Expo (file-based routing)
- **State Management**: React hooks and useState
- **Device Communication**:
  - WiFi REST API (primary)
  - BLE (Bluetooth Low Energy) as fallback
- **Image Processing**: Image manipulation, grayscale conversion, PNG export

## Build & Run Commands

```bash
# Install dependencies
npm install

# Start development server
npm start

# Run on specific platform
npm run android
npm run ios
npm run web

# Run tests
npm test

# Lint code
npm run lint
```

## Project Structure

- **`/app`**: Main Expo app directory with file-based routing
  - `(tabs)/`: Tab-based navigation screens
    - `index.tsx`: Home/connection management screen
    - `frame-management.tsx`: Device management interface (file listing, deletion, display)
    - `library.tsx`: Local image library
    - `settings.tsx`: App configuration
  - `_layout.tsx`: Root navigation layout

- **`/services`**: Core business logic and device communication
  - `WifiRestApiClient.ts`: HTTP client for WiFi API communication
    - Methods: `listFiles()`, `uploadFile()`, `deleteFile()`, `getStorageSpace()`, `displayImage()`, `isReachable()`
  - `BLECommsManager.ts`: BLE communication manager
  - `BLEConnectionManager.ts`: Manages BLE connections
  - `EnhancedLogger.ts`: Centralized logging service
  - `imageProcessor.ts`: Image processing utilities
  - `GrayscaleConverter.ts`: Converts images to 4-bit grayscale
  - `logger.ts`: Basic logging

- **`/components`**: Reusable React components
  - Theme components (`ThemedText.tsx`, `ThemedView.tsx`)
  - Modal dialogs and feature components
  - Navigation components

- **`/constants`**: Application constants
  - `colors.ts`: Theme color definitions
  - `DisplayConfig.ts`: Display configuration for e-paper device

- **`/hooks`**: Custom React hooks
  - `useThemeColor.ts`: Theme color management

- **`/utils`**: Utility functions
  - `bleInit.ts`: BLE initialization

- **`/android`**: Android-specific configuration and build files

- **`/plugins`**: Expo config plugins
  - `withBLEPermissions.js`: BLE permission setup

## Architecture Notes

### WiFi REST API Communication
The app uses `WifiRestApiClient` to communicate with the FrankeInk device via HTTP. The device should be running a webserver on standard HTTP port (80) with the following endpoints:

**Endpoints (expected by the app)**:
- `GET /api/files` - List files on device
- `POST /api/upload` - Upload file (multipart form data)
- `DELETE /api/files?filename=<name>` - Delete file
- `GET /api/storage` - Get storage information
- `POST /api/display?filename=<name>` - Display image on e-paper
- `GET /api/storage` - Check device reachability (used for health checks)

### Connection Flow
1. Device connection happens in the frame-management screen (`frame-management.tsx`)
2. User enters device IP or scans for BLE device
3. `testApiConnection()` is called to verify WiFi connectivity with retries (default: 10 retries with 500ms initial delay)
4. Once connected, `WifiRestApiClient` is initialized with the device IP
5. Files are loaded and displayed in a list
6. Image uploads use XMLHttpRequest with progress tracking

### State Management
- Component state is managed with React hooks (`useState`)
- Connection state is tracked across the app session
- Device metrics (RSSI, MTU) are monitored when available

## Key Files to Understand for Common Tasks

**Adding a new device API endpoint**: Modify `services/WifiRestApiClient.ts`

**Updating the device management UI**: Edit `app/(tabs)/frame-management.tsx`

**Changing image processing**: Update `services/imageProcessor.ts` or `services/GrayscaleConverter.ts`

**Modifying BLE behavior**: Update `services/BLECommsManager.ts` and `services/BLEConnectionManager.ts`

## Common Issues & Debugging

The app includes comprehensive logging via `EnhancedLogger`. Check logs when troubleshooting:
- Connection failures
- File transfer issues
- Image processing problems

Enable debug mode and check console output to trace execution flow.

## Known Limitations

- BLE is used as a fallback; WiFi REST API is the primary communication method
- Image upload uses XMLHttpRequest for progress tracking (not standard fetch)
- Device IP must be manually entered or discovered via BLE initial handshake

## Related Device Code

The FrankeInk device (not in this repo) runs the webserver that responds to the REST API calls. The device code should implement the endpoints mentioned in the WiFi REST API Communication section above.
