import type { AuthUser, Membership } from '../auth/SessionProvider';
import type { AssistantPortal } from '../../../packages/contracts/src/wire/features/assistant/context';

/** Perspective adapts the existing server contract; it never grants a capability. */
export function assistantPerspective(user: AuthUser | null, memberships: Membership[], schoolId: string | null): AssistantPortal | null {
  if (!user || !schoolId || user.active_school_id !== schoolId) return null;
  const selected = memberships.filter(membership => membership.school_id === schoolId);
  if (selected.length && selected.every(membership => membership.access_scope === 'assigned_work')) return null;
  const role = (user as typeof user & { role?: string }).role;
  if (role === 'parent' || role === 'student') return role;
  if (role === 'staff') return 'teacher';
  if (role === 'admin') return 'principal';
  const roles = new Set(selected.map(membership => membership.role));
  if (roles.has('staff')) return 'teacher';
  if (roles.has('admin')) return 'principal';
  // Family/student contracts require the corresponding account identity on
  // the server. A membership title alone must not impersonate that account.
  return null;
}

/** Shared entry visibility; the owning API still decides every read/action. */
export function assistantEntryAvailable(environment: { mode: string; unavailable?: boolean }, enabled: boolean | undefined, perspective: AssistantPortal | null): boolean {
  return environment.mode === 'live' && !environment.unavailable && enabled === true && perspective !== null;
}

