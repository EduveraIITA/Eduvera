import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({sendMail: vi.fn(), close: vi.fn(), createTransport: vi.fn(), settings: {
  INVITATION_EMAIL_ENABLED: true, INVITATION_EMAIL_PROVIDER: 'smtp', RESEND_API_KEY: 'test-api-key', INVITATION_EMAIL_FROM: 'sender@example.test', SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: 465,
  SMTP_USER: 'sender@example.test', SMTP_PASSWORD: 'test-only-secret', PUBLIC_URL: 'https://school.example.test',
}}));
vi.mock('../src/config.js', () => ({config: () => mocks.settings}));
vi.mock('nodemailer', () => ({default: {createTransport: mocks.createTransport}}));
import { deliverInvitation, invitationEmailFailure } from '../src/common/invitation-email.js';
import { invitationTemplate } from '../src/common/invitation-template.js';
import { sendTransactionalEmail } from '../src/common/email-transport.js';
const invitation = {email: 'recipient@example.test', token: 'private-code', expires_at: '2099-10-04T00:00:00Z'};
beforeEach(() => {
  vi.unstubAllGlobals(); vi.clearAllMocks(); mocks.settings.INVITATION_EMAIL_PROVIDER = 'smtp'; mocks.settings.INVITATION_EMAIL_ENABLED = true; mocks.settings.SMTP_PORT = 465;
  mocks.createTransport.mockReturnValue({sendMail: mocks.sendMail, close: mocks.close});
  mocks.sendMail.mockResolvedValue({accepted: [invitation.email], rejected: []});
});
describe('invitation SMTP delivery', () => {
  it('sends PDF attachments with both providers',async()=>{
    const input={to:invitation.email,subject:'Payment confirmed',text:'Test receipt',senderName:'Eduera',attachments:[{filename:'receipt.pdf',contentType:'application/pdf',content:Buffer.from('%PDF-test').toString('base64')}]};
    await sendTransactionalEmail(input);
    expect(mocks.sendMail.mock.calls[0]![0].attachments[0]).toMatchObject({filename:'receipt.pdf',contentType:'application/pdf',encoding:'base64',contentDisposition:'attachment'});
    mocks.settings.INVITATION_EMAIL_PROVIDER='resend';
    const fetchMock=vi.fn().mockResolvedValue({ok:true,json:()=>Promise.resolve({id:'mail-id'})});vi.stubGlobal('fetch',fetchMock);
    await sendTransactionalEmail(input);expect(JSON.parse(fetchMock.mock.calls[0]![1].body).attachments[0]).toMatchObject({filename:'receipt.pdf',content_type:'application/pdf'});
  });
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
    expect(body.html).toContain('Accept Invitation');
    expect(body.html).toContain(invitation.token);
    expect(body.attachments[0]).toMatchObject({filename:'eduera-logo.png',content_type:'image/png',content_id:'eduera-logo'});
    expect(Buffer.from(body.attachments[0].content,'base64').subarray(1,4).toString()).toBe('PNG');
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
    expect(mocks.sendMail.mock.calls[0]![0].html).toContain('Accept Invitation');
    expect(mocks.sendMail.mock.calls[0]![0].attachments[0]).toMatchObject({cid:'eduera-logo',contentDisposition:'inline',encoding:'base64',contentType:'image/png'});
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
  it('escapes message values and confines prefill to link fragments', () => {
    const message = invitationTemplate({...invitation, token: '<script>private&code</script>', email: '"quoted"@example.test', publicUrl: 'https://school.example.test'});
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain('&lt;script&gt;private&amp;code&lt;/script&gt;');
    const links=[...message.html.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1]!.replaceAll('&amp;','&')));
    expect(links).toHaveLength(2);
    for(const link of links){
      expect(link.origin+link.pathname).toBe('https://school.example.test/join');
      expect(link.search).toBe('');
      const params=new URLSearchParams(link.hash.slice(1));
      expect(params.get('token')).toBe('<script>private&code</script>');
      expect(params.get('email')).toBe('"quoted"@example.test');
    }
    expect(message.html).not.toMatch(/<script|<form/i);
    expect(message.html.match(/src="[^"]+"/g)).toEqual(['src="cid:eduera-logo"']);
    expect(message.html).toContain('alt="Eduera logo" width="48" height="48"');
    expect(message.text).toContain('<script>private&code</script>');
    expect(message.html).toContain('Oct 4, 2099, 12:00 AM UTC');
    expect(message.text).toContain('2099-10-04T00:00:00.000Z');
  });
  it('uses the reference layout with the unchanged logo and a selectable six-digit code', () => {
    const message = invitationTemplate({...invitation, token: '012345', publicUrl: 'https://school.example.test'});
    expect(message.html).toContain('INVITATION CODE');
    expect(message.html).toContain('SINGLE-USE');
    expect(message.html).toContain('>012345</p>');
    expect(message.html).toContain('Your email and code are filled in automatically when you accept.');
    expect(message.html).toContain('Open direct join portal');
    expect(message.html).toContain('max-width:480px');
    expect(message.html).not.toMatch(/<button|onclick|navigator.clipboard|Help Center|Eduera Inc/i);
    expect(message.inlineImages).toHaveLength(1);
    expect(message.inlineImages[0]).toMatchObject({filename:'eduera-logo.png',cid:'eduera-logo'});
    expect(message.text).toContain('Invitation code: 012345');
    const link=new URL(message.text.match(/Open: (.+)/)![1]!);
    expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe('012345');
    // PNG IHDR color type 6 carries alpha; the old app icon was opaque RGB.
    expect(Buffer.from(message.inlineImages[0]!.content,'base64')[25]).toBe(6);
  });
});
