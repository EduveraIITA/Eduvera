import { createElement, useEffect, useRef, useState, type ComponentRef, type PropsWithChildren, type ReactNode } from 'react';
import { ActionSheetIOS, findNodeHandle, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { InfoIcon } from 'phosphor-react-native/src/icons/Info';
import { CheckIcon } from 'phosphor-react-native/src/icons/Check';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { useTheme } from './theme';
import { Icon } from './Icon';
import { BrandLoadingIcon } from './AssistantMark';
import { SearchField } from './components';
import { DisclosureBody } from './DisclosureBody';
import { MotionModal, useDisclosureMotion } from './Motion';

/** Compact controls keep the same 44-point touch area as the native chrome. */
export function ControlButton({ title, onPress, kind = 'secondary', disabled, busy }: { title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'danger'; disabled?: boolean; busy?: boolean }) {
  const { colors } = useTheme();
  const foreground = kind === 'primary' ? colors.onAction : kind === 'danger' ? colors.danger : colors.link;
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.control, { backgroundColor: kind === 'primary' ? colors.action : kind === 'danger' ? colors.dangerSoft : 'transparent', opacity: disabled || busy ? .45 : pressed ? .65 : 1 }]}>{busy ? <BrandLoadingIcon size={18} onFilledAction={kind === 'primary'} /> : null}<Text style={[styles.controlText, { color: foreground }]}>{title}</Text></Pressable>;
}

export interface ControlOption { value: string; label: string; count?: number }
export function SegmentedControl({ label, value, options, onChange, disabled }: { label: string; value: string; options: readonly ControlOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return <View accessibilityLabel={label} style={[styles.segments, { backgroundColor: colors.row }]}>{options.map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityLabel={option.label} accessibilityState={{ selected: option.value === value, disabled }} disabled={disabled} onPress={() => onChange(option.value)} style={({ pressed }) => [styles.segment, { backgroundColor: value === option.value ? colors.surface : 'transparent', opacity: disabled ? .45 : pressed ? .65 : 1 }]}><Text style={[styles.controlText, { color: value === option.value ? colors.link : colors.muted, textAlign: 'center' }]}>{option.label}</Text>{option.count !== undefined ? <Text style={[styles.count, { backgroundColor: colors.surfaceSoft, color: colors.muted }]}>{option.count}</Text> : null}</Pressable>)}</View>;
}

/** Short iOS choices use UIKit's sheet/popover. Long choices stay searchable. */
export function ChoiceMenu({ label, value, options, onChange, disabled }: { label: string; value: string; options: readonly ControlOption[]; onChange: (value: string) => void; disabled?: boolean }) {
  const { colors, dark } = useTheme();
  const [open, setOpen] = useState(false), [search, setSearch] = useState(''), [page, setPage] = useState(1);
  const anchor = useRef<ComponentRef<typeof View>>(null), mounted = useRef(true), currentOptions = useRef(options), currentChoice = useRef({ disabled, onChange });
  currentOptions.current = options; currentChoice.current = { disabled, onChange };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const selected = options.find(option => option.value === value);
  const choose = (next: string) => { if (mounted.current && !currentChoice.current.disabled && currentOptions.current.some(option => option.value === next)) { setOpen(false); currentChoice.current.onChange(next); } };
  const show = () => {
    setSearch(''); setPage(1);
    if (Platform.OS === 'ios' && options.length <= 8) {
      const node = findNodeHandle(anchor.current);
      ActionSheetIOS.showActionSheetWithOptions({ title: label, options: [...options.map(option => (option.value === value ? '✓ ' : '') + option.label), 'Cancel'], cancelButtonIndex: options.length, tintColor: colors.link, userInterfaceStyle: dark ? 'dark' : 'light', ...(node ? { anchor: node } : {}) }, index => { const option = options[index]; if (option) choose(option.value); });
    } else setOpen(true);
  };
  if (Platform.OS === 'web') return createElement('select', { 'aria-label': label, title: label, disabled, value: selected?.value ?? '', onChange: (event: { target: { value: string } }) => choose(event.target.value), style: { maxWidth: '100%', minWidth: 72, minHeight: 44, padding: '8px 12px', border: `1px solid ${colors.border}`, borderRadius: 16, backgroundColor: colors.row, color: colors.ink, fontSize: 16, fontFamily: 'inherit', colorScheme: dark ? 'dark' : 'light' } }, [!selected ? createElement('option', { key: 'placeholder', value: '', disabled: true }, label) : null, ...options.map(option => createElement('option', { key: option.value, value: option.value }, option.label + (option.count === undefined ? '' : ` · ${option.count}`)))]);
  const filtered = options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return <>
    <Pressable ref={anchor} accessibilityRole="button" accessibilityLabel={label + ': ' + (selected?.label ?? 'Choose')} accessibilityState={{ disabled, expanded: open }} disabled={disabled} onPress={show} style={({ pressed }) => [styles.control, styles.menu, { backgroundColor: colors.row, opacity: disabled ? .45 : pressed ? .65 : 1 }]}><Text style={[styles.controlText, { color: colors.ink }]}>{selected?.label ?? label}</Text><CaretDownIcon color={colors.muted} size={16} /></Pressable>
    <MotionModal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}><View style={styles.sheetHeader}><Text accessibilityRole="header" aria-level={2} style={[styles.sheetTitle, { color: colors.ink }]}>{label}</Text><ControlButton title="Done" onPress={() => setOpen(false)} /></View><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={styles.sheetContent}>
      {options.length > 8 ? <SearchField label={'Search ' + label.toLowerCase()} placeholder="Find an option" value={search} onChangeText={text => { setSearch(text); setPage(1); }} /> : null}
      {filtered.slice((page - 1) * 12, page * 12).map(option => <Pressable key={option.value} accessibilityRole="button" accessibilityState={{ selected: value === option.value }} onPress={() => choose(option.value)} style={[styles.option, { backgroundColor: colors.row }]}><Text style={[styles.optionText, { color: colors.ink }]}>{option.label}</Text>{value === option.value ? <CheckIcon size={20} color={colors.link} /> : null}</Pressable>)}
      {!filtered.length ? <Text style={{ color: colors.muted }}>No matching options.</Text> : null}
      {page > 1 || page * 12 < filtered.length ? <View style={styles.pagination}><ControlButton title="Previous" disabled={page === 1} onPress={() => setPage(page - 1)} /><Text style={{ color: colors.muted }}>Page {page}</Text><ControlButton title="Next" disabled={page * 12 >= filtered.length} onPress={() => setPage(page + 1)} /></View> : null}
    </ScrollView></SafeAreaView></SafeAreaProvider></MotionModal>
  </>;
}

export function InfoDisclosure({ title, children }: PropsWithChildren<{ title: string }>) { return <Disclosure title={title} informative>{children}</Disclosure>; }
export function Disclosure({ title, children, defaultOpen = false, informative = false }: PropsWithChildren<{ title: string; defaultOpen?: boolean; informative?: boolean }>) {
  const { colors } = useTheme(), [open, setOpen] = useState(defaultOpen), animate = useDisclosureMotion();
  return <View style={{ gap: open ? 8 : 0 }}><Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { animate(); setOpen(!open); }} style={styles.disclosure}><Text style={[styles.controlText, { color: colors.muted, flexShrink: 1 }]}>{title}</Text>{informative ? <InfoIcon size={18} color={colors.muted} /> : <View style={{ transform: [{ rotate: open ? '-90deg' : '90deg' }] }}><Icon name="chevron" size={16} muted /></View>}</Pressable><DisclosureBody open={open}>{children}</DisclosureBody></View>;
}

export function Facts({ items }: { items: readonly { label: string; value: ReactNode }[] }) {
  const { colors } = useTheme();
  return <View style={[styles.facts, { backgroundColor: colors.row }]}>{items.map((item, index) => <View key={item.label + ':' + index} style={[styles.fact, { borderTopWidth: index ? StyleSheet.hairlineWidth : 0, borderColor: colors.border }]}><Text style={[styles.factLabel, { color: colors.muted }]}>{item.label}</Text>{typeof item.value === 'string' || typeof item.value === 'number' ? <Text style={[styles.factValue, { color: colors.ink }]}>{item.value}</Text> : <View style={{ flex: 1 }}>{item.value}</View>}</View>)}</View>;
}

const styles = StyleSheet.create({
  control: { minHeight: 44, minWidth: 44, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 6, borderRadius: 16 },
  controlText: { fontSize: 14, lineHeight: 20, fontWeight: '600', flexShrink: 1 }, menu: { alignSelf: 'flex-start' },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 4, borderRadius: 16 }, segment: { flexDirection: 'row', flexGrow: 1, flexBasis: 0, minWidth: 72, minHeight: 44, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 6, borderRadius: 12 }, count: { minWidth: 24, textAlign: 'center', fontSize: 12, lineHeight: 18, borderRadius: 12, paddingHorizontal: 6 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingVertical: 12 }, sheetTitle: { flex: 1, fontSize: 20, lineHeight: 26, fontWeight: '600' }, sheetContent: { padding: 20, paddingBottom: 40, gap: 8 },
  option: { minHeight: 52, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, optionText: { flex: 1, fontSize: 16, lineHeight: 22 }, pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  disclosure: { minHeight: 44, flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 8 }, facts: { borderRadius: 20, paddingHorizontal: 16 }, fact: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, paddingVertical: 12 }, factLabel: { minWidth: 100, flexBasis: '36%', fontSize: 14, lineHeight: 21 }, factValue: { flex: 1, minWidth: 120, fontSize: 15, lineHeight: 22, fontWeight: '500' },
});
