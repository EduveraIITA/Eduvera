import { Logger } from "@nestjs/common";
import nodemailer from "nodemailer";
import { config } from "../config.js";

const logger = new Logger("AccountEmail");

function transport() {
  const settings = config();
  return nodemailer.createTransport({
    host: settings.SMTP_HOST,
    port: settings.SMTP_PORT,
    secure: settings.SMTP_PORT === 465,
    requireTLS: settings.SMTP_PORT !== 465,
    auth: { user: settings.SMTP_USER, pass: settings.SMTP_PASSWORD },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
    tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}

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
  const mailer = transport();
  const path = input.purpose === "email_verification" ? "/account/security" : "/reset-password";
  const link = new URL(path, settings.PUBLIC_URL);
  link.searchParams.set("token", input.token);
  const verify = input.purpose === "email_verification";
  try {
    const result = await mailer.sendMail({
      from: { name: "Eduvera · Pathyakram", address: settings.SMTP_USER! },
      to: input.email,
      subject: verify ? "Verify your Eduvera email" : "Reset your Eduvera password",
      text: `${verify ? "Verify your email address" : "Reset your password"} using this single-use link:\n\n${link.href}\n\nThe link expires ${input.expiresAt.toISOString()}. If you did not request this, ignore this message.`,
    });
    if (!result.accepted?.length || result.rejected?.length) throw new Error("Recipient rejected");
    return { delivery: "email_accepted" as const };
  } catch {
    logger.warn("Account email was not confirmed by SMTP; no token was written to logs.");
    return { delivery: "failed" as const };
  } finally {
    mailer.close();
  }
}
