import { useMemo } from 'react';
import { Platform, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { Notice } from '../ui/components';
import { authenticatorQr } from './authenticator-qr';

export function AuthenticatorQr({ uri }: { uri: string }) {
  const result = useMemo(() => { try { return { qr: authenticatorQr(uri) }; } catch { return { error: 'The setup code could not be displayed. Use the setup key below, or request a new setup.' }; } }, [uri]);
  if (!result.qr) return <Notice tone="warning" message={result.error!} />;
  return <View accessible accessibilityRole="image" accessibilityLabel="Authenticator setup QR code. Scan with an authenticator on another device, or use the setup key below." style={{ alignSelf: 'center', backgroundColor: '#fff' }}>
    <Svg width={220} height={220} viewBox={`0 0 ${result.qr.size} ${result.qr.size}`} accessible={Platform.OS === 'web' ? undefined : false} aria-hidden={Platform.OS === 'web' ? true : undefined}><Rect width={result.qr.size} height={result.qr.size} fill="#fff" /><Path d={result.qr.path} fill="#000" /></Svg>
  </View>;
}
