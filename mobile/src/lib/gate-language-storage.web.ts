import { createGateLanguagePreferences } from './gate-operator-policy';

// Non-secret browser preference only. Native tokens never enter this adapter.
const preferences = createGateLanguagePreferences({ get: async key => window.localStorage.getItem(key), set: async (key, value) => window.localStorage.setItem(key, value) });
export const readGateLanguage = preferences.read;
export const saveGateLanguage = preferences.save;
