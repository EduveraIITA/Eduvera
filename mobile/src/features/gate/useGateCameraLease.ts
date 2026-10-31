import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSession } from '../../auth/SessionProvider';
import { useOperationContext } from '../../lib/use-operation-context';

/** A hidden preview owns no camera. Returning to the same view cannot revive
 * permission/capture callbacks prepared before its blur or background event. */
export function useGateCameraLease(source: string) {
  const { scopeKey, status, environment } = useSession(), focused = useIsFocused(), captureOperation = useOperationContext(source);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const key = JSON.stringify([scopeKey, source]), eligible = status === 'authenticated' && !environment.unavailable, active = focused && foreground && AppState.currentState === 'active' && eligible;
  const current = useRef({ key, active, focused, eligible, epoch: 0, mounted: false });
  if (current.current.key !== key || current.current.active !== active) current.current.epoch++;
  Object.assign(current.current, { key, active, focused, eligible });
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; current.current.epoch++; }; }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', value => {
      // Fence callbacks immediately, before React commits the hidden preview.
      current.current.epoch++; current.current.active = value === 'active' && current.current.focused && current.current.eligible;
      setForeground(value === 'active');
    });
    return () => subscription.remove();
  }, []);
  const capture = useCallback(() => {
    const epoch = current.current.epoch;
    const assertLease = () => { if (!current.current.mounted || !current.current.active || current.current.key !== key || current.current.epoch !== epoch || AppState.currentState !== 'active') throw new Error('Return to the current visible camera before taking a new photo.'); };
    assertLease(); const assertOperation = captureOperation();
    return () => { assertLease(); assertOperation(); };
  }, [key, captureOperation]);
  return { active, capture };
}
