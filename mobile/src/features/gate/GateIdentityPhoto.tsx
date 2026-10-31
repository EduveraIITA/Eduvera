import { useEffect, useState } from 'react';
import { AppState, Image, Text, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import { useSession } from '../../auth/SessionProvider';
import { getApiOrigin, readGateIdentityImage } from '../../lib/api';
import { loadGateIdentityImage, type GateLanguage } from '../../lib/gate-operator-policy';
import { useOperationContext } from '../../lib/use-operation-context';
import { useTheme } from '../../ui/theme';
import { gateOperatorCopy } from './operator-copy';

/** One mounted exact-person reference. No URL, private bytes or cache survives its lease. */
export function GateIdentityPhoto({ reference, source, label, language, enabled }: { reference: unknown; source: string; label: string; language: GateLanguage; enabled: boolean }) {
  const { scopeKey, status, environment } = useSession(), focused = useIsFocused(), { colors } = useTheme(), t = gateOperatorCopy(language);
  const [foreground, setForeground] = useState(AppState.currentState === 'active'), [state, setState] = useState<{ key: string; uri?: string; assertCurrent?: () => void; failed?: boolean }>({ key: '' });
  const key = JSON.stringify([scopeKey, source, reference]), capture = useOperationContext(key), current = enabled && focused && foreground && AppState.currentState === 'active' && status === 'authenticated' && !environment.unavailable;
  useEffect(() => { const subscription = AppState.addEventListener('change', value => setForeground(value === 'active')); return () => subscription.remove(); }, []);
  useEffect(() => {
    let alive = true; const controller = new AbortController(); setState({ key });
    if (current) {
      try {
        const assertCurrent = capture();
        void loadGateIdentityImage({ reference, origin: getApiOrigin(), assertCurrent, signal: controller.signal, read: readGateIdentityImage }).then(uri => { assertCurrent(); if (alive && !controller.signal.aborted) setState({ key, uri, assertCurrent }); }).catch(() => { if (alive && !controller.signal.aborted) setState({ key, failed: true }); });
      } catch { setState({ key, failed: true }); }
    }
    return () => { alive = false; controller.abort(); };
  }, [key, current, capture]);
  let uri: string | undefined, obsolete = false;
  if (current && state.key === key && state.uri) try { state.assertCurrent?.(); uri = state.uri; } catch { obsolete = true; }
  return <View style={{ gap: 8 }}><Text style={{ color: colors.muted, fontSize: 14 }}>{label}</Text>{uri ? <Image source={{ uri }} accessibilityLabel={label} accessible resizeMode="contain" style={{ width: 112, height: 112, borderRadius: 16, backgroundColor: colors.row }} onError={() => setState({ key, failed: true })} /> : <Text style={{ color: colors.muted, fontSize: 14 }}>{!current || obsolete || state.key === key && state.failed || !reference ? t.noPhoto : t.photoLoading}</Text>}</View>;
}
