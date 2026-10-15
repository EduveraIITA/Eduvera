import { invitationTemplate } from "./invitation-template.js";
import { Logger } from "@nestjs/common";
import { sendTransactionalEmail } from "./email-transport.js";
import { config } from "../config.js";

const logger = new Logger("AccountEmail");

export async function deliverAccountAction(input: {
  email: string;
  token: string;
  purpose: "email_verification" | "password_reset";
  expiresAt: Date;
}) {
  const settings = config();
  if (!settings.INVITATION_EMAIL_ENABLED) {
    return {
      delivery: "manual" as const,
      ...(settings.DEMO_MODE && settings.NODE_ENV !== "production" ? { development_token: input.token } : {}),
    };
  }
  const path = input.purpose === "email_verification" ? "/account/security" : "/reset-password";
  const link = new URL(path, settings.PUBLIC_URL);
  link.searchParams.set("token", input.token);
  const verify = input.purpose === "email_verification";
  try {
    await sendTransactionalEmail({
      senderName: "ThatCampus",
      to: input.email,
      subject: verify ? "Verify your ThatCampus email" : "Reset your ThatCampus password",
      html: invitationTemplate({email: input.email, token: "", expires_at: input.expiresAt, publicUrl: link.origin,
        action: {title: verify ? "Verify your email" : "Reset your password", description: verify ? "Confirm your email address to continue to your workspace." : "We received a request to reset your password. Choose a new password using the secure button below. This link expires in 30 minutes.", label: verify ? "Verify email" : "Reset password", url: link.href}}).html,
      text: `${verify ? "Verify your email address" : "Reset your password"} using this single-use link:\n\n${link.href}\n\nThe link expires ${input.expiresAt.toISOString()}. If you did not request this, ignore this message.`,
    });
    return { delivery: "email_accepted" as const };
  } catch {
    logger.warn("Account email was not confirmed by SMTP; no token was written to logs.");
    return { delivery: "failed" as const };
  }
}
