import * as SecureStore from 'expo-secure-store';
import { createGateLanguagePreferences } from './gate-operator-policy';

const preferences = createGateLanguagePreferences({ get: key => SecureStore.getItemAsync(key), set: (key, value) => SecureStore.setItemAsync(key, value) });
export const readGateLanguage = preferences.read;
export const saveGateLanguage = preferences.save;
