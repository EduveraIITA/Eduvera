import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import { createGatePassTemporaryFile, shareGatePassQr } from './gate-pass-share-core';
export function shareGatePass(token: string, kind: string, assertCurrent: () => void) {
  return shareGatePassQr(token, kind, { isAvailable: Sharing.isAvailableAsync, createTemporaryFile(name) {
    return createGatePassTemporaryFile(new File(Paths.cache, `${Crypto.randomUUID()}-${name}`));
  }, share: (uri, options) => Sharing.shareAsync(uri, options) }, assertCurrent);
}
