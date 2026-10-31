import { Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { Stack, useRootNavigationState } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { focusedCampusRoute, type CampusNavigationState } from '../lib/back-policy';
import { useCampusNavigation, useHeaderBack } from './BackNavigation';
import { useReducedMotion } from './Motion';
import { useAssistantPresentationState } from './assistant-presentation-context';
import { useTheme } from './theme';
import { Icon } from './Icon';

export function DomainStack({ brandLabel, campusUtilities = true }: { brandLabel?: string; campusUtilities?: boolean } = {}) {
  const { mode } = useAssistantPresentationState();
  const { colors } = useTheme(), session = useSession(), reducedMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  const { onNavigate } = useCampusNavigation(), back = useHeaderBack();
  const focusedKey = focusedCampusRoute(useRootNavigationState() as CampusNavigationState | undefined)?.key;
  const destination = back.label.replace(/^Back to\s+/i, '').replace(/^./, letter => letter.toLocaleUpperCase());
  const backLabel = destination === 'Back' ? 'Go back' : `Back to ${destination}`;
  const name = brandLabel ?? session.memberships.find(item => item.school_id === session.schoolId)?.school_name ?? 'Your campus';
  const crest = name.split(/\s+/).filter(Boolean).map(word => word[0]).join('').slice(0, 3).toUpperCase();
  const notifications = useApi<{ unread_count: number }>(session.schoolId ? '/api/v1/notifications/?limit=1' : null);
  const unread = notifications.data?.unread_count;
  return <Stack screenOptions={({ route }) => {
    const active = route.key === focusedKey, customBack = active && back.visible && (Platform.OS !== 'ios' || back.custom || back.disabled);
    const backControl = <Pressable accessibilityRole="button" accessibilityLabel={backLabel} accessibilityState={{ disabled: back.disabled }} disabled={back.disabled} onPress={back.onPress} style={{ minHeight: 44, minWidth: 44, maxWidth: 200, paddingHorizontal: Platform.OS === 'ios' ? 8 : 0, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 4, opacity: back.disabled ? .45 : 1 }}><Icon name="back" size={22} /><Text numberOfLines={1} style={{ color: colors.link, fontSize: 17 * fontScale, flexShrink: 1 }}>{destination}</Text></Pressable>;
    return {
      headerShown: mode !== 'fullscreen',
      animation: reducedMotion ? 'none' : 'default',
      headerTitleAlign: 'left',
      // A null custom title lets UIKit fall back to the route title. Keep an
      // explicit empty view so the page's own heading remains its only title.
      headerTitle: () => back.visible ? <View style={{ width: 0, height: 0 }} /> : <View accessibilityLabel={name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 170, minHeight: 44 }}><View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: colors.action, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.onAction, fontSize: 10, fontWeight: '800' }}>{crest}</Text></View><Text numberOfLines={2} style={{ flexShrink: 1, color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: '600' }}>{name}</Text></View>,
      headerTintColor: colors.link, headerShadowVisible: false,
      headerBackButtonDisplayMode: 'default', headerBackTitle: active ? destination : undefined,
      // UIKit's adaptive default can hide the destination completely. An explicit
      // scaled system title retains the native Back item, menu and swipe gesture.
      headerBackTitleStyle: { fontFamily: 'System', fontSize: 17 * fontScale },
      headerBackVisible: active ? back.visible && !customBack : route.name === 'index' ? false : undefined,
      contentStyle: { backgroundColor: colors.canvas },
      ...(customBack && Platform.OS === 'ios' ? { unstable_headerLeftItems: () => [{ type: 'custom' as const, element: backControl, hidesSharedBackground: false }] } : {}),
      ...(customBack && Platform.OS !== 'ios' ? { headerLeft: () => backControl } : {}),
      headerRight: campusUtilities ? () => <View style={{ flexDirection: 'row', gap: 4 }}><Pressable accessibilityRole="button" accessibilityLabel={`Notifications${Number.isSafeInteger(unread) && unread! > 0 ? `, ${unread} unread` : ''}`} onPress={() => onNavigate('/more/notifications')} style={{ padding: 10, minWidth: 44, minHeight: 44 }}><Icon name="notifications" size={24} />{Number.isSafeInteger(unread) && unread! > 0 ? <View style={{ position: 'absolute', top: 0, right: 0, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.onAction, fontSize: 10, fontWeight: '700' }}>{unread! > 99 ? '99+' : unread}</Text></View> : null}</Pressable><Pressable accessibilityRole="button" accessibilityLabel="Account" onPress={() => onNavigate('/more/account')} style={{ padding: 10, minWidth: 44, minHeight: 44 }}><Icon name="profile" size={24} /></Pressable></View> : undefined,
    };
  }} />;
}
