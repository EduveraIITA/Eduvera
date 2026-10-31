import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../src/common/request.js';
import type { WorkspaceRepositorySnapshot } from '../src/workspace/workspace.contracts.js';
import { WorkspaceService } from '../src/workspace/workspace.service.js';

const school = '10000000-0000-4000-8000-000000000001', actor = '20000000-0000-4000-8000-000000000001';
const instant = new Date('2026-10-26T10:00:00.000Z');
const snapshot: WorkspaceRepositorySnapshot = { institution: { id: school, name: 'Fictional Campus', code: 'fictional', timezone: 'UTC' },
  membership_roles: ['member'], access_scope: 'assigned_work', realm_id: '30000000-0000-4000-8000-000000000001',
  environment_namespace_id: `live:${school}`, acting_agent_id: '40000000-0000-4000-8000-000000000001', owner_agent_ids: [],
  assignments: [], messages: [], relationships: [] };

describe('Shared visit Area presentation', () => {
  it.each([false, true])('describes only the contributed visit work and preserves the manager tile (%s)', async canManage => {
    const clock = { now: () => instant, read: () => ({ instant, iso_instant: instant.toISOString(), local_date: '2026-10-26', local_time: '10:00:00', time_zone: 'UTC' }) };
    const visits = { discovery: vi.fn().mockResolvedValue({ can_manage: canManage, has_shared: true, has_questions: false }),
      work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [] }) };
    const service = new WorkspaceService({ load: vi.fn().mockResolvedValue({ ...snapshot, access_scope: canManage ? 'campus' : 'assigned_work' }) } as never, clock as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, visits as never);
    const result = await service.manifest({ id: actor, role: 'member', is_active: true, active_school_id: school } as AuthUser,
      null, { mode: 'live', institution_id: school, namespace_id: `live:${school}` });
    expect(result.areas).toHaveLength(1);
    expect(result.areas[0]).toMatchObject({ key: 'in-out', href: '/areas/in-out',
      label: canManage ? 'In & Out' : 'Visits', description: canManage ? 'Authorized entry, exit and visitor operations' : 'Your shared visit plans and questions' });
    expect(result.areas[0]!.surfaces.map(surface => surface.href)).toEqual(canManage
      ? ['/areas/in-out/visits', '/areas/in-out/operate'] : ['/areas/in-out/visits']);
  });
});
