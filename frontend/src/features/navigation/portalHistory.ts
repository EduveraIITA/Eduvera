const portalNames = new Set(["parent", "student", "teacher", "principal"]);

interface PortalHistoryEntry {
  href: string;
}

const visitedEntries = new Map<number, PortalHistoryEntry>();

function portalFor(href: string) {
  const pathname = new URL(href, window.location.origin).pathname;
  const portal = pathname.split("/").filter(Boolean)[0] ?? "";
  return portalNames.has(portal) ? portal : null;
}

function normalizedHref(href: string) {
  const value = new URL(href, window.location.origin);
  const search = new URLSearchParams([...value.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue)));
  return `${value.pathname.replace(/\/$/, "") || "/"}${search.size ? `?${search}` : ""}${value.hash}`;
}

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
 * observed the previous entry and it belongs to the same authenticated portal.
 * Unknown/external history falls back to the route's canonical parent instead.
 */
export function canPopPortalHistory(currentHref: string, previousHref: string | null, parentHref: string) {
  if (!previousHref || previousHref === currentHref) return false;
  const currentPortal = portalFor(currentHref);
  if (currentPortal === null || portalFor(previousHref) !== currentPortal) return false;
  const currentPath = new URL(currentHref, window.location.origin).pathname;
  const previousPath = new URL(previousHref, window.location.origin).pathname;
  // Query-only changes are usually filters, dates, or child context. Do not
  // make the app-bar Back walk through them unless the prior entry is the
  // route's exact declared parent (for example a rule index or message list).
  return currentPath !== previousPath || normalizedHref(previousHref) === normalizedHref(parentHref);
}

export function resetRememberedPortalHistory() {
  visitedEntries.clear();
}
