import { googleNativeReturns } from '../src/auth/google-native-flow';
import * as Crypto from 'expo-crypto';
import { getApiOrigin } from '../src/lib/api';
import { visitJoinContinuations } from '../src/auth/visit-join-continuation';
import { visitJoinNativeEntry } from '../src/auth/visit-join-policy';
import { accountMailNativeHref } from '../src/auth/account-mail-link';

/** Scrub visitor fragments before routing; only an in-flight Google return
 * bypasses navigation. Neither locator installs account authentication. */
export function redirectSystemPath({ path,initial }: { path: string; initial: boolean }) {
  const account = accountMailNativeHref(path, getApiOrigin(), Crypto.randomUUID);
  if (account !== undefined) return account;
  // Capture the fragment before native router URL normalization drops it.
  const visit = visitJoinNativeEntry(path);
  if (visit !== undefined) {
    try { return visit ? visitJoinContinuations.retain(visit,getApiOrigin(),Crypto.randomUUID) : '/visit-join'; }
    catch { return '/visit-join'; }
  }
  return googleNativeReturns.redirect(path,initial);
}
