import { portalReturnTarget, samePortalHref } from "./portalReturnState";

interface PortalHistoryEntry {
  href: string;
}

const visitedEntries = new Map<number, PortalHistoryEntry>();

export function browserHistoryIndex() {
  const state = window.history.state as { idx?: unknown } | null;
  return typeof state?.idx === "number" && Number.isInteger(state.idx) ? state.idx : null;
}

export function rememberPortalLocation(index: number | null, href: string) {
  if (index === null) return;
  visitedEntries.set(index, { href });
}

export function previousPortalLocation(index: number | null) {
  if (index === null || index <= 0) return null;
  return visitedEntries.get(index - 1)?.href ?? null;
}

/**
 * A visible Back control may pop browser history only when this running app has
 * observed the previous entry and it belongs to the same application context.
 * Canonical workspaces and legacy hand-offs use the same validation as explicit
 * return state; unrelated legacy portals are still separate.
 * Unknown/external history falls back to the route's canonical parent instead.
 */
export function canPopPortalHistory(currentHref: string, previousHref: string | null, parentHref: string) {
  if (!previousHref || samePortalHref(previousHref, currentHref)) return false;
  if (!portalReturnTarget({ portalReturnTo: previousHref }, currentHref)) return false;
  const currentPath = new URL(currentHref, window.location.origin).pathname;
  const previousPath = new URL(previousHref, window.location.origin).pathname;
  // Query-only changes are usually filters, dates, or child context. Do not
  // make the app-bar Back walk through them unless the prior entry is the
  // route's exact declared parent (for example a rule index or message list).
  return currentPath !== previousPath || samePortalHref(previousHref, parentHref);
}

export function resetRememberedPortalHistory() {
  visitedEntries.clear();
}
