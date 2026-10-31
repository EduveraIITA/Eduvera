import type { ConfigContext, ExpoConfig } from 'expo/config';

if (process.env.EAS_BUILD_PROFILE === 'production') {
  const value = process.env.EXPO_PUBLIC_API_URL;
  let valid = false;
  try {
    const url = new URL(value ?? '');
    valid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && !url.hostname.endsWith('.invalid');
  } catch { /* Report the deployment configuration without exposing it. */ }
  if (!valid) throw new Error('Set EXPO_PUBLIC_API_URL to the HTTPS backend origin before a production build.');
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ThatCampus',
  slug: 'thatcampus',
  scheme: 'thatcampus',
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  web: { bundler: 'metro', output: 'single', favicon: './assets/icon.png' },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.thatcampus.mobile',
    infoPlist: {
      NSCameraUsageDescription: 'Scan campus QR codes and attach a photo when you choose to provide evidence.',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
    },
  },
  android: {
    package: 'app.thatcampus.mobile',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#ffffff' },
  },
  plugins: [
    './plugins/withAndroidReleasePolicy.cjs',
    'expo-router',
    ['expo-image-picker', { photosPermission: 'Choose a photo for your ThatCampus profile.', cameraPermission: 'Scan campus QR codes and attach a photo when you choose to provide evidence.', microphonePermission: false }],
    'expo-secure-store',
    ['expo-camera', { cameraPermission: 'Allow ThatCampus to scan campus QR codes and capture evidence you choose to attach.', microphonePermission: false, recordAudioAndroid: false }],
    ['expo-sqlite', { useSQLCipher: true }],
    ['expo-location', { locationWhenInUsePermission: 'Allow ThatCampus to share your location while you operate an assigned journey.' }],
  ],
  extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL },
});
