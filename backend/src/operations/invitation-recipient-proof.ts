import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

/** Separate from the invitation credential: only the intended mailbox receives this code. */
export function invitationRecipientProofHash(invitationId: string, tokenHash: string, code: string) {
  return createHmac("sha256", config().COOKIE_SECRET)
    .update(`invitation-recipient-v1:${invitationId}:${tokenHash}:${code}`).digest("hex");
}

export function invitationRecipientProofMatches(retainedHash: string | null, invitationId: string, tokenHash: string, code: string | undefined) {
  if (!retainedHash || !/^[a-f0-9]{64}$/.test(retainedHash) || !code || !/^\d{6}$/.test(code)) return false;
  return timingSafeEqual(Buffer.from(retainedHash, "hex"), Buffer.from(invitationRecipientProofHash(invitationId, tokenHash, code), "hex"));
}
