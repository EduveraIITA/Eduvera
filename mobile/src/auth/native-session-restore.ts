import { normalizeApiOrigin } from '../lib/api-policy';

export interface StoredNativeSession { token: string; origin: string; expiresAt: string }

/** A device credential belongs only to the server that issued it. Production
 * storage cannot override the origin configured in the installed binary. */
export function storedNativeSession(raw: string, configuredOrigin: string, development: boolean, now: number): StoredNativeSession | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const saved = value as Record<string, unknown>;
    if (typeof saved.token !== 'string' || !saved.token || typeof saved.origin !== 'string' || typeof saved.expiresAt !== 'string'
      || !Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) <= now) return null;
    const origin = normalizeApiOrigin(saved.origin, development);
    if (!development && origin !== normalizeApiOrigin(configuredOrigin)) return null;
    return { token: saved.token, origin, expiresAt: saved.expiresAt };
  } catch { return null; }
}
