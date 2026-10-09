import nodemailer from 'nodemailer';
import { config } from '../config.js';

/** No retries here: a timeout may occur after provider acceptance. Never log raw errors. */
export async function sendTransactionalEmail(input: {to: string; subject: string; text: string; html?: string; senderName: string}) {
  const settings = config();
  if (settings.INVITATION_EMAIL_PROVIDER === 'resend') {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${settings.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'Eduera/1.0'},
      body: JSON.stringify({from: `${input.senderName} <${settings.INVITATION_EMAIL_FROM}>`, to: [input.to], subject: input.subject, text: input.text, html: input.html}),
    });
    if (!response.ok) throw Object.assign(new Error('Email API rejected request'), {code: [401,403].includes(response.status) ? 'EAPI_AUTH' : 'EAPI'});
    const result = await response.json() as {id?: unknown};
    if (typeof result.id !== 'string' || !result.id) throw new Error('Email API did not confirm acceptance');
    return;
  }
  const transport = nodemailer.createTransport({
    host: settings.SMTP_HOST, port: settings.SMTP_PORT,
    secure: settings.SMTP_PORT === 465, requireTLS: settings.SMTP_PORT !== 465,
    auth: {user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD},
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    tls: {minVersion: 'TLSv1.2', rejectUnauthorized: true},
    disableFileAccess: true, disableUrlAccess: true, logger: false, debug: false,
  });
  try {
    const result = await transport.sendMail({from: {name: input.senderName, address: settings.SMTP_USER!}, to: input.to, subject: input.subject, text: input.text, html: input.html});
    if (!result.accepted?.length || result.rejected?.length) throw Object.assign(new Error('Recipient rejected'), {code: 'EENVELOPE'});
  } finally {transport.close();}
}
