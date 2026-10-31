// The core encoder is pure JavaScript. The package entry also pulls in Node
// file/stream or browser canvas renderers, which do not belong in this app.
import { create } from 'qrcode/lib/core/qrcode';

export function authenticatorQr(uri: string) {
  const parsed = new URL(uri);
  if (uri.length > 4096 || parsed.protocol !== 'otpauth:' || parsed.hostname !== 'totp'
    || !parsed.pathname || !/^[A-Z2-7]+=*$/i.test(parsed.searchParams.get('secret') ?? ''))
    throw new Error('The authenticator setup link is invalid. Request a new setup key.');
  const { modules } = create(uri, { errorCorrectionLevel: 'M' });
  const margin = 4;
  const paths: string[] = [];
  for (let row = 0; row < modules.size; row++) for (let column = 0; column < modules.size; column++) {
    if (modules.data[row * modules.size + column]) paths.push(`M${column + margin},${row + margin}h1v1h-1z`);
  }
  return { size: modules.size + margin * 2, path: paths.join('') };
}
