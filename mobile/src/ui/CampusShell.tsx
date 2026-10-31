import { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Keyboard, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Link, Redirect, usePathname, type Href } from 'expo-router';
import { useSession } from '../auth/SessionProvider';
import { useApi } from '../lib/query';
import { campusTabs, campusTabForHref } from '../lib/campus-tabs';
import { assistantEntryAvailable, assistantPerspective } from '../lib/assistant-access';
import { assertWorkspaceManifestContext, normalizeWorkspaceManifest } from '../../../packages/contracts/src/workspace-normalizer';
import { useAssistantPresentationState } from './assistant-presentation-context';
import { assistantPresentationPermitted } from '../lib/assistant-presentation-policy';
import { ApiError } from '../lib/api';
import { assistantLayout, assistantVisibleHeight } from '../lib/assistant-layout';
import { iosDockGeometry } from '../lib/dock-geometry';
import { OperatingPaneContext } from './OperatingPane';
import { useTheme } from './theme';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Glass } from './Glass';
import { CampusTabs } from './CampusTabs';
import { NativeDockMetricsContext } from './campus-tabs-options';
import { AssistantOverlayHost } from './AssistantOverlayHost';
import { useAssistantPresentation } from './AssistantPresentation';
import { NativeTabInsetsContext } from './native-tab-insets-context';
import { Icon } from './Icon';
import { AssistantMark } from './AssistantMark';
import { Button, Empty, Loading, Page } from './components';
import { useCampusNavigation, useHeaderBack } from './BackNavigation';

/** Same current workspace and domain screens, with browser links and responsive chrome. */
export function CampusShell() {
  const { expanded,mode } = useAssistantPresentationState(), assistantPresentation = useAssistantPresentation();
  const session = useSession(), { colors, dark } = useTheme(), { width,height } = useWindowDimensions();
  const safeInsets = useSafeAreaInsets();
  const shell = useRef<React.ComponentRef<typeof View>>(null), mounted = useRef(true), tablet = Platform.OS === 'ios' && Platform.isPad === true;
  const [shellFrame,setShellFrame] = useState({ width: 0,height: 0,screenY: 0 }), [pane,setPane] = useState({ width: 0,height: 0 }), [barHeight,setBarHeight] = useState(0), [dockHeight,setDockHeight] = useState(0), [headerHeight,setHeaderHeight] = useState(0), [keyboardTop,setKeyboardTop] = useState<number | null>(null);
  const shellWidth = shellFrame.width || width,shellHeight = shellFrame.height || height;
  const layout = assistantLayout({ width: shellWidth,height: tablet && expanded && shellWidth < 721 ? assistantVisibleHeight(shellHeight,shellFrame.screenY,keyboardTop) : shellHeight,isPad: tablet,expanded });
  const split = mode === 'split', fullscreen = mode === 'fullscreen';
  const measureShell = () => shell.current?.measureInWindow((_x,y) => { if (mounted.current) setShellFrame(previous => previous.screenY === y ? previous : { ...previous,screenY: y }); });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; },[]);
  useEffect(() => {
    if (!tablet || !expanded || layout.axis !== 'vertical') { setKeyboardTop(null); return; }
    setKeyboardTop(Keyboard.metrics()?.screenY ?? null); measureShell();
    const changed = Keyboard.addListener('keyboardWillChangeFrame',event => { setKeyboardTop(event.endCoordinates.height > 0 ? event.endCoordinates.screenY : null); measureShell(); });
    const hidden = Keyboard.addListener('keyboardWillHide',() => setKeyboardTop(null));
    return () => { changed.remove(); hidden.remove(); };
  },[tablet,expanded,layout.axis]);
  const pathname = usePathname(), desktop = Platform.OS === 'web' ? width >= 960 : layout.sidebar, back = useHeaderBack();
  const { onNavigate, selectTab, tabHref, tabConfigurationBusy, tabSelectionBlocked } = useCampusNavigation();
  const follow = (href: string, tabRoot?: string) => (event: { preventDefault(): void; nativeEvent: unknown; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean }) => {
    const native = (event.nativeEvent ?? {}) as { button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || native.metaKey || native.ctrlKey || native.shiftKey || native.altKey || (event.button ?? native.button ?? 0) !== 0) return;
    event.preventDefault(); if (tabRoot) selectTab(tabRoot); else onNavigate(href);
  };
  const workspace = useApi<unknown>(session.schoolId ? '/api/v1/workspace' : null);
  const notifications = useApi<{ unread_count: number }>('/api/v1/notifications/?limit=1');
  const preference = useApi<{ enabled: boolean }>('/api/v1/auth/pro-features/');
  const manifest = useMemo(() => {
    if (!workspace.data || !session.user || !session.schoolId) return null;
    try { const value = normalizeWorkspaceManifest(workspace.data); assertWorkspaceManifestContext(value, { actorUserId: session.user.id, institutionId: session.schoolId, environment: session.environment }); return value; }
    catch { return null; }
  }, [workspace.data, session.user, session.schoolId, session.environment]);
  if (session.status === 'loading' && !session.user) return <Page title="Opening your campus"><Loading /></Page>;
  if (session.status !== 'authenticated' && !session.user) return <Redirect href="/" />;
  const verifying = session.status !== 'authenticated' || tabConfigurationBusy || preference.isPending;
  const institution = manifest?.context.institution_label ?? session.memberships.find(item => item.school_id === session.schoolId)?.school_name ?? 'Your campus';
  const crest = institution.split(/\s+/).filter(Boolean).map(word => word[0]).join('').slice(0, 3).toUpperCase();
  const workCount = manifest?.work.counts?.needs_me ?? 0;
  const unread = Number.isSafeInteger(notifications.data?.unread_count) ? notifications.data!.unread_count : 0;
  const assistant = assistantPresentationPermitted(assistantEntryAvailable(session.environment,true,assistantPerspective(session.user,session.memberships,session.schoolId)),preference.data,preference.error instanceof ApiError ? preference.error.status : undefined);
  const destinations = campusTabs.filter(item => item.name !== '(assistant)' || desktop && assistant), iosDock = Platform.OS === 'ios', physicalBottom = !(split && layout.axis === 'vertical');
  const dock = iosDockGeometry({ width: layout.app.width,height: dockHeight,bottom: safeInsets.bottom,left: safeInsets.left,right: safeInsets.right,count: destinations.length,physicalBottom,assistantBubble: !desktop && assistant,border: Platform.OS === 'web' ? 1 : 0 });
  const toggleAssistant = () => { assistantPresentation.active ? assistantPresentation.close() : assistantPresentation.open(); };
  const root = campusTabForHref(pathname)?.href ?? '/today', detail = back.visible;
  const destination = back.label.replace(/^Back to\s+/i, '').replace(/^./, letter => letter.toLocaleUpperCase());
  const brand = <View accessibilityLabel={institution} style={styles.brand}><View style={[styles.crest, { backgroundColor: colors.action }]}><Text style={{ color: colors.onAction, fontSize: 11, fontWeight: '800' }}>{crest}</Text></View>{!detail || desktop || width >= 600 ? <Text numberOfLines={2} style={[styles.institution, { color: colors.ink }]}>{institution}</Text> : null}</View>;
  const nav = <View accessibilityRole="navigation" accessibilityLabel="Workspace" style={desktop ? styles.sideNavigation : [styles.bottomNavigation,{ maxWidth: undefined,paddingHorizontal: 0,gap: dock.gap }]}>{destinations.map(item => {
    const action = item.name === '(assistant)', selected = action ? assistantPresentation.active : root === item.href;
    const button = <Pressable accessibilityLabel={item.label} accessibilityRole={action ? 'button' : 'tab'} accessibilityState={action ? { expanded: assistantPresentation.active } : { selected }} aria-current={!action && selected ? 'page' : undefined} onPress={action ? toggleAssistant : undefined} style={StyleSheet.flatten([desktop ? styles.sideItem : styles.tab,iosDock && !desktop ? { minHeight: dock.minimumTabHeight,minWidth: dock.minimumTargetWidth,paddingVertical: 4,borderRadius: dock.selectionRadius,borderCurve: 'continuous' } : undefined,{ backgroundColor: selected && (!iosDock || desktop) ? colors.row : 'transparent' }])}><View style={{ position: 'relative' }}>{item.icon ? <Icon name={item.icon} size={desktop ? 28 : 25} /> : <AssistantMark size={desktop ? 30 : 26} />}{item.href === '/work' && workCount > 0 ? <View style={[styles.badge,{ backgroundColor: colors.danger }]}><Text style={{ color: colors.onAction,fontSize: 10,fontWeight: '700' }}>{workCount > 99 ? '99+' : workCount}</Text></View> : null}</View><Text numberOfLines={desktop ? undefined : 1} adjustsFontSizeToFit={!desktop} minimumFontScale={.75} style={[desktop ? styles.sideLabel : styles.tabLabel,{ color: selected ? colors.link : colors.ink }]}>{item.label}</Text></Pressable>;
    return action ? <View key={item.name} style={desktop ? undefined : { flex: 1 }}>{button}</View> : <Link key={item.name} href={tabHref(item.href) as Href} onPress={follow(tabHref(item.href),item.href)} asChild>{button}</Link>;
  })}</View>;
  return <View style={{ flex: 1, minHeight: 0 }}>
    <View ref={shell} collapsable={false} {...(verifying && Platform.OS === 'web' ? { inert: true } : {})} pointerEvents={verifying ? 'none' : 'auto'} accessibilityElementsHidden={verifying} importantForAccessibility={verifying ? 'no-hide-descendants' : 'auto'} onLayout={({ nativeEvent: { layout } }) => { setShellFrame(previous => previous.width === layout.width && previous.height === layout.height ? previous : { ...previous,width: layout.width,height: layout.height }); measureShell(); }} style={[styles.frame, { backgroundColor: colors.canvas }]}>
      {desktop && !fullscreen ? <SafeAreaView edges={['top','left','bottom']} style={{ width: 244 }}><Glass style={[styles.sidebar, { borderColor: colors.border,flex: 1 }]}>{brand}{nav}<View style={styles.scope}><Text style={[styles.support, { color: colors.muted }]}>Your workspace</Text><Text style={{ color: colors.ink, fontSize: 14, lineHeight: 21, fontWeight: '600' }}>{institution}</Text><Text style={[styles.support, { color: colors.muted }]}>Tools available through your responsibilities.</Text></View><Image source={dark ? require('../../assets/wordmark-dark.png') : require('../../assets/wordmark-light.png')} resizeMode="contain" accessibilityLabel="Powered by ThatCampus" style={{ width: 90, height: 54, alignSelf: 'flex-start' }} /></Glass></SafeAreaView> : null}
      <View style={[styles.workspace,{ flexDirection: split && layout.axis === 'horizontal' ? 'row' : 'column' }]}>
        <View style={[styles.operating,split ? layout.axis === 'horizontal' ? { flex: 0,width: Math.max(0,layout.app.width - (desktop ? 244 : 0)) } : { flex: 0,height: layout.app.height } : undefined]}>
          {!fullscreen && Platform.OS === 'web' ? <View onLayout={({ nativeEvent: { layout } }) => setHeaderHeight(previous => previous === layout.height ? previous : layout.height)} style={[styles.header, { borderColor: colors.border }]}>
            {detail ? <Glass style={styles.backSurface}><Pressable accessibilityRole="button" accessibilityLabel={destination === 'Back' ? 'Go back' : `Back to ${destination}`} accessibilityState={{ disabled: back.disabled }} disabled={back.disabled} onPress={back.onPress} style={[styles.back, { opacity: back.disabled ? .45 : 1 }]}><Icon name="back" size={22} /><Text numberOfLines={1} style={{ flexShrink: 1, color: colors.link, fontSize: 17, fontWeight: '600' }}>{destination}</Text></Pressable></Glass> : null}
            {!desktop && !detail ? brand : <View style={{ flex: 1 }} />}
            <Glass style={styles.actions}><Link href="/more/notifications" onPress={follow('/more/notifications')} asChild><Pressable accessibilityRole="link" accessibilityLabel={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`} style={styles.utility}><Icon name="notifications" size={24} />{unread > 0 ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.notificationBadge, { backgroundColor: colors.danger }]}><Text style={{ color: colors.onAction, fontSize: 10, fontWeight: '700' }}>{unread > 99 ? '99+' : unread}</Text></View> : null}</Pressable></Link><Link href="/more/account" onPress={follow('/more/account')} asChild><Pressable accessibilityRole="link" accessibilityLabel="Open account" style={styles.utility}><Icon name="profile" size={24} /></Pressable></Link></Glass>
          </View> : null}
          <View style={styles.content} onLayout={({ nativeEvent: { layout } }) => setPane(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width,height: layout.height })}>
            <View {...(assistantPresentation.active && fullscreen && Platform.OS === 'web' ? { inert: true } : {})} pointerEvents={assistantPresentation.active && fullscreen ? 'none' : 'auto'} accessibilityElementsHidden={assistantPresentation.active && fullscreen} importantForAccessibility={assistantPresentation.active && fullscreen ? 'no-hide-descendants' : 'auto'} style={{ flex: 1,minHeight: 0 }}>
              <OperatingPaneContext.Provider value={pane}><NativeTabInsetsContext.Provider value={!desktop && !fullscreen}>
                <NativeDockMetricsContext.Provider value={setBarHeight}><CampusTabs key={session.scopeKey} hidden={fullscreen} sidebar={desktop} blocked={verifying || tabSelectionBlocked} assistant={assistant} workCount={workCount} activeRoot={root} onTabPress={selectTab} onAssistantPress={toggleAssistant} /></NativeDockMetricsContext.Provider>
              </NativeTabInsetsContext.Provider></OperatingPaneContext.Provider>
            </View>
          </View>
          {!iosDock && !desktop && !fullscreen ? <SafeAreaView pointerEvents="box-none" onLayout={({ nativeEvent: { layout } }) => setBarHeight(previous => previous === layout.height ? previous : layout.height)} edges={{ left: 'maximum',right: 'maximum',bottom: physicalBottom ? iosDock ? 'maximum' : 'additive' : 'off' }} style={[styles.bottomSafe,iosDock ? { position: 'absolute',left: 0,right: 0,bottom: 0 } : undefined,{ paddingHorizontal: dock.horizontal },iosDock ? { paddingBottom: dock.bottomPadding } : undefined]}><View style={[styles.dockRow,{ maxWidth: dock.maximumWidth,gap: dock.controlGap,marginBottom: iosDock ? dock.surfaceBottomMargin : 0 }]}><Glass onLayout={({ nativeEvent: { layout } }) => setDockHeight(previous => previous === layout.height ? previous : layout.height)} style={[styles.bottomBar, { borderColor: colors.border,minHeight: dock.minimumTabHeight + dock.interior * 2,padding: dock.interior,paddingTop: dock.interior,paddingBottom: dock.interior },iosDock ? { borderRadius: dock.surfaceRadius,borderCurve: 'continuous',borderTopWidth: 0 } : undefined]}>{nav}</Glass>{assistant ? <Glass style={{ width: dock.bubbleSize,height: dock.bubbleSize,padding: dock.interior,borderRadius: dock.bubbleSize / 2,borderCurve: 'circular',flexShrink: 0 }}><Pressable accessibilityRole="button" accessibilityLabel="Assistant" accessibilityHint={assistantPresentation.active ? 'Close the Assistant bubble' : 'Open the Assistant bubble'} accessibilityState={{ expanded: assistantPresentation.active }} onPress={toggleAssistant} style={{ flex: 1,minWidth: 44,minHeight: 44,alignItems: 'center',justifyContent: 'center',borderRadius: (dock.bubbleSize - dock.interior * 2) / 2,borderCurve: 'circular',backgroundColor: assistantPresentation.active && !iosDock ? colors.row : 'transparent' }}><AssistantMark size={36} /></Pressable></Glass> : null}</View></SafeAreaView> : null}
        </View>
        <AssistantOverlayHost layout={layout} compactInsets={{ top: Platform.OS === 'web' ? headerHeight : 0,bottom: desktop ? 0 : barHeight }} />
      </View>
    </View>
    {verifying ? <View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.canvas }}><Page title={tabConfigurationBusy ? 'Updating Assistant navigation' : session.status === 'error' ? 'Reconnect to your campus' : 'Confirming your campus'}>{session.status === 'error' ? <><Empty title="Your session could not be confirmed" message={session.error ?? undefined} onRetry={() => { void session.refresh(); }} /><Button title="Sign out" kind="secondary" onPress={() => { void session.logout().catch(() => {}); }} /></> : <Loading />}</Page></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, flexDirection: 'row' }, workspace: { flex: 1, minWidth: 0, minHeight: 0 }, operating: { flex: 1,minWidth: 0,minHeight: 0 },
  sidebar: { width: 244, padding: 20, gap: 30, borderRightWidth: StyleSheet.hairlineWidth }, brand: { flexDirection: 'row', alignItems: 'center', gap: 9, minWidth: 0, flexShrink: 1 }, crest: { width: 37, height: 37, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, institution: { flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  sideNavigation: { gap: 8 }, sideItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 52, borderRadius: 16, gap: 12 }, sideLabel: { fontSize: 16, lineHeight: 23, fontWeight: '600' }, scope: { marginTop: 'auto', gap: 8 }, support: { fontSize: 12, lineHeight: 18 },
  backSurface: { maxWidth: '55%', flexShrink: 1, borderRadius: 24 }, back: { minHeight: 44, minWidth: 44, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 },
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 8 }, actions: { flexDirection: 'row', marginLeft: 'auto', gap: 4, paddingHorizontal: 4, borderRadius: 24, flexShrink: 0 }, utility: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 }, notificationBadge: { position: 'absolute', top: 2, right: 0, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' }, content: { flex: 1, minHeight: 0 },
  bottomSafe: { paddingHorizontal: 8 }, dockRow: { width: '100%',alignSelf: 'center',flexDirection: 'row',alignItems: 'flex-end' }, bottomBar: { flex: 1,minWidth: 0,borderRadius: 30, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingBottom: 8 }, bottomNavigation: { flexDirection: 'row', alignSelf: 'center', width: '100%', maxWidth: 480, gap: 4, paddingHorizontal: 12 }, tab: { flex: 1,minWidth: 44, minHeight: 52, paddingHorizontal: 4, paddingVertical: 6, alignItems: 'center', justifyContent: 'center', gap: 3, borderRadius: 20 }, tabLabel: { fontSize: 11, lineHeight: 16, fontWeight: '600', maxWidth: '100%', textAlign: 'center' }, badge: { position: 'absolute', minWidth: 16, paddingHorizontal: 4, height: 16, borderRadius: 8, top: -6, right: -10, alignItems: 'center', justifyContent: 'center' },
});
