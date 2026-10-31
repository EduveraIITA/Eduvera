import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import type { WorkspaceRepositorySnapshot } from '../src/workspace/workspace.contracts.js';
import { WorkspaceService } from '../src/workspace/workspace.service.js';

const school = '10000000-0000-4000-8000-000000000001', actor = '20000000-0000-4000-8000-000000000001';
const instant = new Date('2026-10-26T10:00:00.000Z');
const user = { id: actor, role: 'member', is_active: true, active_school_id: school } as AuthUser;
const snapshot: WorkspaceRepositorySnapshot = { institution: { id: school, name: 'Fictional Campus', code: 'fictional', timezone: 'UTC' },
  membership_roles: ['member'], access_scope: 'assigned_work', realm_id: '30000000-0000-4000-8000-000000000001',
  environment_namespace_id: `live:${school}`, acting_agent_id: '40000000-0000-4000-8000-000000000001', owner_agent_ids: [],
  assignments: [], messages: [], relationships: [] };
const forbiddenDependency = () => new Proxy({}, { get: (_, property) => { throw new Error(`Unrelated campus projection accessed: ${String(property)}`); } });

describe('Assigned work common workspace composition', () => {
  it('reads exact Facilities work without touching unrelated campus domains or setup', async () => {
    const facilities = { work: vi.fn().mockResolvedValue({ needs_me: [{ id: 'repair-one', repair_id: 'repair-one', revision: 2,
      title: 'Repair job', state: 'review_needed', action: 'accept', href: '/areas/facilities?repair_id=repair-one',
      created_at: instant.toISOString(), due_at: null, message_id: 'exact-job-message', owner: { user_id: actor, label: 'Technician' } }], waiting: [] }),
      discovery: vi.fn().mockResolvedValue({ can_manage: false, can_report: false, has_repairs: true }) };
    const clock = { now: () => instant, read: () => ({ instant, iso_instant: instant.toISOString(), local_date: '2026-10-26', local_time: '10:00:00', time_zone: 'UTC' }) };
    const service = new WorkspaceService({ load: vi.fn().mockResolvedValue(snapshot) } as never, clock as never,
      forbiddenDependency() as never, forbiddenDependency() as never, forbiddenDependency() as never, forbiddenDependency() as never,
      forbiddenDependency() as never, forbiddenDependency() as never, forbiddenDependency() as never, forbiddenDependency() as never,
      forbiddenDependency() as never, facilities as never, forbiddenDependency() as never, forbiddenDependency() as never);
    const result = await service.manifest(user, null, { mode: 'live', institution_id: school, namespace_id: `live:${school}` });
    expect(result.context.access_scope).toBe('assigned_work');
    expect(result.areas.map(area => area.key)).toEqual(['facilities']);
    expect(result.more.groups.map(group => group.key)).toEqual(['account']); expect(result.more.setup).toEqual([]);
    expect(result.work.counts).toEqual({ needs_me: 1, waiting: 0 });
    expect(result.work.items[0]).toMatchObject({ href: '/areas/facilities?repair_id=repair-one', source: { kind: 'facility_repair', id: 'repair-one' } });
    expect(result.today.now).toEqual([]); expect(result.today.next).toEqual([]); expect(result.today.attention.total).toBe(1);
    expect(facilities.work).toHaveBeenCalledWith(user, school); expect(facilities.discovery).toHaveBeenCalledWith(user, school);
  });
});
