/** Presentation is bound to real Expo entry keys, not a second navigation stack. */
export interface AssistantOverlayEntry { key: string; scope: string; sourceHref: string; href: string; nonce: number; open: boolean; expanded: boolean; canonical: boolean }
export interface AssistantOverlayFocus { key: string; scope: string; href: string }
export function assistantOverlayMatches(entry: AssistantOverlayEntry | undefined, focus: AssistantOverlayFocus | undefined) {
  return !!entry && !!focus && entry.key === focus.key && entry.scope === focus.scope && entry.sourceHref === focus.href;
}
export function assistantOverlayToken(entry: AssistantOverlayEntry | undefined, focus: AssistantOverlayFocus | undefined) {
  return assistantOverlayMatches(entry,focus) && entry?.open ? JSON.stringify([entry.scope,entry.key,entry.sourceHref,entry.nonce]) : '';
}
/** Expanded tablet chat owns its retained pane while the REAL app router moves.
 * This is presentation ownership only: no app route/history is copied here. */
export function currentAssistantOverlay(entries: ReadonlyMap<string,AssistantOverlayEntry>, focus: AssistantOverlayFocus | undefined, pinnedKey: string | null, tablet: boolean) {
  if (!focus) return undefined;
  const pinned = pinnedKey ? entries.get(pinnedKey) : undefined;
  if (pinned?.scope === focus.scope && pinned.open && (!pinned.expanded || tablet)) return pinned;
  const entry = entries.get(focus.key);
  return assistantOverlayMatches(entry,focus) ? entry : undefined;
}
export function assertAssistantOverlayLease(expected: string, read: () => { token: string; active: boolean; ready: boolean }) {
  const assert = () => { const current = read(); if (!expected || !current.active || !current.ready || current.token !== expected) throw new Error('Return to the original Assistant conversation before continuing.'); };
  assert(); return assert;
}

export interface AssistantIntentSnapshot { scope: string; key: string; href: string; state: object | undefined; signature: string; entryToken: string }
/** A confirmation belongs to its exact retained owner and overlay opening.
 * Closing and reopening on the same page is still a different intent lease. */
export function captureAssistantIntentLease(read: () => AssistantIntentSnapshot | null) {
  const expected = read(); if (!expected) throw new Error('The Assistant context changed.');
  return () => {
    const next = read();
    if (!next || next.scope !== expected.scope || next.key !== expected.key || next.href !== expected.href || next.state !== expected.state || next.signature !== expected.signature || next.entryToken !== expected.entryToken) throw new Error('The Assistant context changed. Review the link again.');
  };
}
