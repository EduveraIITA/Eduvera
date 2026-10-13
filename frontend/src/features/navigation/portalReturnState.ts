const portalNames = new Set(["parent", "student", "teacher", "principal"]);

export const portalReturnStateKey = "portalReturnTo";

function internalPortalHref(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    const portal = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!portalNames.has(portal)) return null;
    return {
      href: `${parsed.pathname}${parsed.search}${parsed.hash}`,
      portal,
    };
  } catch {
    return null;
  }
}

function stateRecord(state: unknown) {
  return state !== null && typeof state === "object" && !Array.isArray(state)
    ? state as Record<string, unknown>
    : {};
}

/**
 * Adds a return destination only when both screens are internal to the same
 * authenticated portal. The destination route remains authoritative; this
 * state solely records where its visible Back control should return.
 */
export function portalReturnState(originHref: string, destinationHref: string, state?: unknown) {
  const origin = internalPortalHref(originHref);
  const destination = internalPortalHref(destinationHref);
  if (!origin || !destination || origin.portal !== destination.portal) return undefined;
  return { ...stateRecord(state), [portalReturnStateKey]: origin.href };
}

/** Reads and revalidates untrusted router state against the current portal. */
export function portalReturnTarget(state: unknown, currentHref: string) {
  const current = internalPortalHref(currentHref);
  const candidate = internalPortalHref(stateRecord(state)[portalReturnStateKey]);
  return current && candidate && current.portal === candidate.portal ? candidate.href : null;
}

export function samePortalHref(left: string | null, right: string | null) {
  const leftValue = internalPortalHref(left);
  const rightValue = internalPortalHref(right);
  if (!leftValue || !rightValue || leftValue.portal !== rightValue.portal) return false;
  const normalized = (href: string) => {
    const parsed = new URL(href, window.location.origin);
    const search = new URLSearchParams([...parsed.searchParams.entries()].sort(([leftKey, leftItem], [rightKey, rightItem]) => leftKey.localeCompare(rightKey) || leftItem.localeCompare(rightItem)));
    return `${parsed.pathname.replace(/\/$/, "") || "/"}${search.size ? `?${search}` : ""}${parsed.hash}`;
  };
  return normalized(leftValue.href) === normalized(rightValue.href);
}
