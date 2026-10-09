import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn(), settings: {
  INVITATION_EMAIL_ENABLED: true, INVITATION_EMAIL_PROVIDER: 'smtp', RESEND_API_KEY: 'test-api-key', INVITATION_EMAIL_FROM: 'sender@example.test', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 465,
  SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only-secret', PUBLIC_URL: 'https://school.example.test',
}}));
vi.mock('../src/config.js', () => ({config: () => mocks.settings}));
vi.mock('nodemailer', () => ({default: {createTransport: mocks.createTransport}}));
import { deliverInvitation, invitationEmailFailure } from '../src/common/invitation-email.js';
import { invitationTemplate } from '../src/common/invitation-template.js';
const invitation = {email: 'recipient@example.test', token: 'private-code', expires_at: '2099-10-04T00:00:00Z'};
beforeEach(() => {
  vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.settings.INVITATION_EMAIL_PROVIDER = 'smtp'; mocks.settings.INVITATION_EMAIL_ENABLED = true; mocks.settings.SMTP_PORT = 465;
  mocks.createTransport.mockReturnValue({sendMail: mocks.sendMail, close: mocks.close});
  mocks.sendMail.mockResolvedValue({accepted: [invitation.email], rejected: []});
});
describe('invitation SMTP delivery', () => {
  it('returns only safe categories for SMTP authentication and network failures', () => {
    expect(invitationEmailFailure({code:'EAUTH',message:'secret-password'}).code).toBe('authentication');
    expect(invitationEmailFailure({code:'ETIMEDOUT',message:'private-recipient'}).code).toBe('connection');
    expect(JSON.stringify(invitationEmailFailure({code:'secret-code',message:'secret-password'}))).not.toContain('secret');
  });
  it('sends through HTTPS without opening an SMTP connection', async () => {
    mocks.settings.INVITATION_EMAIL_PROVIDER = 'resend';
    const fetchMock = vi.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({id:'provider-message-id'})});
    vi.stubGlobal('fetch',fetchMock);
    expect((await deliverInvitation(invitation)).delivery).toBe('email_accepted');
    expect(mocks.createTransport).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails',expect.objectContaining({method:'POST',redirect:'error'}));
    const body=JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.to).toEqual([invitation.email]);
    expect(body.text).toContain(invitation.token);
    expect(body.html).toContain('Accept invitation');
    expect(body.html).toContain(invitation.token);
  });
  it('reports API authentication failures without exposing the response body', async () => {
    mocks.settings.INVITATION_EMAIL_PROVIDER = 'resend';
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:403,json:()=>Promise.resolve({message:'secret-password'})}));
    const result=await deliverInvitation(invitation);
    expect(result).toMatchObject({delivery:'failed',delivery_error:'authentication'});
    expect(JSON.stringify(result)).not.toContain('secret-password');
  });
  it('does not claim API acceptance without a message ID', async () => {
    mocks.settings.INVITATION_EMAIL_PROVIDER = 'resend';
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({})}));
    expect((await deliverInvitation(invitation)).delivery).toBe('failed');
  });
  it('uses TLS, sends the private code and reports SMTP acceptance without claiming inbox delivery', async () => {
    expect(await deliverInvitation(invitation)).toEqual({...invitation, delivery: 'email_accepted'});
    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({secure: true, tls: {minVersion: 'TLSv1.2', rejectUnauthorized: true}, debug: false}));
    expect(mocks.sendMail).toHaveBeenCalledWith(expect.objectContaining({to: invitation.email, text: expect.stringContaining('https://school.example.test/join')}));
    expect(mocks.sendMail.mock.calls[0]![0].text).toContain(invitation.token);
    expect(mocks.sendMail.mock.calls[0]![0].html).toContain('Accept invitation');
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
    expect(await deliverInvitation(invitation)).toMatchObject({...invitation, delivery: 'failed', delivery_error: 'provider'});
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('does not report acceptance for a rejected recipient', async () => {
    mocks.sendMail.mockResolvedValue({accepted: [], rejected: [invitation.email]});
    expect((await deliverInvitation(invitation)).delivery).toBe('failed');
  });
  it('escapes message values and keeps codes out of links and remote resources', () => {
    const message = invitationTemplate({...invitation, token: '<script>private&code</script>', email: '"quoted"@example.test', publicUrl: 'https://school.example.test'});
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;private&amp;code&lt;/script&gt;');
    expect(message.html).toContain('&quot;quoted&quot;@example.test');
    expect(message.html.match(/href="[^"]+"/g)).toEqual(['href="https://school.example.test/join"', 'href="https://school.example.test/join"']);
    expect(message.html).not.toMatch(/<img|<script|<form/i);
    expect(message.text).toContain('<script>private&code</script>');
    expect(message.html).toContain('2099-10-04T00:00:00.000Z');
  });
});
