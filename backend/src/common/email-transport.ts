import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { assertLiveExternalEffect } from './simulation-effects.js';
import { captureSimulationProviderEffect, simulationLogicalDigest } from './simulation-resources.js';

/** No retries here: a timeout may occur after provider acceptance. Never log raw errors. */
export async function sendTransactionalEmail(input: {to: string; subject: string; text: string; html?: string; senderName: string; idempotencyKey?: string; inlineImages?: Array<{filename:string;contentType:string;cid:string;content:string}>; attachments?: Array<{filename:string;contentType:string;content:string}>}): Promise<void | {provider_message_id: string | undefined}> {
  if (await captureSimulationProviderEffect({ kind: 'external_notification', provider: 'email', operation: 'send',
    logicalKey: input.to, payload: { content_digest: simulationLogicalDigest(JSON.stringify({ subject: input.subject,
      text: input.text, html: input.html })), attachment_count: (input.inlineImages?.length ?? 0) + (input.attachments?.length ?? 0),
      evidence_mode: 'simulation', delivered_externally: false } })) return;
  assertLiveExternalEffect("Email delivery");
  if (input.idempotencyKey && !/^[A-Za-z0-9/_-]{1,128}$/.test(input.idempotencyKey)) throw new Error('Invalid email delivery identity');
  const settings = config();
  if (settings.INVITATION_EMAIL_PROVIDER === 'resend') {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: {Authorization: `Bearer ${settings.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'User-Agent': 'ThatCampus/1.0', ...(input.idempotencyKey ? {'Idempotency-Key':input.idempotencyKey} : {})},
      body: JSON.stringify({from: `${input.senderName} <${settings.INVITATION_EMAIL_FROM}>`, to: [input.to], subject: input.subject, text: input.text, html: input.html, ...((input.inlineImages?.length || input.attachments?.length)?{attachments:[...(input.inlineImages??[]).map(image=>({filename:image.filename,content:image.content,content_type:image.contentType,content_id:image.cid})),...(input.attachments??[]).map(file=>({filename:file.filename,content:file.content,content_type:file.contentType}))]}:{})}),
    });
    if (!response.ok) throw Object.assign(new Error('Email API rejected request'), {code: [401,403].includes(response.status) ? 'EAPI_AUTH' : 'EAPI'});
    const result = await response.json() as {id?: unknown};
    if (typeof result.id !== 'string' || !result.id) throw new Error('Email API did not confirm acceptance');
    return { provider_message_id: result.id };
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
    const result = await transport.sendMail({from: {name: input.senderName, address: settings.INVITATION_EMAIL_FROM ?? settings.SMTP_USER!}, to: input.to, subject: input.subject, text: input.text, html: input.html, ...(input.idempotencyKey ? {messageId:`<${input.idempotencyKey.replaceAll('/','.') }@thatcampus.com>`} : {}), attachments:[...(input.inlineImages??[]).map(image=>({filename:image.filename,content:image.content,encoding:"base64",contentType:image.contentType,cid:image.cid,contentDisposition:"inline" as const})),...(input.attachments??[]).map(file=>({filename:file.filename,content:file.content,encoding:"base64",contentType:file.contentType,contentDisposition:"attachment" as const}))]});
    if (!result.accepted?.length || result.rejected?.length) throw Object.assign(new Error('Recipient rejected'), {code: 'EENVELOPE'});
    return { provider_message_id: result.messageId };
  } finally {transport.close();}
}
