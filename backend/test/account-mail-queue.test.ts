import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
const mocks = vi.hoisted(() => ({ config: vi.fn(), selected: vi.fn(), capture: vi.fn() }));
vi.mock('../src/config.js', () => ({ config: mocks.config }));
vi.mock('../src/common/simulation-resources.js', () => ({ selectedSimulationResources: mocks.selected, captureSimulationProviderEffect: mocks.capture, simulationLogicalDigest: vi.fn() }));
import { enqueueAccountMail, openAccountMailToken, sealAccountMailToken } from '../src/common/account-email-queue.js';
import { AuthService } from '../src/auth/auth.service.js';
import { deliverAccountAction } from '../src/common/account-email.js';

beforeEach(() => {
  vi.clearAllMocks(); mocks.config.mockReturnValue({ COOKIE_SECRET: 'local-test-account-mail-key-more-than-32', INVITATION_EMAIL_ENABLED: true });
  mocks.selected.mockReturnValue(null); mocks.capture.mockResolvedValue({ sink_record_id: 'isolated-receipt' });
});

describe('account mail credential and selected-world boundary', () => {
  it('encrypts with fresh nonces and binds the token identity and purpose', () => {
    const id = randomUUID(), token = 'test-only-'.padEnd(43, 'a');
    const a = sealAccountMailToken(token, id, 'password_reset'), b = sealAccountMailToken(token, id, 'password_reset');
    expect(a).not.toBe(b); expect(Buffer.from(a, 'base64').toString()).not.toContain(token);
    expect(openAccountMailToken(a, id, 'password_reset')).toBe(token);
    expect(() => openAccountMailToken(a, randomUUID(), 'password_reset')).toThrow();
    expect(() => openAccountMailToken(a, id, 'email_verification')).toThrow();
    const bytes = Buffer.from(a, 'base64'); bytes[30] = bytes[30]! ^ 1;
    expect(() => openAccountMailToken(bytes.toString('base64'), id, 'password_reset')).toThrow();
  });
  it('captures only nonlive purpose evidence before any Live config, secret or database access', async () => {
    mocks.selected.mockReturnValue({}); mocks.config.mockImplementation(() => { throw new Error('Live credential access forbidden'); });
    const db = { executeQuery: vi.fn(() => { throw new Error('No queued Live mail allowed'); }) };
    const result = await enqueueAccountMail(db as never, { id: randomUUID(), email: 'private@example.test', token: 'private-token', purpose: 'password_reset', expiresAt: new Date('2099-01-01') });
    expect(result).toMatchObject({ delivery: 'captured', evidence_mode: 'simulation' });
    expect(mocks.capture).toHaveBeenCalledWith(expect.objectContaining({ provider: 'account_email', payload: { purpose: 'password_reset', evidence_mode: 'simulation', delivered_externally: false } }));
    expect(JSON.stringify(mocks.capture.mock.calls)).not.toMatch(/private@example|private-token/);
    expect(mocks.config).not.toHaveBeenCalled(); expect(db.executeQuery).not.toHaveBeenCalled();
  });
  it('refuses ordinary registration, recovery and verification in Simulation before account lookup or token writes', async () => {
    const db = { transaction: vi.fn(), selectFrom: vi.fn() }, audit = { record: vi.fn() };
    const auth = new AuthService(db as never, audit as never, {} as never, {} as never);
    await executionEnvironmentStorage.run({ kind: 'simulation' } as never, async () => {
      for (const work of [() => auth.register({}, {} as FastifyRequest), () => auth.requestPasswordReset({}, {} as FastifyRequest),
        () => auth.confirmPasswordReset({}, {} as FastifyRequest), () => auth.requestEmailVerification({} as never, {} as FastifyRequest),
        () => auth.confirmEmailVerification({} as never, {}, {} as FastifyRequest),
        () => deliverAccountAction({email:'private@example.test',token:'private-token',purpose:'password_reset',expiresAt:new Date('2099-01-01')})])
        await expect(work()).rejects.toMatchObject({ status: 403 });
    });
    expect(db.transaction).not.toHaveBeenCalled(); expect(db.selectFrom).not.toHaveBeenCalled(); expect(mocks.config).not.toHaveBeenCalled();
  });
});
