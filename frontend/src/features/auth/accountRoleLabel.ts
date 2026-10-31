import type { AuthUser, SchoolMembership } from './AuthContext';

/** Descriptive roles from the selected campus; never an authorization decision. */
export function accountRoleLabel(user: AuthUser, memberships: readonly SchoolMembership[]): string {
  const membership = user.active_school_id
    ? memberships.find(item => item.school_id === user.active_school_id)
    : memberships.length === 1 ? memberships[0] : undefined;
  const profiles = [...(membership?.work_profiles ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  const names = [...new Set(profiles.map(profile => profile.name.trim()).filter(Boolean))];
  if (names.length) return names.join(' · ');
  if (membership?.custom_role?.name.trim()) return membership.custom_role.name.trim();
  const role = membership?.role ?? user.role;
  const labels: Record<string, string> = { admin: 'Administrator', staff: 'Staff', student: 'Student', guardian: 'Guardian', parent: 'Guardian', teacher: 'Teacher', principal: 'Principal', member: 'Member' };
  return labels[role] ?? role;
}
