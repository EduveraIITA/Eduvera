import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Appearance, Platform, useColorScheme } from 'react-native';
import { initialAppearance, readAppearance, saveAppearance, subscribeAppearance } from './theme-storage';

import { themePalettes, type ThemeColors } from './theme-tokens';

const light = themePalettes.live.light;
export type ThemePreference = 'system' | 'light' | 'dark';
interface Theme { colors: ThemeColors; dark: boolean; preference: ThemePreference; persistenceError: string | null; setPreference: (preference: ThemePreference) => void }
const Context = createContext<Theme>({ colors: light, dark: false, preference: 'system', persistenceError: null, setPreference: () => {} });
export function ThemeProvider({ simulation, children }: React.PropsWithChildren<{ simulation: boolean }>) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(initialAppearance);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const revision = useRef(0), storage = useRef(Promise.resolve());
  useEffect(() => { let active = true; void readAppearance().then(value => { if (active && !revision.current) setPreferenceState(value); }).catch(() => { if (active) setPersistenceError('Saved appearance could not be read on this device.'); }); const unsubscribe = subscribeAppearance(value => { revision.current++; setPreferenceState(value); setPersistenceError(null); }); return () => { active = false; unsubscribe(); }; }, []);
  useEffect(() => { if (Platform.OS !== 'web') Appearance.setColorScheme(preference === 'system' ? 'auto' : preference); }, [preference]);
  const dark = preference === 'system' ? system === 'dark' : preference === 'dark';
  const colors = themePalettes[simulation ? 'simulation' : 'live'][dark ? 'dark' : 'light'];
  useEffect(() => { if (Platform.OS === 'web' && typeof document !== 'undefined') { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; document.documentElement.style.colorScheme = dark ? 'dark' : 'light'; document.documentElement.style.backgroundColor = colors.canvas; } }, [dark, colors.canvas]);
  return <Context.Provider value={{ colors, dark, preference, persistenceError, setPreference(value) { revision.current++; setPreferenceState(value); setPersistenceError(null); storage.current = storage.current.catch(() => {}).then(() => saveAppearance(value)).catch(() => { setPersistenceError('Appearance could not be saved on this device.'); }); } }}>{children}</Context.Provider>;
}
export function useTheme() { return useContext(Context); }
