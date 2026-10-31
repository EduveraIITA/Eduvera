import React, { useEffect, useState } from 'react';
import { StyleSheet, View, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from './theme';

interface BrowserMaterial { filter: 'standard' | 'webkit' | null; reduce: boolean }
type BrowserStyle = ViewStyle & { backdropFilter: string; WebkitBackdropFilter: string };
const solid: BrowserMaterial = { filter: null, reduce: true };
const opaque = (value: unknown): value is string => typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{6}ff)$/i.test(value);
function translucent(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex)) return hex;
  const rgb = [1,3,5].map(index => Number.parseInt(hex.slice(index,index+2),16));
  // Preserve readable theme contrast even against a busy/dark backdrop.
  return `rgba(${rgb.join(', ')}, 0.96)`;
}

/** Browser material uses CSS backdrop filtering. UIKit Liquid Glass remains
 * native-only; unsupported/accessibility environments keep an opaque surface. */
export function Glass({ children, style, ...props }: React.PropsWithChildren<ViewProps>) {
  const { colors } = useTheme(), [material, setMaterial] = useState<BrowserMaterial>(solid);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.CSS?.supports || !window.matchMedia) return;
    const cleanups: Array<() => void> = []; let active = true;
    try {
      const filter = window.CSS.supports('backdrop-filter','blur(16px)') ? 'standard' : window.CSS.supports('-webkit-backdrop-filter','blur(16px)') ? 'webkit' : null;
      const reduced = window.matchMedia('(prefers-reduced-transparency: reduce)'), ordinary = window.matchMedia('(prefers-reduced-transparency: no-preference)'), forced = window.matchMedia('(forced-colors: active)');
      const update = () => { if (active) setMaterial({ filter, reduce: reduced.matches || forced.matches || !reduced.matches && !ordinary.matches }); };
      update();
      for (const query of [reduced,ordinary,forced]) {
        if (typeof query.addEventListener === 'function' && typeof query.removeEventListener === 'function') { query.addEventListener('change',update); cleanups.push(() => query.removeEventListener('change',update)); }
        else if (typeof query.addListener === 'function' && typeof query.removeListener === 'function') { query.addListener(update); cleanups.push(() => query.removeListener(update)); }
        else throw new Error('Transparency preferences cannot be observed.');
      }
    } catch { active = false; cleanups.forEach(cleanup => cleanup()); cleanups.length = 0; setMaterial(solid); }
    return () => { active = false; cleanups.forEach(cleanup => cleanup()); };
  }, []);
  const caller = StyleSheet.flatten(style), enabled = !!material.filter && !material.reduce;
  const surface: BrowserStyle = {
    backgroundColor: opaque(caller?.backgroundColor) ? caller.backgroundColor : enabled ? translucent(colors.row) : colors.row,
    backdropFilter: enabled && material.filter === 'standard' ? 'blur(16px)' : 'none',
    WebkitBackdropFilter: enabled && material.filter === 'webkit' ? 'blur(16px)' : 'none',
  };
  // One stable View preserves focused controls and composer identity as a
  // preference changes; only the material changes, never the child owner.
  return <View {...props} style={[{ borderColor: colors.border, borderWidth: 1 }, style, surface]}>{children}</View>;
}
