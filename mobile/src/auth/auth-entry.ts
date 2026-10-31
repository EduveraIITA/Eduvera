import { authDestination } from '../../../packages/contracts/src/auth-entry';
import { isInternalHref } from '../lib/api-policy';
import { canonicalNativeHref } from '../lib/navigation';
import type { SessionState } from './session-types';
import { safeAccountReturnTarget } from './account-return';
import { visitJoinReturnTarget } from './visit-join-policy';

export function nativeAuthDestination(session: SessionState, next?: string): string {
  const destination = canonicalNativeHref(authDestination({ ...session, executionEnvironment: { mode: session.environment.mode, institutionId: session.environment.institution_id } }));
  if (session.status !== 'authenticated') return destination;
  // A neutral verified visitor account must finish its exact volatile invitation
  // before any optional founder/workspace setup. No token travels through next.
  const visitReturn = visitJoinReturnTarget(next);
  if (visitReturn && session.user?.email_verified !== false && session.environment.mode === 'live') return visitReturn;
  if (session.user?.email_verified === false) {
    const from = safeAccountReturnTarget(next);
    // A verification email may require sign-in first. Keep its exact canonical
    // security continuation; the owning endpoint binds the token to this actor.
    if (from && !from.includes('#') && from.split('?')[0] === '/more/account/security') return from;
    return from && !from.split('?')[0]?.endsWith('/account/security') ? `${destination}?from=${encodeURIComponent(from)}` : destination;
  }
  const accountReturn = safeAccountReturnTarget(next);
  if (accountReturn && !accountReturn.includes('#')) return accountReturn;
  if (!next || !isInternalHref(next) || !/^\/(?:join|onboarding)(?:\/|\?|$)/.test(next) || next.includes('#')) return destination;
  return canonicalNativeHref(next);
}
