import 'reflect-metadata';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { defer, lastValueFrom, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AssignedWorkAccess, assignedWorkRequestAllowed } from '../src/auth/assigned-work-access.js';
import { ExecutionEnvironmentInterceptor } from '../src/auth/execution-environment.interceptor.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import type { RequestWithContext } from '../src/common/request.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';

const school = '10000000-0000-4000-8000-000000000001', actor = '20000000-0000-4000-8000-000000000001';
const repair = '30000000-0000-4000-8000-000000000001', source = '40000000-0000-4000-8000-000000000001';
const base = `/api/v1/schools/${school}`;
describe('Assigned work technical request boundary', () => {
  it.each([
    ['GET', '/api/v1/workspace/'], ['GET', '/api/v1/events/stream/'], ['GET', '/api/v1/notifications/'],
    ['GET', `${base}/invitations/${source}/continuation`], ['GET', `${base}/facilities/workspace`],
    ['GET', `${base}/facilities/repairs/${repair}`], ['HEAD', `${base}/facilities/repairs/${repair}/photos/${source}`],
    ['GET', `${base}/facilities/repairs/${repair}/confirmation`], ['POST', `${base}/facilities/repairs/${repair}/actions`],
    ['GET', `/api/v1/gate/schools/${school}/visit-arrangements/registered`],
    ['HEAD', `/api/v1/gate/schools/${school}/visit-arrangements/${source}/participant`],
    ['GET', `/api/v1/gate/schools/${school}/visit-arrangements/shared/discovery`],
    ['POST', `${base}/facilities/repairs/${repair}/photos`], ['POST', `${base}/facilities/repairs/${repair}/external-access/${source}/activate`],
  ])('allows only the bounded adapter %s %s', (method, path) => {
    expect(assignedWorkRequestAllowed(method, path, school)).toBe(true);
  });
  it.each([
    ['POST', '/api/v1/workspace'], ['GET', `${base}/facilities/options`], ['GET', `${base}/facilities/settings`],
    ['POST', `${base}/facilities/repairs`], ['POST', `${base}/facilities/repairs/${repair}/external-access`],
    ['POST', `${base}/facilities/repairs/${repair}/external-access/${source}/end`],
    ['GET', `${base}/people`], ['GET', `${base}/campus-scenes`], ['GET', `${base}/simulation`],
    ['GET', `/api/v1/schools/${actor}/facilities/repairs/${repair}`],
    ['GET', `${base}/facilities/repairs/${repair}/photos/${source}/other`],
    ['GET', `/api/v1/workspace/../people`], ['GET', `${base}/facilities%2Foptions`],
    ['DELETE', `${base}/facilities/repairs/${repair}`],
    ['GET', `/api/v1/gate/schools/${school}/visit-arrangements/${source}`],
    ['GET', `/api/v1/gate/schools/${school}/visit-arrangements/options`],
    ['GET', `/api/v1/gate/schools/${school}/visit-arrangements/${source}/sharing`],
    ['POST', `/api/v1/gate/schools/${school}/visit-arrangements/${source}/onboarding-link/reveal`],
    ['GET', `/api/v1/gate/schools/${actor}/visit-arrangements/${source}/participant`],
  ])('refuses method/path broadening %s %s', (method, path) => {
    expect(assignedWorkRequestAllowed(method, path, school)).toBe(false);
  });
  it('checks current scope for each request and ignores caller query scope claims', async () => {
    const access = new AssignedWorkAccess({} as never), current = vi.spyOn(access, 'only').mockResolvedValue(true);
    const request = { authUser: { id: actor, active_school_id: school }, method: 'GET', url: `${base}/people?access_scope=campus` } as RequestWithContext;
    await expect(access.assertRequest(request)).rejects.toBeInstanceOf(ForbiddenException);
    current.mockResolvedValue(false); await expect(access.assertRequest(request)).resolves.toBeUndefined();
    expect(current).toHaveBeenCalledTimes(2);
  });
  it('evaluates scope inside the actual selected-world binding before allowing the controller', async () => {
    const environment = simulationRequestEnvironment({ institution_id: school, scenario_id: actor, run_id: repair,
      virtual_now: '2032-03-04T05:06:07.000Z', source_snapshot_ref: 'sha256:external-work-scope', manifest_ref: 'external-work-scope', checked_at: '2026-10-26T00:00:00.000Z' });
    const checked: string[] = [], access = new AssignedWorkAccess({} as never);
    vi.spyOn(access, 'only').mockImplementation(async () => {
      await Promise.resolve(); checked.push(executionEnvironmentStorage.getStore()!.namespace_id); return true;
    });
    const interceptor = new ExecutionEnvironmentInterceptor(new ExecutionDataPlaneScope(), { assertEnvironmentReady: vi.fn() } as never, undefined, access);
    const request = { authUser: { id: actor, active_school_id: school }, method: 'GET', url: '/api/v1/workspace/', headers: {},
      executionEnvironment: environment, executionEnvironmentView: { mode: 'simulation', namespace_id: environment.namespace_id, run_status: 'running' } } as unknown as RequestWithContext;
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
    const handle = vi.fn(() => defer(() => {
      expect(executionEnvironmentStorage.getStore()!.namespace_id).toBe(environment.namespace_id); return of({ current: true });
    }));
    expect(await lastValueFrom(interceptor.intercept(context, { handle }))).toEqual({ current: true });
    expect(checked).toEqual([environment.namespace_id]); expect(handle).toHaveBeenCalledOnce();
    const refusedContext = { switchToHttp: () => ({ getRequest: () => ({ ...request, url: `${base}/people/` }) }) } as ExecutionContext;
    handle.mockClear();
    await expect(lastValueFrom(interceptor.intercept(refusedContext, { handle }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(handle).not.toHaveBeenCalled(); expect(executionEnvironmentStorage.getStore()).toBeUndefined();
  });
});
