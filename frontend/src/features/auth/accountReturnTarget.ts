const PORTAL_ROUTE = /^\/(?:principal|teacher|parent|student)(?:\/|$)/;
const AUTHENTICATED_ROUTE = /^\/(?:company|work)(?:\/|$)/;
const RESPONSIBILITY_ROUTE = /^\/(?:today|areas|more)(?:\/|$)/;
const EXACT_AUTHENTICATED_ROUTES = new Set([
  "/gate",
  "/workspace",
  "/onboarding/start",
  "/account/profile",
  "/account/security",
]);

/**
 * Revalidates an untrusted account-screen return URL.
 *
 * Authorization still belongs to the destination route and server. This helper
 * only prevents account screens from losing a known in-app destination or from
 * becoming an open redirect.
 */
export function safeAccountReturnTarget(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return null;
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    const knownRoute = RESPONSIBILITY_ROUTE.test(parsed.pathname)
      || PORTAL_ROUTE.test(parsed.pathname)
      || AUTHENTICATED_ROUTE.test(parsed.pathname)
      || EXACT_AUTHENTICATED_ROUTES.has(parsed.pathname);
    return knownRoute ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch {
    return null;
  }
}
