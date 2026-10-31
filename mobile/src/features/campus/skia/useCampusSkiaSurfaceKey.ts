import { useLayoutEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/** Skia's web view registers after layout. A retained Activity can submit its
 * replacement picture while its previous native ID is still unregistered.
 * Reconnect the surface with a fresh ID; camera and recorded scene owners live
 * above this boundary and survive. Ordinary camera/selection updates reuse it. */
export function useCampusSkiaSurfaceKey(projectionKey: string): string {
  const mounted = useRef(false);
  const [reconnect, setReconnect] = useState(0);
  useLayoutEffect(() => {
    if (Platform.OS !== 'web') return;
    if (mounted.current) setReconnect(value => value + 1);
    mounted.current = true;
  }, []);
  return Platform.OS === 'web' ? `${projectionKey}:${reconnect}` : 'native-campus-surface';
}
