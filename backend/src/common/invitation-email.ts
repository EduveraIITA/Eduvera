import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { config } from '../config.js';

const logger = new Logger('InvitationEmail');
type Invitation = { email: string; token: string; expires_at: Date | string };

/** Called only after the invitation transaction commits. Never log codes or SMTP errors. */
export async function deliverInvitation<T extends Invitation>(invitation: T) {
  const settings = config();
  if (!settings.INVITATION_EMAIL_ENABLED) {
    return { ...invitation, delivery: 'manual' as const };
  }
  const transport = nodemailer.createTransport({
    host: settings.SMTP_HOST,
    port: settings.SMTP_PORT,
    secure: settings.SMTP_PORT === 465,
    requireTLS: settings.SMTP_PORT !== 465,
    auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  try {
    const joinUrl = new URL('/join', settings.PUBLIC_URL).href;
    const result = await transport.sendMail({
      from: { name: 'Eduera · Pathyakram', address: settings.SMTP_USER! },
      to: invitation.email,
      subject: 'Your invitation to Eduera',
      text: `You have been invited to join your institution on Eduera.\n\nOpen: ${joinUrl}\nEmail: ${invitation.email}\nInvitation code: ${invitation.token}\nExpires: ${new Date(invitation.expires_at).toISOString()}\n\nUse the same email and enter this single-use code. For an existing account, use your current password. Do not forward this code. If you were not expecting this invitation, you can ignore this email.`,
    });
    if (!result.accepted?.length || result.rejected?.length) throw new Error('Recipient rejected');
    return { ...invitation, delivery: 'email_accepted' as const };
  } catch {
    logger.warn('Invitation email was not confirmed by SMTP. Use the private code or create a replacement invitation.');
    return { ...invitation, delivery: 'failed' as const };
  } finally {
    transport.close();
  }
}
