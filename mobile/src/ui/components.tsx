import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { SafeAreaView, ScrollViewMarker } from 'react-native-screens/experimental';
import { HeaderShownContext } from 'expo-router/react-navigation';
import { SafeAreaView as SystemSafeAreaView } from 'react-native-safe-area-context';
import { NativeTabInsetsContext } from './native-tab-insets-context';
import { useTheme } from './theme';
import { Icon } from './Icon';
import { ExecutionBanner } from './ExecutionBanner';
import { themeRadii } from './theme-tokens';
import { BrandLoadingIcon } from './AssistantMark';
import { NativeScreenInsetsProvider, useNativeScreenInsets } from './native-screen-insets';
import { campusKeyboardOverlap } from '../lib/campus-workspace-layout';
import { usePageNavigationTitle } from './BackNavigation';

const PageScrollContext = createContext<() => void>(() => {});
export function usePageScroll() { return useContext(PageScrollContext); }

export function Page({ title, subtitle, header, children, refreshing = false, onRefresh, maxWidth = 920, footer, footerPadding = 20, canvas = false, footerSeparator = true, footerKeyboardBehavior = 'keep' }: React.PropsWithChildren<{ title: string; subtitle?: string; header?: React.ReactNode; refreshing?: boolean; onRefresh?: () => void; maxWidth?: number; footer?: React.ReactNode; footerPadding?: number; canvas?: boolean; footerSeparator?: boolean; footerKeyboardBehavior?: 'keep' | 'hide' }>) {
  usePageNavigationTitle(title);
  const { colors } = useTheme();
  const headerShown = useContext(HeaderShownContext);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollToTop = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  const [pulled, setPulled] = useState(false), previous = useRef(refreshing);
  useEffect(() => { if (previous.current && !refreshing) setPulled(false); previous.current = refreshing; }, [refreshing]);
  const ScrollContainer = Platform.OS === 'ios' ? ScrollViewMarker : View;
  // Ordinary pages extend behind floating native tabs. A pinned composer instead
  // owns the measured bottom exclusion; neither path reserves a guessed tab band.
  return <PageScrollContext.Provider value={scrollToTop}><NativePageSafeArea headerShown={!!headerShown} backgroundColor={colors.canvas}><ExecutionBanner /><NativeScreenInsetsProvider><PageBody footer={footer} footerKeyboardBehavior={footerKeyboardBehavior} footerPadding={footerPadding} footerSeparator={footerSeparator} maxWidth={maxWidth}>
    {canvas ? <View style={{ flex: 1, minHeight: 0 }}>{children}</View> : <ScrollContainer style={{ flex: 1, minHeight: 0 }}><ScrollView ref={scroll} showsVerticalScrollIndicator={Platform.OS !== 'web'} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} automaticallyAdjustKeyboardInsets={!footer} automaticallyAdjustContentInsets={false} automaticallyAdjustsScrollIndicatorInsets contentInsetAdjustmentBehavior={Platform.OS === 'ios' && !footer ? 'automatic' : 'never'} refreshControl={onRefresh ? <RefreshControl refreshing={pulled && refreshing} onRefresh={() => { setPulled(true); onRefresh(); }} tintColor={colors.link} /> : undefined} style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={styles.page}>
      <View style={[styles.content, { maxWidth }]}>{header !== undefined ? header : <Text accessibilityRole="header" aria-level={1} style={[styles.title, { color: colors.ink }]}>{title}</Text>}{header === undefined && subtitle ? <Text style={[styles.subtitle, { color: colors.muted }]}>{subtitle}</Text> : null}{children}</View>
    </ScrollView></ScrollContainer>}
  </PageBody></NativeScreenInsetsProvider></NativePageSafeArea></PageScrollContext.Provider>;
}
export function NativePageSafeArea({ children,headerShown,backgroundColor }: React.PropsWithChildren<{ headerShown: boolean; backgroundColor: string }>) {
  const nativeTabs = useContext(NativeTabInsetsContext);
  if (Platform.OS === 'android') {
    // The shared JS shell allocates its actual bar/system inset in layout.
    // A nested system-only RNSSafeAreaView can steal an interface listener;
    // use the existing system-safe provider and keep one bottom owner.
    return <SystemSafeAreaView edges={{ top: headerShown ? 'off' : 'additive',bottom: nativeTabs ? 'off' : 'additive',left: 'additive',right: 'additive' }} style={{ flex: 1,backgroundColor }}>{children}</SystemSafeAreaView>;
  }
  return <SafeAreaView edges={{ top: true,bottom: Platform.OS !== 'ios',left: true,right: true }} style={{ flex: 1,backgroundColor }}>{children}</SafeAreaView>;
}
export function PageBody({ children, footer, footerPadding, footerSeparator, maxWidth, footerBackgroundColor, passThrough = false, footerKeyboardBehavior = 'keep' }: React.PropsWithChildren<{ passThrough?: boolean; footer?: React.ReactNode; footerPadding: number; footerSeparator: boolean; maxWidth: number; footerBackgroundColor?: string; footerKeyboardBehavior?: 'keep' | 'hide' }>) {
  const { colors } = useTheme(), { bottom } = useNativeScreenInsets();
  const frame = useRef<React.ComponentRef<typeof View>>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false), [windowTop, setWindowTop] = useState(0);
  const [androidFrame,setAndroidFrame] = useState({ y: 0,height: 0 });
  const [androidKeyboardTop,setAndroidKeyboardTop] = useState<number | null>(() => Platform.OS === 'android' && footer ? Keyboard.metrics()?.screenY ?? null : null);
  const mounted = useRef(true);
  const measureAndroidFrame = useCallback(() => {
    frame.current?.measureInWindow((_x,y,_width,height) => {
      if (mounted.current) setAndroidFrame(previous => previous.y === y && previous.height === height ? previous : { y,height });
    });
  },[]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; },[]);
  useEffect(() => {
    if (!footer || Platform.OS === 'web') return;
    let measureFrame: number | undefined;
    if (Platform.OS === 'android') {
      setAndroidKeyboardTop(Keyboard.metrics()?.screenY ?? null);
      measureFrame = requestAnimationFrame(measureAndroidFrame);
    }
    const shown = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', event => {
      setKeyboardVisible(true);
      if (Platform.OS === 'android') {
        setAndroidKeyboardTop(event.endCoordinates.height > 0 ? event.endCoordinates.screenY : null);
        // Native Android tabs can retain their full Yoga height under the IME.
        // Measure after any adjustResize layout so only residual occlusion is
        // reserved, rather than adding a second keyboard-height inset.
        if (measureFrame !== undefined) cancelAnimationFrame(measureFrame);
        measureFrame = requestAnimationFrame(measureAndroidFrame);
      }
    });
    const hidden = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      setKeyboardVisible(false);
      if (Platform.OS === 'android') setAndroidKeyboardTop(null);
    });
    return () => { shown.remove(); hidden.remove(); if (measureFrame !== undefined) cancelAnimationFrame(measureFrame); };
  }, [!!footer,measureAndroidFrame]);
  const androidOverlap = footer && Platform.OS === 'android' ? campusKeyboardOverlap(androidFrame,androidKeyboardTop) : 0;
  return <View ref={frame} pointerEvents={passThrough ? 'box-none' : 'auto'} collapsable={false} onLayout={() => {
    if (!footer) return;
    if (Platform.OS === 'ios') frame.current?.measureInWindow((_x, y) => setWindowTop(y));
    else if (Platform.OS === 'android') measureAndroidFrame();
  }} style={{ flex: 1, minHeight: 0, ...(Platform.OS === 'android' && footer ? { paddingBottom: androidOverlap } : {}) }}><KeyboardAvoidingView pointerEvents={passThrough ? 'box-none' : 'auto'} enabled={!!footer && Platform.OS === 'ios'} behavior="padding" keyboardVerticalOffset={windowTop} style={{ flex: 1, minHeight: 0 }}>
    {children}
    {footer ? <View pointerEvents={passThrough ? 'box-none' : 'auto'} collapsable={false} style={{ display: keyboardVisible && footerKeyboardBehavior === 'hide' ? 'none' : 'flex', backgroundColor: footerBackgroundColor ?? colors.canvas, borderTopColor: colors.border, borderTopWidth: footerSeparator ? StyleSheet.hairlineWidth : 0, paddingHorizontal: footerPadding, paddingTop: 12, paddingBottom: 12 + (keyboardVisible ? 0 : bottom) }}><View pointerEvents={passThrough ? 'box-none' : 'auto'} style={{ width: '100%', maxWidth, alignSelf: 'center' }}>{footer}</View></View> : null}
  </KeyboardAvoidingView></View>;
}
export function Section({ title, action, children }: React.PropsWithChildren<{ title: string; action?: { title: string; onPress: () => void } }>) {
  const { colors } = useTheme();
  return <View style={styles.section}><View style={styles.sectionHeader}><Text accessibilityRole="header" aria-level={2} style={[styles.sectionTitle, styles.sectionHeading, { color: colors.ink }]}>{title}</Text>{action ? <LinkButton title={action.title} onPress={action.onPress} /> : null}</View><View style={{ gap: 10 }}>{children}</View></View>;
}
export function LinkButton({ title, onPress, disabled, expanded }: { title: string; onPress: () => void; disabled?: boolean; expanded?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.link, { opacity: disabled ? 0.45 : pressed ? 0.65 : 1 }]}><Text style={[styles.linkTitle, { color: colors.link }]}>{title}</Text><View style={expanded === undefined ? undefined : { transform: [{ rotate: expanded ? '-90deg' : '90deg' }] }}><Icon name="chevron" size={16} /></View></Pressable>;
}
export function ListGroup({ children, inset = false }: React.PropsWithChildren<{ inset?: boolean }>) {
  const { colors } = useTheme();
  return <View style={[styles.listGroup, { backgroundColor: colors.row, borderColor: colors.border, paddingHorizontal: inset ? 16 : 0 }]}>{children}</View>;
}
export function Row({ title, detail, status, statusTone = 'link', icon, iconDestination, onPress, children, variant = 'filled', separator = false }: React.PropsWithChildren<{ title: string; detail?: string | null; status?: string | null; statusTone?: 'link' | 'muted' | 'positive' | 'warning' | 'danger'; icon?: string; iconDestination?: string; onPress?: () => void; variant?: 'filled' | 'plain'; separator?: boolean }>) {
  const { colors } = useTheme();
  const plain = variant === 'plain';
  const contents = <>{icon ? <View style={styles.rowIcon}><Icon name={icon} size={28} destination={iconDestination} /></View> : null}<View style={styles.rowContent}><Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>{detail ? <Text style={[styles.detail, { color: colors.muted }]}>{detail}</Text> : null}{status ? <Text style={[styles.status, { color: colors[statusTone] }]}>{status}</Text> : null}{children}</View>{onPress ? <Icon name="chevron" size={18} muted /> : null}</>;
  const rowStyle = [styles.row, plain && styles.plainRow, { backgroundColor: plain ? 'transparent' : colors.row, borderColor: colors.border, borderTopWidth: separator ? StyleSheet.hairlineWidth : 0 }];
  return onPress ? <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [...rowStyle, { opacity: pressed ? 0.7 : 1 }]}>{contents}</Pressable> : <View style={rowStyle}>{contents}</View>;
}
export function Button({ title, onPress, kind = 'primary', busy, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; busy?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  const foreground = kind === 'secondary' ? colors.ink : kind === 'danger' ? colors.danger : colors.onAction;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: kind === 'secondary' ? colors.row : kind === 'danger' ? colors.dangerSoft : colors.action, opacity: disabled || busy ? 0.5 : pressed ? 0.75 : 1 }]}>{busy ? <BrandLoadingIcon onFilledAction={kind === 'primary'} /> : null}<Text style={[styles.buttonTitle, { color: foreground }]}>{title}</Text></Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const { colors } = useTheme();
  return <View style={{ gap: 8, marginVertical: 8 }}><Text style={[styles.fieldLabel, { color: colors.ink }]}>{label}</Text><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} autoCorrect={false} autoCapitalize="none" {...props} style={[styles.input, { color: colors.ink, backgroundColor: colors.row, borderColor: colors.border }, props.multiline && { minHeight: 100, textAlignVertical: 'top' }, props.style]} /></View>;
}
export function SearchField({ label, value, onChangeText, placeholder, onSubmit, onClear, submitLabel, clearLabel, submitDisabled, busy, disabled, outlined, pill, variant }: { label: string; value: string; onChangeText: (value: string) => void; placeholder: string; onSubmit?: () => void; onClear?: () => void; submitLabel?: string; clearLabel?: string; submitDisabled?: boolean; busy?: boolean; disabled?: boolean; outlined?: boolean; pill?: boolean; variant?: 'pill' | 'outlined' }) {
  const { colors } = useTheme();
  const canSubmit = !disabled && !busy && !submitDisabled;
  const submit = () => { if (canSubmit) onSubmit?.(); };
  return <View style={[styles.search, { backgroundColor: outlined || variant === 'outlined' ? colors.surface : pill || variant === 'pill' ? colors.surfaceSoft : colors.row, borderColor: colors.border, borderRadius: pill || variant === 'pill' ? 28 : themeRadii.radiusControl, opacity: disabled ? .55 : 1 }]}><Icon name="search" size={20} muted /><TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted} autoCorrect={false} autoCapitalize="none" returnKeyType="search" editable={!disabled} onSubmitEditing={submit} style={[styles.searchInput, { color: colors.ink }]} />{value ? <Pressable accessibilityRole="button" accessibilityLabel={clearLabel ?? `Clear ${label.toLowerCase()}`} disabled={disabled || busy} onPress={() => { onChangeText(''); onClear?.(); }} style={styles.searchClear}><Icon name="close" size={18} muted /></Pressable> : null}{onSubmit ? <Pressable accessibilityRole="button" accessibilityLabel={submitLabel ?? `Submit ${label.toLowerCase()}`} accessibilityState={{ disabled: !canSubmit, busy }} disabled={!canSubmit} onPress={submit} style={styles.searchClear}>{busy ? <BrandLoadingIcon size={18} /> : <Icon name="arrow" size={20} />}</Pressable> : null}</View>;
}
export function Empty({ title, message, onRetry }: { title: string; message?: string; onRetry?: () => void }) {
  const { colors } = useTheme();
  return <View accessibilityRole="summary" style={styles.empty}><Text style={[styles.sectionTitle, { color: colors.ink }]}>{title}</Text>{message ? <Text style={[styles.subtitle, { color: colors.muted }]}>{message}</Text> : null}{onRetry ? <Button title="Try again" onPress={onRetry} kind="secondary" /> : null}</View>;
}
export function Loading({ label = 'Loading campus data…' }: { label?: string }) { const { colors } = useTheme(); return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityLiveRegion="polite" accessibilityState={{ busy: true }} style={[styles.empty, { alignItems: 'center' }]}><BrandLoadingIcon size={48} /><Text style={[styles.detail, { color: colors.muted }]}>{label}</Text></View>; }
export function Notice({ message, tone = 'info' }: { message: string; tone?: 'info' | 'warning' | 'danger' | 'success' }) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : tone === 'warning' ? colors.warning : tone === 'success' ? colors.positive : colors.ink;
  const background = tone === 'danger' ? colors.dangerSoft : tone === 'warning' ? colors.warningSoft : tone === 'success' ? colors.positiveSoft : colors.row;
  return <View accessibilityRole={tone === 'danger' ? 'alert' : 'text'} style={[styles.notice, { backgroundColor: background }]}><Text style={[styles.detail, { color }]}>{message}</Text></View>;
}
const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 40, flexGrow: 1 }, content: { width: '100%', alignSelf: 'center', gap: 12 },
  title: { fontSize: 32, lineHeight: 39, fontWeight: '700', letterSpacing: -0.8, marginTop: 8 }, subtitle: { fontSize: 14, lineHeight: 21 },
  section: { marginTop: 20, gap: 10 }, sectionHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 0 }, sectionHeading: { flexGrow: 1, flexShrink: 1 }, sectionTitle: { fontSize: 20, lineHeight: 27, fontWeight: '600', letterSpacing: -0.3 },
  link: { minHeight: 44, maxWidth: '100%', alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 2 }, linkTitle: { flexShrink: 1, fontSize: 14, lineHeight: 21, fontWeight: '600' },
  listGroup: { borderRadius: themeRadii.radiusCard, borderWidth: 1, overflow: 'hidden' },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderRadius: themeRadii.radiusRow }, plainRow: { minHeight: 72, paddingHorizontal: 0, paddingVertical: 16, borderRadius: 0 }, rowIcon: { width: 36, minHeight: 36, alignItems: 'center', justifyContent: 'center' }, rowContent: { flex: 1, minWidth: 0, gap: 4 }, rowTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600' }, detail: { fontSize: 14, lineHeight: 21 }, status: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  button: { minHeight: 48, paddingVertical: 12, paddingHorizontal: 18, borderRadius: themeRadii.radiusControl, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginVertical: 4 }, buttonTitle: { flexShrink: 1, fontSize: 16, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  fieldLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600' }, input: { minHeight: 52, borderWidth: 1, borderRadius: themeRadii.radiusControl, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16 },
  search: { minHeight: 50, borderWidth: 1, borderRadius: themeRadii.radiusControl, flexDirection: 'row', alignItems: 'center', paddingLeft: 14, paddingRight: 4, gap: 8 }, searchInput: { flex: 1, minWidth: 0, minHeight: 48, paddingVertical: 12, paddingRight: 8, fontSize: 16 }, searchClear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 32, gap: 14 }, notice: { padding: 16, borderRadius: themeRadii.radiusControl, marginVertical: 8 },
});
