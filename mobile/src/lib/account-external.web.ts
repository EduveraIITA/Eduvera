export const externalLinkLabel = 'Copy private link';
export async function sharePrivateCalendarLink(url: string) { if (!globalThis.navigator?.clipboard?.writeText) throw new Error('Copy is unavailable. Open your calendar app instead.'); await navigator.clipboard.writeText(url); }
