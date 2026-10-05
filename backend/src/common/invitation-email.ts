import { Logger } from '@nestjs/common';
import { sendTransactionalEmail } from './email-transport.js';
import { config } from '../config.js';

const logger = new Logger('InvitationEmail');
type Invitation = { email: string; token: string; expires_at: Date | string };

// Return only allowlisted categories. SMTP messages can contain credentials,
// recipient addresses and message contents and must never reach logs or clients.
export function invitationEmailFailure(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'EAPI_AUTH') return { code: 'authentication', message: 'The email provider rejected the API key or sender. Ask the administrator to check the API key and verified sender domain.' };
  if (code === 'EAUTH') return { code: 'authentication', message: 'The mail provider rejected the sender credentials. Ask the administrator to configure a valid app password.' };
  if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'ECONNRESET', 'EDNS', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(code))) {
    return { code: 'connection', message: 'The server could not connect to the mail provider. Ask the administrator to check outbound SMTP access; Railway requires Pro or above for SMTP.' };
  }
  if (code === 'EENVELOPE') return { code: 'recipient', message: 'The mail provider rejected the recipient. Check the email address.' };
  return { code: 'provider', message: 'The mail provider did not confirm delivery. Ask the administrator to check the email configuration.' };
}

/** Called only after the invitation transaction commits. Never log codes or SMTP errors. */
export async function deliverInvitation<T extends Invitation>(invitation: T) {
  const settings = config();
  if (!settings.INVITATION_EMAIL_ENABLED) {
    return { ...invitation, delivery: 'manual' as const };
  }
  const joinUrl = new URL('/join', settings.PUBLIC_URL).href;
  const subject = 'Your invitation to Eduera';
  const text = `You have been invited to join your institution on Eduera.\n\nOpen: ${joinUrl}\nEmail: ${invitation.email}\nInvitation code: ${invitation.token}\nExpires: ${new Date(invitation.expires_at).toISOString()}\n\nUse the same email and enter this single-use code. For an existing account, use your current password. Do not forward this code. If you were not expecting this invitation, you can ignore this email.`;
  try {
    await sendTransactionalEmail({to: invitation.email, subject, text, senderName: 'Eduera · Pathyakram'});
    return { ...invitation, delivery: 'email_accepted' as const };
  } catch (error) {
    const failure = invitationEmailFailure(error);
    logger.warn(`Invitation email failed (${failure.code}). Use the private code or create a replacement invitation.`);
    return { ...invitation, delivery: 'failed' as const, delivery_error: failure.code, delivery_message: failure.message };
  }
}
