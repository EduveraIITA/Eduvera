import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { AuthUser } from '../src/common/request.js';
const mocks = vi.hoisted(() => ({ send: vi.fn(), settings: {
  INVITATION_EMAIL_ENABLED: false, NODE_ENV: 'production', DEMO_MODE: false,
  PUBLIC_URL: 'https://campus.example.test',
} }));
vi.mock('../src/config.js', () => ({ config: () => mocks.settings }));
vi.mock('../src/common/email-transport.js', () => ({ sendTransactionalEmail: mocks.send }));
import { accountEmailMode, deliverAccountAction } from '../src/common/account-email.js';
import { AuthService } from '../src/auth/auth.service.js';

const proof = 'test-only-reset-proof-'.padEnd(64, '0');
function resetOwner(found: boolean) {
  const read = vi.fn().mockResolvedValue(found ? { id: '00000000-0000-4000-8000-000000000001', email: 'known@example.test' } : undefined);
  const query = { select: () => query, where: () => query, executeTakeFirst: read };
  const selectFrom = vi.fn(() => query), issue = vi.fn().mockResolvedValue({ raw: proof, expiresAt: new Date('2099-01-01T00:00:00Z') });
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const owner = { db: { selectFrom }, audit, issueAccountToken: issue } as unknown as AuthService;
  return { request: (email: string) => AuthService.prototype.requestPasswordReset.call(owner, { email }, {} as FastifyRequest), read, selectFrom, issue, audit };
}
beforeEach(() => { vi.clearAllMocks(); Object.assign(mocks.settings, { INVITATION_EMAIL_ENABLED: false, NODE_ENV: 'production', DEMO_MODE: false }); mocks.send.mockResolvedValue(undefined); });

describe('account email readiness without account disclosure', () => {
  it('returns the same disabled deployment result without looking up either account or issuing inaccessible proofs', async () => {
    const existing = resetOwner(true), absent = resetOwner(false);
    const a = await existing.request('known@example.test'), b = await absent.request('unknown@example.test');
    expect(a).toEqual({ accepted: true, recovery_available: false }); expect(b).toEqual(a);
    for (const owner of [existing, absent]) { expect(owner.selectFrom).not.toHaveBeenCalled(); expect(owner.issue).not.toHaveBeenCalled(); expect(owner.audit.record).toHaveBeenCalledWith({ action: 'auth.password_reset.unavailable', request: {} }); }
    expect(mocks.send).not.toHaveBeenCalled(); expect(JSON.stringify(a)).not.toContain('token');
  });
  it('never exposes a development proof in production even when a development flag was set', async () => {
    mocks.settings.DEMO_MODE = true;
    expect(accountEmailMode()).toBe('unavailable');
    expect(await deliverAccountAction({ email: 'known@example.test', token: proof, purpose: 'email_verification', expiresAt: new Date('2099-01-01') })).toEqual({ delivery: 'unavailable' });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not replace an existing verification proof or claim a send cooldown when email is globally unavailable', async () => {
    const audit = { record: vi.fn().mockResolvedValue(undefined) }, issue = vi.fn();
    const owner = { db: { selectFrom: () => { throw new Error('No account proof lookup expected'); } }, audit, issueAccountToken: issue } as unknown as AuthService;
    const user = { id: '00000000-0000-4000-8000-000000000001', email: 'known@example.test' } as AuthUser;
    expect(await AuthService.prototype.requestEmailVerification.call(owner, user, {} as FastifyRequest)).toEqual({ verified: false, delivery: 'unavailable' });
    expect(issue).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    expect(await AuthService.prototype.requestEmailVerification.call(owner, { ...user, email_verified_at: new Date() }, {} as FastifyRequest)).toEqual({ verified: true, delivery: 'not_required' });
  });
  it('keeps configured known and unknown reset results identical without revealing provider acceptance', async () => {
    mocks.settings.INVITATION_EMAIL_ENABLED = true;
    const existing = resetOwner(true), absent = resetOwner(false);
    const a = await existing.request('known@example.test'), b = await absent.request('unknown@example.test');
    expect(a).toEqual({ accepted: true, recovery_available: true }); expect(b).toEqual(a);
    expect(existing.issue).toHaveBeenCalledOnce(); expect(absent.issue).not.toHaveBeenCalled(); expect(mocks.send).toHaveBeenCalledOnce();
    expect(JSON.stringify(a)).not.toMatch(/known|token|delivery/);
  });
  it('does not turn a known-address provider rejection into a public account discriminator', async () => {
    mocks.settings.INVITATION_EMAIL_ENABLED = true; mocks.send.mockRejectedValue(new Error('private provider response and credential'));
    const a = await resetOwner(true).request('known@example.test'), b = await resetOwner(false).request('unknown@example.test');
    expect(a).toEqual(b); expect(a).toEqual({ accepted: true, recovery_available: true });
    expect(JSON.stringify(a)).not.toMatch(/private|provider|credential|failed/);
  });
  it('retains the explicitly nonproduction development ceremony without contacting a provider', async () => {
    Object.assign(mocks.settings, { DEMO_MODE: true, NODE_ENV: 'development' });
    expect(accountEmailMode()).toBe('development');
    expect(await resetOwner(true).request('known@example.test')).toEqual({ accepted: true, recovery_available: true, delivery: 'manual', development_token: proof });
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('keeps actual configured verification acceptance distinct from inbox delivery', async () => {
    mocks.settings.INVITATION_EMAIL_ENABLED = true;
    expect(await deliverAccountAction({ email: 'known@example.test', token: proof, purpose: 'email_verification', expiresAt: new Date('2099-01-01') })).toEqual({ delivery: 'email_accepted' });
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});
