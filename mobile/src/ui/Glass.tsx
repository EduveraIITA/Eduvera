import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from './theme';

/** Real UIKit Liquid Glass on supported systems; readable solid controls when
 * Reduce Transparency is enabled or the runtime does not provide glass. */
type GlassProps = React.PropsWithChildren<ViewProps & { material?: 'control' | 'assistant' | 'assistantBackdrop' }>;

export function Glass({ children, style, material = 'control', ...props }: GlassProps) {
  const { colors, dark } = useTheme();
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true, changed = false;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active && !changed) setReduce(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceTransparencyChanged', value => { changed = true; if (active) setReduce(value); });
    return () => { active = false; listener.remove(); };
  }, []);
  const assistant = material !== 'control', backdrop = material === 'assistantBackdrop';
  const tint = backdrop ? colors.canvas : colors.surface;
  const supported = Platform.OS === 'ios' && !reduce && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  if (assistant) return <View {...props} style={[{ backgroundColor: supported ? 'transparent' : tint, overflow: 'hidden' }, style]}>
    {supported ? <GlassView pointerEvents="none" accessibilityElementsHidden
      style={StyleSheet.absoluteFill} glassEffectStyle="regular" colorScheme={dark ? 'dark' : 'light'}
      tintColor={tint + (backdrop ? (dark ? 'a8' : 'a0') : 'c9')} /> : null}
    {children}
  </View>;
  if (!supported) return <View {...props} style={[{ backgroundColor: colors.row }, style]}>{children}</View>;
  return <GlassView {...props} glassEffectStyle="regular" colorScheme={dark ? 'dark' : 'light'} style={style}>{children}</GlassView>;
}
