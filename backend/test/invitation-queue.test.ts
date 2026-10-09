import { afterEach, expect, it, vi } from 'vitest';
import * as configuration from '../src/config.js';
import { sealInvitationCode, openInvitationCode } from '../src/common/invitation-queue.js';
import { SpaController } from '../src/spa.controller.js';
import type { FastifyReply } from 'fastify';

afterEach(()=>vi.restoreAllMocks());
it('encrypts leading-zero codes with random nonces and authenticates the invitation ID',()=>{
  vi.spyOn(configuration,'config').mockReturnValue({COOKIE_SECRET:'test-only-cookie-key-which-is-long-enough'} as ReturnType<typeof configuration.config>);
  const a=sealInvitationCode('012345','first');const b=sealInvitationCode('012345','first');
  expect(a).not.toBe(b);expect(Buffer.from(a,'base64').toString()).not.toContain('012345');
  expect(openInvitationCode(a,'first')).toBe('012345');
  expect(()=>openInvitationCode(a,'second')).toThrow();
  const corrupted=Buffer.from(a,'base64');corrupted[30]=corrupted[30]!^1;
  expect(()=>openInvitationCode(corrupted.toString('base64'),'first')).toThrow();
});
it('serves the original transparent PNG inline at a public cacheable asset URL',()=>{
  const reply={header:vi.fn().mockReturnThis(),type:vi.fn().mockReturnThis(),send:vi.fn()};
  new SpaController().emailLogo(reply as unknown as FastifyReply);
  expect(reply.type).toHaveBeenCalledWith('image/png');
  expect(reply.header).toHaveBeenCalledWith('Content-Disposition','inline');
  const png=reply.send.mock.calls[0]![0] as Buffer;
  expect(png.subarray(1,4).toString()).toBe('PNG');expect(png[25]).toBe(6);
});
