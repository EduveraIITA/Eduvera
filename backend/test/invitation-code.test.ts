import { createHash } from 'node:crypto';
import { describe,it,expect,vi } from 'vitest';
vi.mock('../src/config.js',()=>({config:()=>({COOKIE_SECRET:'test-cookie-secret-at-least-thirty-two-characters'})}));
import { invitationCodeHash } from '../src/common/invitation-code.js';
describe('email-bound numeric invitation codes',()=>{
  it('binds the same numeric code to the invited email',()=>{
    expect(invitationCodeHash('alice@example.test','012345')).not.toBe(invitationCodeHash('bob@example.test','012345'));
    expect(invitationCodeHash('Alice@Example.test','012345')).toBe(invitationCodeHash('alice@example.test','012345'));
    expect(invitationCodeHash('alice@example.test','012345')).not.toBe(createHash('sha256').update('012345').digest('hex'));
  });
  it('keeps the digest of previously issued long codes compatible',()=>{
    const old='x'.repeat(43);
    expect(invitationCodeHash('alice@example.test',old)).toBe(createHash('sha256').update(old).digest('hex'));
  });
});
