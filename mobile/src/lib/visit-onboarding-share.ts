import { Linking, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { visitOnboardingShareUrl } from './gate-visit-onboarding';
import { visitLinkEmailHref, type VisitLinkShareOutcome } from './visit-onboarding-share-core';

/** The system chooser determines available apps; opening it is not a delivery receipt. */
export async function shareVisitOnboardingLink(url: string, assertCurrent: () => void): Promise<VisitLinkShareOutcome> {
  const message = visitOnboardingShareUrl(url); assertCurrent();
  const result = await Share.share({ message, title: 'Register for a campus visit' });
  assertCurrent(); return result.action === Share.dismissedAction ? 'dismissed' : 'opened';
}
export async function emailVisitOnboardingLink(url: string, assertCurrent: () => void) {
  const draft = visitLinkEmailHref(url); assertCurrent(); await Linking.openURL(draft); assertCurrent();
}
export async function copyVisitOnboardingLink(url: string, assertCurrent: () => void) {
  const value = visitOnboardingShareUrl(url); assertCurrent();
  const copied = await Clipboard.setStringAsync(value, { inputFormat: Clipboard.StringFormat.PLAIN_TEXT, android: { isSensitive: true } });
  assertCurrent(); if (!copied) throw new Error('Copy is unavailable. Use Share or open an email draft instead.');
}
