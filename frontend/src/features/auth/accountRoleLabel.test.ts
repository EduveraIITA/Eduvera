import { describe, expect, it } from 'vitest';
import type { AuthUser, SchoolMembership } from './AuthContext';
import { accountRoleLabel } from './accountRoleLabel';

const user = { role: 'staff', active_school_id: 'campus-a' } as AuthUser;
const membership = { school_id: 'campus-a', role: 'staff', work_profiles: [{ id: 'warden', name: 'Warden', is_primary: false }] } as SchoolMembership;

describe('account role label', () => {
  it('shows the assigned role instead of the broad staff membership', () => {
    expect(accountRoleLabel(user, [membership])).toBe('Warden');
  });
  it('retains multiple roles with primary first and repeated names removed', () => {
    expect(accountRoleLabel(user, [{ ...membership, work_profiles: [
      { id: 'library', name: 'Librarian', is_primary: false },
      { id: 'warden', name: 'Warden', is_primary: true },
      { id: 'library-two', name: 'Librarian', is_primary: false },
    ] }])).toBe('Warden · Librarian');
  });
  it('never borrows a role from another campus or an ambiguous account context', () => {
    const other = { ...membership, school_id: 'campus-b' };
    expect(accountRoleLabel(user, [other])).toBe('Staff');
    expect(accountRoleLabel({ ...user, active_school_id: null }, [membership, other])).toBe('Staff');
  });
  it('uses a custom role when profiles are absent and a readable membership otherwise', () => {
    expect(accountRoleLabel(user, [{ ...membership, work_profiles: [], custom_role: { id: 'warden', name: 'Warden' } }])).toBe('Warden');
    expect(accountRoleLabel({ ...user, role: 'student' }, [])).toBe('Student');
    expect(accountRoleLabel({ ...user, role: 'admin' }, [])).toBe('Administrator');
  });
});
