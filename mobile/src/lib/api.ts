import { Platform } from 'react-native';
import { fetch as nativeFetch } from 'expo/fetch';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Crypto from 'expo-crypto';
import { createCampusApiClient, type CampusDownloadAdapter } from './api-client';

export { ApiError } from './api-client';
const client = createCampusApiClient({
  origin: process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? `http://${Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1'}:8000` : 'https://invalid.invalid'),
  development: __DEV__,
  // The bundled Expo transport exposes bounded readable response streams on native.
  fetcher: (url, init) => nativeFetch(url, init),
});
export const getApiOrigin = client.getApiOrigin;
export const setApiOrigin = client.setApiOrigin;
export const setApiCallbacks = client.setApiCallbacks;
export const blockApiRequests = client.blockApiRequests;
export const bindApiSession = client.bindApiSession;
export const captureApiContext = client.captureApiContext;
export const apiFetch = client.apiFetch;
export const readCampusImage = client.readCampusImage;
export const readGateIdentityImage = client.readGateIdentityImage;
export const revokeCurrentNativeSession = client.revokeCurrentNativeSession;
export const readCurrentSession = <T,>() => apiFetch<T>('/api/v1/auth/native/session/');

/** Private bytes stay in a temporary native file until the share sheet closes. */
export function downloadCampusFile(path: string, filename: string): Promise<void> {
  const adapter: CampusDownloadAdapter = {
    isAvailable: Sharing.isAvailableAsync,
    createTemporaryFile(name) {
      const file = new File(Paths.cache, `thatcampus-${Crypto.randomUUID()}-${name}`);
      try { file.create({ overwrite: false }); }
      catch (cause) { if (file.exists) file.delete(); throw cause; }
      return { uri: file.uri, write: bytes => file.write(bytes), delete: () => { if (file.exists) file.delete(); } };
    },
    share: (uri, options) => Sharing.shareAsync(uri, options),
  };
  return client.downloadCampusFile(path, filename, adapter);
}
