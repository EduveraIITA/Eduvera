import { Linking } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { visitOnboardingShareUrl } from './gate-visit-onboarding';
import { shareVisitLinkWithBrowser, visitLinkEmailHref } from './visit-onboarding-share-core';

export function shareVisitOnboardingLink(url: string, assertCurrent: () => void) {
  const browser = globalThis.navigator;
  return shareVisitLinkWithBrowser(url, assertCurrent, { share: browser?.share?.bind(browser), canShare: browser?.canShare?.bind(browser) });
}
export async function emailVisitOnboardingLink(url: string, assertCurrent: () => void) {
  const draft = visitLinkEmailHref(url); assertCurrent(); await Linking.openURL(draft); assertCurrent();
}
export async function copyVisitOnboardingLink(url: string, assertCurrent: () => void) {
  const value = visitOnboardingShareUrl(url); assertCurrent();
  const copied = await Clipboard.setStringAsync(value, { inputFormat: Clipboard.StringFormat.PLAIN_TEXT });
  assertCurrent(); if (!copied) throw new Error('Copy is unavailable. Use Share or open an email draft instead.');
}
