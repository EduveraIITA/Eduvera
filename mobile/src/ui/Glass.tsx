import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform, View, type ViewProps } from 'react-native';
import { GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useTheme } from './theme';

/** Real UIKit Liquid Glass on supported systems; readable solid controls when
 * Reduce Transparency is enabled or the runtime does not provide glass. */
export function Glass({ children, style, ...props }: React.PropsWithChildren<ViewProps>) {
  const { colors, dark } = useTheme();
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true, changed = false;
    void AccessibilityInfo.isReduceTransparencyEnabled().then(value => { if (active && !changed) setReduce(value); }).catch(() => {});
    const listener = AccessibilityInfo.addEventListener('reduceTransparencyChanged', value => { changed = true; if (active) setReduce(value); });
    return () => { active = false; listener.remove(); };
  }, []);
  const supported = Platform.OS === 'ios' && !reduce && isGlassEffectAPIAvailable() && isLiquidGlassAvailable();
  if (!supported) return <View {...props} style={[{ backgroundColor: colors.row }, style]}>{children}</View>;
  return <GlassView {...props} glassEffectStyle="regular" colorScheme={dark ? 'dark' : 'light'} style={style}>{children}</GlassView>;
}
