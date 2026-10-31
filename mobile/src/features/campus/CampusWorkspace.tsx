import React, { useContext, useEffect, useRef, useState } from 'react';
import { Keyboard, Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MotionModal as Modal } from '../../ui/Motion';
import { HeaderShownContext } from 'expo-router/react-navigation';
import { useIsFocused } from 'expo-router';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { MagnifyingGlassIcon } from 'phosphor-react-native/src/icons/MagnifyingGlass';
import { SlidersHorizontalIcon } from 'phosphor-react-native/src/icons/SlidersHorizontal';
import { ArrowsOutIcon } from 'phosphor-react-native/src/icons/ArrowsOut';
import { ArrowsInIcon } from 'phosphor-react-native/src/icons/ArrowsIn';
import { PlusIcon } from 'phosphor-react-native/src/icons/Plus';
import { MinusIcon } from 'phosphor-react-native/src/icons/Minus';
import { CrosshairSimpleIcon } from 'phosphor-react-native/src/icons/CrosshairSimple';
import { CaretUpIcon } from 'phosphor-react-native/src/icons/CaretUp';
import { CaretDownIcon } from 'phosphor-react-native/src/icons/CaretDown';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { NativePageSafeArea } from '../../ui/components';
import { ExecutionBanner } from '../../ui/ExecutionBanner';
import { useTheme } from '../../ui/theme';
import { NativeScreenInsetsProvider, useNativeScreenInsets } from '../../ui/native-screen-insets';
import { campusKeyboardOverlap,campusPanelHeight } from '../../lib/campus-workspace-layout';
import { usePageNavigationTitle } from '../../ui/BackNavigation';

export type CampusPanel = 'search' | 'layers' | 'place' | 'directions' | 'day' | 'operations' | 'information';
type Glyph = React.ComponentType<{ size?: number; color?: string }>;
export function CampusControl({ title, label, icon: Icon, onPress, active, disabled }: { title?: string; label: string; icon?: Glyph; onPress: () => void; active?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.control, title ? styles.textControl : styles.square, { backgroundColor: active ? colors.row : colors.surface, opacity: disabled ? .45 : pressed ? .65 : 1 }]}>{Icon ? <Icon size={20} color={active ? colors.link : colors.ink} /> : null}{title ? <Text style={[styles.controlText, { color: active ? colors.link : colors.ink }]}>{title}</Text> : null}</Pressable>;
}
export function CampusFrame({ campusName, onChooseCampus, children }: React.PropsWithChildren<{ campusName?: string; onChooseCampus?: () => void }>) {
  usePageNavigationTitle('Virtual campus');
  const { colors } = useTheme();
  const headerShown = useContext(HeaderShownContext);
  return <NativePageSafeArea headerShown={!!headerShown} backgroundColor={colors.canvas}><ExecutionBanner /><View style={styles.pageHeading}><Text accessibilityRole="header" style={[styles.pageTitle, { color: colors.ink }]}>Virtual campus</Text><View style={styles.context}><Text numberOfLines={2} style={[styles.subtitle, { color: colors.muted }]}>{campusName ?? 'Your published campus'}</Text>{onChooseCampus ? <CampusControl title="Change" label="Choose campus" icon={CaretDownIcon} onPress={onChooseCampus} /> : null}</View></View><NativeScreenInsetsProvider>{children}</NativeScreenInsetsProvider></NativePageSafeArea>;
}
export function CampusWorkspace({ map, panel, title, panelContent, onPanel, selectionKey, floorControls, onZoomIn, onZoomOut, onFit, canZoomIn, canZoomOut, expanded: controlledExpanded, onExpandedChange }: {
  expanded?: boolean; onExpandedChange?: (expanded: boolean) => void;
  map: (bottomOverlap: number) => React.ReactNode; panel: CampusPanel | null; title: string; panelContent: React.ReactNode; onPanel: (value: CampusPanel | null) => void; selectionKey?: string; floorControls?: React.ReactNode;
  onZoomIn: () => void; onZoomOut: () => void; onFit: () => void; canZoomIn: boolean; canZoomOut: boolean;
}) {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const [localFullscreen, setLocalFullscreen] = useState(false), [expanded, setExpanded] = useState(false), [size, setSize] = useState({ width: 400, height: 600 });
  const fullscreen = controlledExpanded ?? localFullscreen;
  const showFullscreen = fullscreen && focused, interior = !!floorControls;
  const setFullscreen = (value: boolean) => onExpandedChange ? onExpandedChange(value) : setLocalFullscreen(value);
  const host=useRef<React.ElementRef<typeof View>>(null),[hostFrame,setHostFrame]=useState({y:0,height:0}),[keyboardTop,setKeyboardTop]=useState<number|null>(()=>Platform.OS==='web'?null:Keyboard.metrics()?.screenY??null);
  const measureHost=()=>host.current?.measureInWindow((_x,y,_width,height)=>setHostFrame(old=>old.y===y&&old.height===height?old:{y,height}));
  useEffect(()=>{if(Platform.OS==='web')return;const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillChangeFrame':'keyboardDidShow',event=>{Keyboard.scheduleLayoutAnimation(event);setKeyboardTop(event.endCoordinates.screenY<Dimensions.get('screen').height?event.endCoordinates.screenY:null);requestAnimationFrame(measureHost);}),hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',event=>{Keyboard.scheduleLayoutAnimation(event);setKeyboardTop(null);requestAnimationFrame(measureHost);});return()=>{show.remove();hide.remove();};},[]);
  const keyboardVisible=keyboardTop!==null,keyboardOverlap=campusKeyboardOverlap(hostFrame,keyboardTop);
  const scroll = useRef<React.ElementRef<typeof ScrollView>>(null);
  useEffect(() => { setExpanded(false); }, [panel]);
  useEffect(() => { if (interior) setExpanded(false); }, [interior, selectionKey]);
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [panel, title, selectionKey]);
  const open = (next: CampusPanel | null) => { Keyboard.dismiss(); onPanel(next); };
  const wide = size.width >= 900;
  const body = (nativeBottomOverlap: number) => {const bottomOverlap=keyboardVisible?0:nativeBottomOverlap,panelBottomOverlap=Math.min(Math.max(0,size.height),bottomOverlap);return <View ref={host} onLayout={()=>requestAnimationFrame(measureHost)} style={{flex:1,paddingBottom:keyboardOverlap}}><View onLayout={event => setSize(event.nativeEvent.layout)} style={[styles.workspace, { flexDirection: wide ? 'row' : 'column', backgroundColor: colors.canvas }]}>
    <View style={[styles.map,keyboardVisible&&panel&&!wide?{minHeight:0}:null]}>
      {map(panel && !wide ? 0 : bottomOverlap)}
      <View pointerEvents="box-none" style={styles.toolbar}><View style={[styles.controlGroup, { borderColor: colors.border, backgroundColor: colors.surface }]}><CampusControl title="Find a place" label="Find a place" icon={MagnifyingGlassIcon} active={panel === 'search'} onPress={() => open(panel === 'search' ? null : 'search')} /><View style={{ width: StyleSheet.hairlineWidth, backgroundColor: colors.border }} /><CampusControl label="Map tools" icon={SlidersHorizontalIcon} active={panel === 'layers'} onPress={() => open(panel === 'layers' ? null : 'layers')} /></View><View style={[styles.controlGroup, { borderColor: colors.border }]}><CampusControl label={fullscreen ? 'Exit full screen' : 'Full screen map'} icon={fullscreen ? ArrowsInIcon : ArrowsOutIcon} onPress={() => { Keyboard.dismiss(); setFullscreen(!fullscreen); }} /></View></View>
      {floorControls ? <View style={styles.floorControls}>{floorControls}</View> : null}
      <View style={[styles.zoom, styles.controlGroup, { bottom: 12 + (panel && !wide ? 0 : bottomOverlap), backgroundColor: colors.surface, borderColor: colors.border }]}><CampusControl label="Zoom in" icon={PlusIcon} onPress={onZoomIn} disabled={!canZoomIn} /><CampusControl label="Zoom out" icon={MinusIcon} onPress={onZoomOut} disabled={!canZoomOut} /><CampusControl label="Fit map" icon={CrosshairSimpleIcon} onPress={onFit} /></View>
    </View>
    {panel ? <View style={[styles.panel, wide ? { width: 340, borderLeftWidth: StyleSheet.hairlineWidth } : { height: campusPanelHeight(size.height,expanded,keyboardVisible,interior,panelBottomOverlap), borderTopWidth: StyleSheet.hairlineWidth }, { backgroundColor: colors.surface, borderColor: colors.border, paddingBottom: panelBottomOverlap }]}>
      <View style={[styles.panelHeading, { borderBottomColor: colors.border }]}><Text accessibilityRole="header" style={[styles.panelTitle, { color: colors.ink }]}>{title}</Text>{!wide ? <CampusControl label={expanded ? 'Collapse map details' : 'Expand map details'} icon={expanded ? CaretDownIcon : CaretUpIcon} onPress={() => { Keyboard.dismiss(); setExpanded(!expanded); }} /> : null}<CampusControl label="Close map panel" icon={XIcon} onPress={() => open(panel === 'directions' ? 'place' : null)} /></View>
      <ScrollView ref={scroll} style={{ flex: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" automaticallyAdjustKeyboardInsets={false} automaticallyAdjustContentInsets={false} automaticallyAdjustsScrollIndicatorInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={styles.panelContent}>{panelContent}</ScrollView>
    </View> : null}
  </View></View>;};
  return <>{!fullscreen ? <CampusInsetContent>{body}</CampusInsetContent> : null}<Modal visible={showFullscreen} animationType="fade" presentationStyle="fullScreen" onRequestClose={() => setFullscreen(false)}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }} edges={['top', 'bottom', 'left', 'right']}><ExecutionBanner /><View style={{ paddingHorizontal: 16, paddingVertical: 8 }}><Text accessibilityRole="header" style={{ color: colors.ink, fontSize: 18, fontWeight: '600' }}>Virtual campus</Text></View>{showFullscreen ? <NativeScreenInsetsProvider disabled><CampusInsetContent>{body}</CampusInsetContent></NativeScreenInsetsProvider> : null}</SafeAreaView></SafeAreaProvider></Modal></>;
}
function CampusInsetContent({ children }: { children: (bottom: number) => React.ReactNode }) {
  const { bottom } = useNativeScreenInsets();
  return children(bottom);
}
export function CampusChoices({ visible, title, options, selected, onSelect, onClose }: { visible: boolean; title: string; options: { id: string; name: string }[]; selected?: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  const { colors } = useTheme();
  return <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}><SafeAreaProvider><SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.surface }}><View style={[styles.panelHeading, { borderBottomColor: colors.border }]}><Text accessibilityRole="header" style={[styles.panelTitle, { color: colors.ink }]}>{title}</Text><CampusControl label="Close choices" icon={XIcon} onPress={onClose} /></View><ScrollView contentContainerStyle={{ padding: 16 }}>{options.map(option => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: option.id === selected }} onPress={() => { onSelect(option.id); onClose(); }} style={({ pressed }) => ({ minHeight: 52, padding: 16, borderRadius: 12, backgroundColor: option.id === selected ? colors.row : colors.surface, opacity: pressed ? .6 : 1 })}><Text style={{ color: option.id === selected ? colors.link : colors.ink, fontSize: 16, lineHeight: 23 }}>{option.name}</Text></Pressable>)}</ScrollView></SafeAreaView></SafeAreaProvider></Modal>;
}
const styles = StyleSheet.create({
  pageHeading: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 4 }, pageTitle: { fontSize: 32, lineHeight: 39, fontWeight: '700', letterSpacing: -.8 }, context: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, subtitle: { flex: 1, fontSize: 14, lineHeight: 21 },
  workspace: { flex: 1, overflow: 'hidden' }, map: { flex: 1, minHeight: 100, overflow: 'hidden' }, toolbar: { position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }, controlGroup: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, overflow: 'hidden', boxShadow: '0px 2px 8px rgba(0,0,0,0.08)' }, control: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, textControl: { paddingHorizontal: 12, flexShrink: 1 }, square: { width: 44 }, controlText: { fontSize: 14, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  zoom: { position: 'absolute', bottom: 12, right: 12, flexDirection: 'column' }, floorControls: { position: 'absolute', top: 66, left: 12, right: 12 }, panel: { minHeight: 0 }, panelHeading: { minHeight: 56, paddingLeft: 16, paddingRight: 6, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4, borderBottomWidth: StyleSheet.hairlineWidth }, panelTitle: { flex: 1, fontSize: 18, lineHeight: 24, fontWeight: '600', letterSpacing: -.3 }, panelContent: { padding: 16, gap: 12, paddingBottom: 24 },
});
