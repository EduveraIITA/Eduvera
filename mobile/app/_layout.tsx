import { useEffect, useMemo } from 'react';
import { AppState, Platform, Pressable, ScrollView, Text, useColorScheme, View } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { ThemeProvider, useTheme } from '../src/ui/theme';
import { AlertHost } from '../src/ui/AlertHost';
import { MotionProvider } from '../src/ui/Motion';
import { AssistantPresentationProvider } from '../src/ui/AssistantPresentation';
import { BackNavigationProvider } from '../src/ui/BackNavigation';
import { sessionPresentationIdentity } from '../src/auth/session-presentation';
import { AttendanceOfflineSync } from '../src/features/AttendanceOfflineSync';

const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
function AppearanceBoundary() {
  const { dark, colors } = useTheme();
  // Native stack headers resolve their UIKit glass style from the router theme,
  // independently of the page palette and Appearance's window override.
  const navigationTheme = useMemo(() => ({
    ...(dark ? DarkTheme : DefaultTheme),
    colors: { primary: colors.link, background: colors.canvas, card: colors.surface, text: colors.ink, border: colors.border, notification: colors.danger },
  }), [dark, colors]);
  useEffect(() => { if (Platform.OS === 'android') { try { void require('expo-system-ui').setBackgroundColorAsync(colors.canvas).catch(() => {}); } catch { /* The React Native page background remains the fallback. */ } } }, [colors.canvas]);
  useEffect(() => { if (__DEV__) { try { require('expo-dev-client').setToolsButtonVisible(false); } catch { /* The development overlay is optional. */ } } }, []);
  useEffect(() => { focusManager.setFocused(AppState.currentState === 'active'); const listener = AppState.addEventListener('change', state => focusManager.setFocused(state === 'active')); return () => { listener.remove(); focusManager.setFocused(undefined); }; }, []);
  return <NavigationThemeProvider value={navigationTheme}><StatusBar style={dark ? 'light' : 'dark'} /><AttendanceOfflineSync /><Stack screenOptions={{ headerShown: false }} /><AlertHost /></NavigationThemeProvider>;
}
function ThemedApp() { const session = useSession(); const presentationKey = JSON.stringify([session.scopeKey, sessionPresentationIdentity(session)]); return <ThemeProvider simulation={session.environment.mode === 'simulation'}><MotionProvider><AssistantPresentationProvider key={presentationKey}><BackNavigationProvider><AppearanceBoundary /></BackNavigationProvider></AssistantPresentationProvider></MotionProvider></ThemeProvider>; }
export default function RootLayout() { return <SafeAreaProvider><QueryClientProvider client={client}><SessionProvider><ThemedApp /></SessionProvider></QueryClientProvider></SafeAreaProvider>; }
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => void }) {
  const dark = useColorScheme() === 'dark', ink = dark ? '#ffffff' : '#111111', canvas = dark ? '#111111' : '#ffffff';
  return <View style={{ flex: 1, backgroundColor: canvas }}><ScrollView contentContainerStyle={{ paddingTop: 72, paddingBottom: 40, paddingHorizontal: 24, gap: 20 }}><Text accessibilityRole="header" style={{ color: ink, fontSize: 26, lineHeight: 34, fontWeight: '700' }}>Something interrupted this screen</Text><Text accessibilityRole="alert" style={{ color: ink, fontSize: 16, lineHeight: 24 }}>{error.message}</Text><Pressable accessibilityRole="button" onPress={retry} style={({ pressed }) => ({ minHeight: 48, padding: 14, backgroundColor: ink, borderRadius: 12, opacity: pressed ? 0.7 : 1, alignItems: 'center' })}><Text style={{ color: canvas, fontSize: 16, lineHeight: 24, fontWeight: '600' }}>Try again</Text></Pressable></ScrollView></View>;
}
