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
      senderName: "Eduvera · Pathyakram",
      to: input.email,
      subject: verify ? "Verify your Eduvera email" : "Reset your Eduvera password",
      text: `${verify ? "Verify your email address" : "Reset your password"} using this single-use link:\n\n${link.href}\n\nThe link expires ${input.expiresAt.toISOString()}. If you did not request this, ignore this message.`,
    });
    return { delivery: "email_accepted" as const };
  } catch {
    logger.warn("Account email was not confirmed by SMTP; no token was written to logs.");
    return { delivery: "failed" as const };
  }
}
