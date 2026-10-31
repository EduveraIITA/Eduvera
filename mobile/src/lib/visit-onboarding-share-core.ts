import { visitOnboardingShareUrl } from './gate-visit-onboarding';

export type VisitLinkShareOutcome = 'opened' | 'dismissed' | 'unavailable';
export function visitLinkEmailHref(url: string) {
  return `mailto:?subject=${encodeURIComponent('Your campus visit')}&body=${encodeURIComponent(`Register for this campus visit using the link below. Registration does not grant entry or confirm attendance.\n\n${visitOnboardingShareUrl(url)}`)}`;
}

/** The user activates an already-revealed link; no network await consumes that gesture. */
export async function shareVisitLinkWithBrowser(url: string, assertCurrent: () => void, browser: { share?: (data: { title: string; url: string }) => Promise<void>; canShare?: (data: { title: string; url: string }) => boolean }): Promise<VisitLinkShareOutcome> {
  const data = { title: 'Register for a campus visit', url: visitOnboardingShareUrl(url) };
  assertCurrent();
  if (!browser.share || browser.canShare && !browser.canShare(data)) return 'unavailable';
  try { await browser.share(data); } catch (cause) { if (cause && typeof cause === 'object' && 'name' in cause && cause.name === 'AbortError') return 'dismissed'; throw new Error('Sharing is unavailable here. Copy the link or open an email draft instead.'); }
  assertCurrent(); return 'opened';
}
