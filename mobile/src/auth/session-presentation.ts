import type { SessionState } from './session-types';

/** A recheck can retain mounted drafts only inside the same confirmed access boundary. */
export function sessionPresentationIdentity(state: SessionState): string | null {
  if (!state.user?.id) return null;
  const environment = state.environment;
  const memberships = state.memberships.map(item => ({ id: item.id, school: item.school_id, role: item.role, scope: item.access_scope ?? null, permissions: [...(item.permissions ?? [])].sort() })).sort((a, b) => a.id.localeCompare(b.id));
  return JSON.stringify([state.user.id, state.user.active_school_id ?? null, environment.mode, environment.institution_id ?? null, environment.namespace_id ?? null, environment.run_id ?? null, environment.unavailable === true, state.companyOperator === true, state.publicDemo === true, memberships]);
}
export function canRetainSessionPresentation(before: SessionState, after: SessionState): boolean {
  const identity = sessionPresentationIdentity(before);
  return identity !== null && after.status === 'authenticated' && identity === sessionPresentationIdentity(after);
}
