import { invitationTemplate } from "./invitation-template.js";
import { ForbiddenException, Logger } from "@nestjs/common";
import { sendTransactionalEmail } from "./email-transport.js";
import { config } from "../config.js";
import { invitationEmailFailure } from './invitation-email.js';
import { executionEnvironmentStorage } from '../campus-model-core/execution-time.runtime.js';

const logger = new Logger("AccountEmail");
export type AccountMailPurpose = 'email_verification' | 'password_reset';

/** Deployment availability, never a fact about a requested email/account. */
export function accountEmailMode(): "email" | "development" | "unavailable" {
  const settings = config();
  if (settings.INVITATION_EMAIL_ENABLED) return "email";
  return settings.DEMO_MODE && settings.NODE_ENV !== "production" ? "development" : "unavailable";
}

export async function deliverAccountAction(input: {
  email: string;
  token: string;
  purpose: AccountMailPurpose;
  expiresAt: Date;
  idempotencyKey?: string;
}) {
  if (executionEnvironmentStorage.getStore()?.kind === 'simulation')
    throw new ForbiddenException('Account verification and password recovery are managed in Live. No Live provider was accessed.');
  const settings = config();
  const mode = accountEmailMode();
  if (mode === "unavailable") return { delivery: "unavailable" as const };
  if (mode === "development") return { delivery: "manual" as const, development_token: input.token };
  const path = input.purpose === "email_verification" ? "/account/security" : "/reset-password";
  const link = new URL(path, settings.PUBLIC_URL);
  link.hash = new URLSearchParams({ token: input.token }).toString();
  const verify = input.purpose === "email_verification";
  try {
    const receipt = await sendTransactionalEmail({
      senderName: "ThatCampus",
      to: input.email,
      ...(input.idempotencyKey ? {idempotencyKey: input.idempotencyKey} : {}),
      subject: verify ? "Verify your ThatCampus email" : "Reset your ThatCampus password",
      html: invitationTemplate({email: input.email, token: "", expires_at: input.expiresAt, publicUrl: link.origin,
        action: {title: verify ? "Verify your email" : "Reset your password", description: verify ? "Confirm your email address to continue to your workspace." : "We received a request to reset your password. Choose a new password using the secure button below. This link expires in 30 minutes.", label: verify ? "Verify email" : "Reset password", url: link.href}}).html,
      text: `${verify ? "Verify your email address" : "Reset your password"} using this single-use link:\n\n${link.href}\n\nThe link expires ${input.expiresAt.toISOString()}. If you did not request this, ignore this message.`,
    });
    return { delivery: "email_accepted" as const, ...(receipt?.provider_message_id ? {provider_message_id: receipt.provider_message_id} : {}) };
  } catch (error) {
    logger.warn("Account email was not confirmed by the mail provider; no token was written to logs.");
    return { delivery: "failed" as const, failure_category: invitationEmailFailure(error).code };
  }
}
