import 'reflect-metadata';
import cookie from '@fastify/cookie';
import { Module } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CsrfGuard, SessionGuard } from '../src/auth/guards.js';
import { OperationsController } from '../src/operations/operations.controller.js';
import { OperationsService } from '../src/operations/operations.service.js';
import { FeeReviewService } from '../src/operations/fee-review.service.js';
import { liveSessionExecutionEnvironment, unavailableSimulationSessionExecutionEnvironment } from '../src/auth/session-execution-environment.js';
import { rateLimitRule } from '../src/common/rate-limit.js';

vi.mock('../src/config.js', () => ({ config: () => ({ SESSION_COOKIE_NAME: 'test_session' }) }));
const school = '00000000-0000-4000-8000-000000000001', live = liveSessionExecutionEnvironment(school);
const bearer = `tc_native_${'a'.repeat(43)}`, tokens = new Map<string, object>();
const operations = { acceptInvite: vi.fn(async (body: unknown) => ({ accepted: true, supplied: body })), recipientProof: vi.fn(async (body: unknown) => ({ verification_required: true, supplied: body })) };
const auth = { resolveSession: vi.fn(async (token?: string) => tokens.get(token ?? '') ?? null) };
@Module({ controllers: [OperationsController], providers: [
  { provide: OperationsService, useValue: operations }, { provide: FeeReviewService, useValue: {} },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new SessionGuard(reflector, auth as never, {} as never) },
  { provide: APP_GUARD, inject: [Reflector], useFactory: (reflector: Reflector) => new CsrfGuard(reflector) },
] })
class InvitationTransportModule {}

describe('native invitation transport retains the owning credential ceremony', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => { app = await NestFactory.create<NestFastifyApplication>(InvitationTransportModule, new FastifyAdapter({ routerOptions: { ignoreTrailingSlash: true } }), { logger: false }); await app.register(cookie, { secret: 'test-native-invitation-cookie-secret' }); await app.init(); await app.getHttpAdapter().getInstance().ready(); });
  afterAll(async () => { await app.close(); });
  it.each(['accept', 'recipient-proof'])('allows anonymous explicit proof at %s without issuing cookies or a session', async action => {
    const supplied = { email: 'recipient@example.test', token: '123456', ...(action === 'accept' ? { password: 'private-password', first_name: 'Recipient', recipient_proof: '654321' } : {}) };
    const response = await app.inject({ method: 'POST', url: `/api/v1/auth/native/invitations/${action}/`, payload: supplied });
    expect(response.statusCode).toBe(200); expect(response.headers['set-cookie']).toBeUndefined(); expect(response.json()).toMatchObject({ supplied });
    expect(response.json()).not.toHaveProperty('access_token');
    expect(rateLimitRule(`/api/v1/auth/native/invitations/${action}/`, 'POST')).toEqual(rateLimitRule(`/api/v1/invitations/${action}/`, 'POST'));
  });
  it('keeps browser invitation acceptance CSRF protected', async () => {
    const before = operations.acceptInvite.mock.calls.length;
    const response = await app.inject({ method: 'POST', url: '/api/v1/invitations/accept/', payload: { token: '123456' } });
    expect(response.statusCode).toBe(403); expect(operations.acceptInvite.mock.calls.length).toBe(before);
  });
  it.each([false, true])('refuses a server-selected Simulation before the owner (unavailable=%s)', async unavailable => {
    const view = unavailableSimulationSessionExecutionEnvironment({ school_id: school, scenario_id: school, run_id: school, namespace_id: 'scenario:test:run:test', expires_at: '2030-01-01T00:00:00Z' }, 'data_plane_unavailable').view;
    tokens.set(bearer, { executionEnvironmentView: { ...view, unavailable }, publicDemo: false });
    const before = operations.recipientProof.mock.calls.length;
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/native/invitations/recipient-proof/', headers: { authorization: `Bearer ${bearer}`, 'x-thatcampus-execution-environment': `live:${school}` }, payload: { token: '123456' } });
    expect(response.statusCode).toBe(403); expect(operations.recipientProof.mock.calls.length).toBe(before);
  });
  it('refuses read-only demo account ceremonies without calling the owner', async () => {
    tokens.set(bearer, { executionEnvironmentView: live.view, publicDemo: true });
    const before = operations.acceptInvite.mock.calls.length;
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/native/invitations/accept/', headers: { authorization: `Bearer ${bearer}` }, payload: { token: '123456' } })).statusCode).toBe(403);
    expect(operations.acceptInvite.mock.calls.length).toBe(before);
  });
});
