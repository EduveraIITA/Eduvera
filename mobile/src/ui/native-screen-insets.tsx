import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-screens/experimental';
import { useIsFocused } from 'expo-router';
import { NativeDockMetricsContext } from './campus-tabs-options';

interface NativeScreenInsets {
  /** Native Screen bottom overlap, including its floating navigation bar. */
  bottom: number;
  ready: boolean;
}

const NativeScreenInsetsContext = createContext<NativeScreenInsets>({ bottom: 0, ready: false });

/**
 * Measure the same native Screen inset used by RN Screens' SafeAreaView without
 * removing that space from the canvas. This installed RN Screens version has no
 * JS inset hook. Its SafeAreaView adds native safe-area margins, so the difference
 * between this full-size frame and the bottom-safe probe is the actual overlap.
 *
 * Place the provider inside an edge-extending iOS screen, outside its canvas and
 * overlays. Apply `bottom` to overlay placement or a panel's scrollable footer,
 * not to the map/canvas frame. Disable it in an already-inset full-screen modal.
 * The Android/browser shell allocates its own bottom dock space.
 */
export function NativeScreenInsetsProvider({ children, style, disabled = false }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle>; disabled?: boolean }>) {
  const report = useContext(NativeDockMetricsContext), focused = useIsFocused();
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const [probe, setProbe] = useState({ width: 0, height: 0 });
  const measuring = Platform.OS === 'ios' && !disabled;
  const insets = useMemo<NativeScreenInsets>(() => {
    if (!measuring) return { bottom: 0, ready: true };
    const ready = frame.width > 0 && frame.height > 0 && Math.abs(frame.width - probe.width) < .5 && probe.height > 0;
    return { bottom: ready ? Math.max(0, frame.height - probe.height) : 0, ready };
  }, [measuring, frame, probe]);
  useEffect(() => { if (!disabled && focused && insets.ready && Platform.OS === 'ios') report(insets.bottom); },[disabled,focused,insets.ready,insets.bottom,report]);
  const onFrameLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => setFrame(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height });
  const onProbeLayout = ({ nativeEvent: { layout } }: LayoutChangeEvent) => setProbe(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height });

  return <View style={[styles.frame, style]} onLayout={onFrameLayout}>
    <NativeScreenInsetsContext.Provider value={insets}>{children}</NativeScreenInsetsContext.Provider>
    {measuring ? <SafeAreaView collapsable={false} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" edges={{ bottom: true }} onLayout={onProbeLayout} style={styles.probe} /> : null}
  </View>;
}

export function useNativeScreenInsets(): Readonly<NativeScreenInsets> {
  return useContext(NativeScreenInsetsContext);
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0, minWidth: 0 },
  probe: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flex: 0, opacity: 0 },
});
