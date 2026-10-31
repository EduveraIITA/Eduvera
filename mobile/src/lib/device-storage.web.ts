import { createBrowserDeviceStorage } from './device-storage-browser';
export type { SecureStoreOptions } from 'expo-secure-store';

/** Compatibility marker; browsers cannot provide Keychain device-lock semantics. */
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;
const storage = createBrowserDeviceStorage();
export const getItemAsync = storage.getItemAsync;
export const setItemAsync = storage.setItemAsync;
export const deleteItemAsync = storage.deleteItemAsync;
