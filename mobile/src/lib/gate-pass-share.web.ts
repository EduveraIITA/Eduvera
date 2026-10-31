import { createBrowserDownloadAdapter } from './browser-private-download';
import { shareGatePassQr } from './gate-pass-share-core';
export function shareGatePass(token: string, kind: string, assertCurrent: () => void) {
  return shareGatePassQr(token, kind, createBrowserDownloadAdapter(), assertCurrent);
}
