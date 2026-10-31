import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { ForbiddenException, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR, HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentService } from '../src/agent/agent.service.js';
import { availableCapabilities, type AgentScope } from '../src/agent/catalogue.js';
import { AgentGateway, type AgentCredentials } from '../src/agent/gateway.js';
import { ExecutionEnvironmentInterceptor } from '../src/auth/execution-environment.interceptor.js';
import { CsrfGuard, PublicDemoGuard, SessionGuard } from '../src/auth/guards.js';
import { InternalAgentDelegationService } from '../src/auth/internal-agent-delegation.js';
import { liveSessionExecutionEnvironment, simulationSessionExecutionEnvironment, unavailableSimulationSessionExecutionEnvironment } from '../src/auth/session-execution-environment.js';
import type { AuthenticatedRequest, AuthUser } from '../src/common/request.js';
import { ExecutionDataPlaneScope } from '../src/database/execution-data-plane.js';
import { SchoolController } from '../src/school/school.controller.js';
import { SchoolEventService } from '../src/school/school-event.service.js';
import { SchoolService } from '../src/school/school.service.js';

vi.mock('../src/config.js', () => ({ config: () => ({ SESSION_COOKIE_NAME: 'agent_transport_session' }) }));

const user: AuthUser = { id: randomUUID(), username: 'synthetic.native.reader', email: 'synthetic@example.test',
  first_name: 'Synthetic', last_name: 'Reader', role: 'staff', is_active: true, active_school_id: randomUUID() };
const nativeToken = `tc_native_${'n'.repeat(43)}`;
const cookieToken = 'synthetic-cookie-session';
const live = liveSessionExecutionEnvironment(user.active_school_id);
const scope: AgentScope = { userId: user.id, schoolId: user.active_school_id!, portal: 'teacher', studentId: null,
  permissions: ['ai.use'], timezone: 'UTC', proFeaturesEnabled: true };
const read = availableCapabilities(scope).find(item => item.name === 'notifications')!;
const write = availableCapabilities(scope).find(item => item.name === 'read_notification')!;
const execution = new ExecutionDataPlaneScope();
const delegations = new InternalAgentDelegationService();
const identity = () => ({ user: { ...user }, tokenHash: 'synthetic-hash', csrfToken: 'synthetic-csrf',
  executionEnvironment: live.environment, executionEnvironmentView: live.view, publicDemo: false });
const tokens = new Map<string, ReturnType<typeof identity>>();
const auth = { resolveSession: vi.fn((token: string) => Promise.resolve(tokens.get(token) ?? null)) };
const notifications = vi.fn((actor: AuthUser) => Promise.resolve({ results: [{ id: 'synthetic-notification', title: 'Synthetic notification' }],
  owner_id: actor.id, school_id: actor.active_school_id, namespace: execution.current()?.namespace_id }));
const markNotificationRead = vi.fn((actor: AuthUser, id: string) => Promise.resolve({ id, owner_id: actor.id,
  namespace: execution.current()?.namespace_id, read: true }));

// Vitest's transform does not emit constructor metadata. Bind the production
// controller explicitly; its HTTP handlers and ordinary guard stack run intact.
Reflect.defineMetadata('design:paramtypes', [SchoolService, SchoolEventService], SchoolController);
@Module({ controllers: [SchoolController], providers: [
  { provide: SchoolService, useValue: { notifications, markNotificationRead } },
  { provide: SchoolEventService, useValue: {} },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new SessionGuard(reflector, auth as never, delegations) },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new CsrfGuard(reflector) },
  { provide: APP_GUARD, useClass: PublicDemoGuard },
  { provide: APP_INTERCEPTOR, useFactory: () => new ExecutionEnvironmentInterceptor(execution, { assertEnvironmentReady: vi.fn() } as never) },
] })
class AgentTransportModule {}

/** Exercise the production extractor without starting a model or a database. */
function credentials(request: Partial<AuthenticatedRequest>): AgentCredentials {
  return (AgentService.prototype as unknown as { credentials(value: AuthenticatedRequest): AgentCredentials })
    .credentials({ authUser: user, requestId: randomUUID(), headers: {}, cookies: {},
      executionEnvironment:live.environment, executionEnvironmentView:live.view, ...request } as AuthenticatedRequest);
}
function nativeCredentials() {
  return credentials({ sessionTransport: 'bearer', headers: { authorization: `Bearer ${nativeToken}`,
    // Neither unrelated cookies nor a client-supplied namespace is authority.
    cookie: 'unrelated=do-not-forward', 'x-thatcampus-execution-environment': 'scenario:forged:run:forged' }, cookies: { unrelated: 'do-not-forward' } });
}

describe('Assistant native transport through the owning HTTP contract', () => {
  let app: NestFastifyApplication;
  let gateway: AgentGateway;
  const requests: Array<Record<string, unknown>> = [];
  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(AgentTransportModule,
      new FastifyAdapter({ routerOptions: { ignoreTrailingSlash: true } }), { logger: false });
    await app.register(cookie, { secret: 'synthetic-agent-transport-cookie-secret-123456789' });
    app.getHttpAdapter().getInstance().addHook('onRequest', (request, _reply, done) => {
      (request as AuthenticatedRequest).requestId = String(request.headers['x-request-id'] ?? randomUUID());
      requests.push({ ...request.headers }); done();
    });
    await app.init(); await app.getHttpAdapter().getInstance().ready();
    gateway = new AgentGateway(app.get(HttpAdapterHost), delegations);
  });
  beforeEach(() => {
    tokens.clear(); tokens.set(nativeToken, identity()); tokens.set(cookieToken, identity());
    auth.resolveSession.mockReset().mockImplementation(token => Promise.resolve(tokens.get(token) ?? null));
    notifications.mockClear(); markNotificationRead.mockClear(); requests.length = 0;
  });
  afterAll(async () => { await app.close(); });

  it('reads the catalogue tool with the original native account and Live campus, with no credential in its result', async () => {
    const transient = nativeCredentials();
    expect(transient).toEqual({ nativeToken, requestId: expect.any(String), actorId:user.id, executionNamespace:`live:${scope.schoolId}` });
    const result = await gateway.dispatch(read, { limit: 15 }, scope, transient);
    expect(result).toMatchObject({ owner_id: user.id, school_id: scope.schoolId, namespace: `live:${scope.schoolId}` });
    expect(auth.resolveSession).toHaveBeenCalledWith(nativeToken);
    expect(requests[0]).toMatchObject({ authorization: `Bearer ${nativeToken}`, 'x-thatcampus-execution-environment': `live:${scope.schoolId}` });
    expect(requests[0]).not.toHaveProperty('cookie'); expect(requests[0]).not.toHaveProperty('x-omnischool-agent-delegation');
    expect(JSON.stringify(result)).not.toContain(nativeToken);
    expect(JSON.stringify(notifications.mock.calls)).not.toContain(nativeToken);
    expect(Object.keys(transient)).not.toContain('authUser');
  });

  it('rechecks the original session for every tool and refuses revocation after a successful read', async () => {
    const transient = nativeCredentials();
    await gateway.dispatch(read, {}, scope, transient); tokens.delete(nativeToken);
    await expect(gateway.dispatch(read, {}, scope, transient)).rejects.toMatchObject({ appStatus: 401 });
    expect(notifications).toHaveBeenCalledTimes(1); expect(auth.resolveSession).toHaveBeenCalledTimes(2);
  });

  it('preserves a family session with a relationship-selected child and no active campus', async () => {
    const familyUser = { ...user, role: 'parent' as const, active_school_id: null }, global = liveSessionExecutionEnvironment(null);
    tokens.set(nativeToken, { ...identity(), user: familyUser, executionEnvironment: global.environment, executionEnvironmentView: global.view });
    const transient = credentials({ authUser: familyUser, sessionTransport: 'bearer', headers: { authorization: `Bearer ${nativeToken}` },
      executionEnvironment: global.environment, executionEnvironmentView: global.view });
    const familyScope: AgentScope = { ...scope, portal: 'parent', studentId: randomUUID() };
    await gateway.dispatch(read, {}, familyScope, transient);
    expect(transient.executionNamespace).toBe('live:global');
    expect(notifications).toHaveBeenCalledWith(familyUser, expect.any(Object));
  });

  it('fences a late campus switch before the owning domain reads another tenant', async () => {
    const transient = nativeCredentials();
    const otherSchool = randomUUID(), other = liveSessionExecutionEnvironment(otherSchool);
    tokens.set(nativeToken, { ...identity(), user: { ...user, active_school_id: otherSchool },
      executionEnvironment: other.environment, executionEnvironmentView: other.view });
    await expect(gateway.dispatch(read, {}, scope, transient)).rejects.toMatchObject({ appStatus: 409 });
    expect(notifications).not.toHaveBeenCalled();
  });

  it('fences a queued tool when its session selects Simulation before fresh resolution completes', async () => {
    const transient = nativeCredentials(); let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    auth.resolveSession.mockImplementationOnce(async token => { await waiting; return tokens.get(token) ?? null; });
    const pending = gateway.dispatch(read, {}, scope, transient);
    const scenarioId = randomUUID(), runId = randomUUID();
    const selected = simulationSessionExecutionEnvironment({ institution_id: scope.schoolId, scenario_id: scenarioId,
      run_id: runId, namespace_id: `scenario:${scenarioId}:run:${runId}`, virtual_now: '2026-10-29T11:00:00Z', time_zone: 'UTC',
      source_snapshot_at: '2026-10-29T10:00:00Z', source_snapshot_ref: 'synthetic-snapshot', expires_at: '2099-01-01T00:00:00Z' },
    { manifest_ref: 'synthetic-test-coverage', checked_at: '2026-10-29T10:00:00Z' });
    // A healthy selected world reaches the existing namespace fence. No simulated
    // data plane/provider is enabled by this transport test.
    tokens.set(nativeToken, { ...identity(), executionEnvironment: selected.environment, executionEnvironmentView: selected.view }); release();
    await expect(pending).rejects.toMatchObject({ appStatus: 409 });
    expect(notifications).not.toHaveBeenCalled();
  });

  it('keeps an unavailable Simulation refusal instead of falling back to Live', async () => {
    const selected = unavailableSimulationSessionExecutionEnvironment({ school_id: scope.schoolId,
      scenario_id: randomUUID(), run_id: randomUUID(), namespace_id: 'scenario:synthetic:run:unavailable', expires_at: '2099-01-01T00:00:00Z' }, 'authorization_lost');
    tokens.set(nativeToken, { ...identity(), executionEnvironment: selected.environment, executionEnvironmentView: selected.view });
    await expect(gateway.dispatch(read, {}, scope, nativeCredentials())).rejects.toMatchObject({ appStatus: 410 });
    expect(notifications).not.toHaveBeenCalled();
  });

  it('retains the explicit approved action and fresh native CSRF transport for owning writes', async () => {
    const transient = nativeCredentials(), notificationId = randomUUID(), actionId = randomUUID();
    await expect(gateway.dispatch(write, { id: notificationId }, scope, transient)).rejects.toThrow('approved action');
    const result = await gateway.dispatch(write, { id: notificationId }, scope, transient, actionId);
    expect(result).toMatchObject({ id: notificationId, owner_id: user.id, namespace: `live:${scope.schoolId}`, read: true });
    expect(requests[0]).toMatchObject({ 'idempotency-key': actionId });
    expect(markNotificationRead).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(nativeToken);
  });

  it('preserves the authenticated public-demo write restriction', async () => {
    tokens.set(nativeToken, { ...identity(), publicDemo: true });
    await expect(gateway.dispatch(write, { id: randomUUID() }, scope, nativeCredentials(), randomUUID())).rejects.toMatchObject({ appStatus: 403 });
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('propagates current owning-domain permission loss without retry or a retained answer', async () => {
    notifications.mockRejectedValueOnce(new ForbiddenException('Current record permission was revoked.'));
    await expect(gateway.dispatch(read, {}, scope, nativeCredentials())).rejects.toMatchObject({ appStatus: 403,
      message: 'Current record permission was revoked.' });
    expect(notifications).toHaveBeenCalledTimes(1); expect(auth.resolveSession).toHaveBeenCalledTimes(1);
  });

  it('preserves browser cookie reads and signed CSRF writes through the same context fence', async () => {
    const server = app.getHttpAdapter().getInstance(), csrf = server.signCookie('synthetic-csrf');
    const cookieHeader = `agent_transport_session=${encodeURIComponent(server.signCookie(cookieToken))}; csrftoken=${encodeURIComponent(csrf)}`;
    const transient = credentials({ sessionTransport: 'cookie', headers: { cookie: cookieHeader }, cookies: { csrftoken: csrf } });
    await gateway.dispatch(read, {}, scope, transient);
    await gateway.dispatch(write, { id: randomUUID() }, scope, transient, randomUUID());
    expect(notifications).toHaveBeenCalledTimes(1); expect(markNotificationRead).toHaveBeenCalledTimes(1);
    expect(requests.every(request => request.authorization === undefined)).toBe(true);
    const otherSchool = randomUUID(), other = liveSessionExecutionEnvironment(otherSchool);
    tokens.set(cookieToken, { ...identity(), user: { ...user, active_school_id: otherSchool },
      executionEnvironment: other.environment, executionEnvironmentView: other.view });
    await expect(gateway.dispatch(read, {}, scope, transient)).rejects.toMatchObject({ appStatus: 409 });
    expect(notifications).toHaveBeenCalledTimes(1);
  });

  it('does not exempt an ordinary browser tool write from its signed CSRF proof', async () => {
    const server = app.getHttpAdapter().getInstance();
    const transient = credentials({ sessionTransport: 'cookie', headers: {
      cookie: `agent_transport_session=${encodeURIComponent(server.signCookie(cookieToken))}` } });
    await expect(gateway.dispatch(write, { id: randomUUID() }, scope, transient, randomUUID())).rejects.toMatchObject({ appStatus: 403 });
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it('retains the one-use verified-channel transport without forwarding a native token or cookie', async () => {
    const transient = credentials({ internalAgentDelegation: true });
    await gateway.dispatch(read, {}, scope, transient); await gateway.dispatch(read, {}, scope, transient);
    expect(notifications).toHaveBeenCalledTimes(2); expect(auth.resolveSession).not.toHaveBeenCalled();
    expect(requests.every(request => typeof request['x-omnischool-agent-delegation'] === 'string'
      && request.authorization === undefined && request.cookie === undefined)).toBe(true);
    expect(requests[0]!['x-omnischool-agent-delegation']).not.toBe(requests[1]!['x-omnischool-agent-delegation']);
  });

  it('does not turn an unverified Authorization header into a delegated identity', async () => {
    const transient = credentials({ headers: { authorization: `Bearer ${nativeToken}` } });
    expect(transient).not.toHaveProperty('nativeToken'); expect(transient).not.toHaveProperty('delegatedUser');
    await expect(gateway.dispatch(read, {}, scope, transient)).rejects.toMatchObject({ appStatus: 401 });
    expect(notifications).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Bearer malformed', `Bearer ${nativeToken} extra`])('refuses a missing/malformed native header %s without a cookie fallback', authorization => {
    expect(() => credentials({ sessionTransport: 'bearer', headers: { ...(authorization ? { authorization } : {}),
      cookie: 'agent_transport_session=present' }, cookies: {} })).toThrow('native Bearer');
  });

  it('refuses accidental mixed native transports before injecting any request', async () => {
    await expect(gateway.dispatch(read, {}, scope, { ...nativeCredentials(), delegatedUser: user })).rejects.toThrow('one app session transport');
    expect(requests).toHaveLength(0); expect(notifications).not.toHaveBeenCalled();
  });

  it('rejects a mismatched conversation owner or campus before injecting any request', async () => {
    const transient = nativeCredentials();
    await expect(gateway.dispatch(read, {}, { ...scope, userId: randomUUID() }, transient)).rejects.toThrow('match this conversation');
    await expect(gateway.dispatch(read, {}, { ...scope, schoolId: randomUUID() }, transient)).rejects.toThrow('match this conversation');
    expect(requests).toHaveLength(0);
  });

  it('never extracts Live credentials from a selected Simulation request', () => {
    const unavailable = unavailableSimulationSessionExecutionEnvironment({ school_id: scope.schoolId,
      scenario_id: randomUUID(), run_id: randomUUID(), namespace_id: 'scenario:synthetic:run:unavailable', expires_at: '2099-01-01T00:00:00Z' }, 'authorization_lost');
    expect(() => credentials({ sessionTransport: 'bearer', headers: { authorization: `Bearer ${nativeToken}` },
      executionEnvironment: unavailable.environment, executionEnvironmentView: unavailable.view })).toThrow('not modelled in this Simulation');
    expect(requests).toHaveLength(0);
  });
});
