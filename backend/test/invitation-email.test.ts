import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn(), settings: {
  INVITATION_EMAIL_ENABLED: true, SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 465,
  SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only-secret', PUBLIC_URL: 'https://school.example.test',
}}));
vi.mock('../src/config.js', () => ({config: () => mocks.settings}));
vi.mock('nodemailer', () => ({default: {createTransport: mocks.createTransport}}));
import { deliverInvitation } from '../src/common/invitation-email.js';
const invitation = {email: 'recipient@example.test', token: 'private-code', expires_at: '2099-10-04T00:00:00Z'};
beforeEach(() => {
  vi.clearAllMocks(); mocks.settings.INVITATION_EMAIL_ENABLED = true; mocks.settings.SMTP_PORT = 465;
  mocks.createTransport.mockReturnValue({sendMail: mocks.sendMail, close: mocks.close});
  mocks.sendMail.mockResolvedValue({accepted: [invitation.email], rejected: []});
});
describe('invitation SMTP delivery', () => {
  it('uses TLS, sends the private code and reports SMTP acceptance without claiming inbox delivery', async () => {
    expect(await deliverInvitation(invitation)).toEqual({...invitation, delivery: 'email_accepted'});
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({secure: true, tls: {minVersion: 'TLSv1.2', rejectUnauthorized: true}, debug: false}));
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({to: invitation.email, text: expect.stringContaining('https://school.example.test/join')}));
    expect(mocks.sendMail.mock.calls[0]![0].text).toContain(invitation.token);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('does not contact SMTP in manual mode', async () => {
    mocks.settings.INVITATION_EMAIL_ENABLED = false;
    expect((await deliverInvitation(invitation)).delivery).toBe('manual');
    expect(mocks.createTransport).not.toHaveBeenCalled();
  });
  it('requires STARTTLS on port 587', async () => {
    mocks.settings.SMTP_PORT = 587; await deliverInvitation(invitation);
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({secure: false, requireTLS: true}));
  });
  it('preserves the committed invitation when authentication or transport fails', async () => {
    mocks.sendMail.mockRejectedValue(new Error('Sensitive SMTP diagnostic'));
    expect(await deliverInvitation(invitation)).toEqual({...invitation, delivery: 'failed'});
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('does not report acceptance for a rejected recipient', async () => {
    mocks.sendMail.mockResolvedValue({accepted: [], rejected: [invitation.email]});
    expect((await deliverInvitation(invitation)).delivery).toBe('failed');
  });
});
