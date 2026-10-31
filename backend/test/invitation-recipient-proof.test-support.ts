import { vi } from "vitest";
import * as appConfig from "../src/config.js";
import * as emailTransport from "../src/common/email-transport.js";
import type { OperationsService } from "../src/operations/operations.service.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

// Config and transport exports are process-local test spies. Serialise their
// short lifetimes even when a fixture creates several invitees concurrently.
let mailboxQueue: Promise<void> = Promise.resolve();
// Recipient inbox memory only. A rolled-back acceptance may reread the same
// already-delivered code during the production send cooldown; no new proof is
// issued, accepted or written by the helper.
const mailboxMessages = new Map<string, string>();

/**
 * A synthetic mailbox receives the real recipient challenge in an isolated test.
 * Nothing is seeded into the invitation record and no runtime/manual/demo
 * endpoint discloses this proof. Ordinary fixtures still execute the same issue,
 * delivery and acceptance checks as a recipient using the application.
 */
export async function invitationRecipientProof(
  operations: Pick<OperationsService, "recipientProof">,
  invitation: { email: string; token: string },
): Promise<string | undefined> {
  let release!: () => void;
  const preceding = mailboxQueue;
  mailboxQueue = new Promise<void>((resolve) => { release = resolve; });
  await preceding;
  try {
    if (process.env.TEST_DATABASE_ISOLATED !== "true")
      throw new Error("Synthetic invitation mailboxes are restricted to isolated integration tests.");
    const settings = appConfig.config();
    requireIsolatedTestDatabaseUrl(settings.DATABASE_URL);
    const recipient = invitation.email.trim().toLowerCase();
    if (!recipient.endsWith("@example.test"))
      throw new Error("Synthetic invitation mailboxes require an explicit example.test recipient.");
    const mailboxKey = JSON.stringify([recipient, invitation.token.trim()]);

    // Preserve a caller's pre-existing config spy instead of restoring it away.
    const wasConfigMocked = vi.isMockFunction(appConfig.config);
    const previousImplementation = wasConfigMocked ? vi.mocked(appConfig.config).getMockImplementation() : undefined;
    const configSpy = vi.spyOn(appConfig, "config").mockReturnValue({ ...settings, INVITATION_EMAIL_ENABLED: true });
    let proof = "", deliveries = 0;
    const wasTransportMocked = vi.isMockFunction(emailTransport.sendTransactionalEmail);
    const previousTransport = wasTransportMocked ? vi.mocked(emailTransport.sendTransactionalEmail).getMockImplementation() : undefined;
    const transportSpy = vi.spyOn(emailTransport, "sendTransactionalEmail").mockImplementation((message) => {
      if (message.to.trim().toLowerCase() !== recipient)
        throw new Error("An invitation fixture attempted to send to a different mailbox.");
      const code = /Your confirmation code is:\s*(\d{6})(?:\s|$)/.exec(message.text)?.[1];
      if (!code) throw new Error("The recipient-proof email did not contain its expected confirmation code.");
      proof = code;
      deliveries += 1;
      return Promise.resolve();
    });
    try {
      const result = await operations.recipientProof({ email: invitation.email, token: invitation.token });
      if (!result.verification_required) {
        if (deliveries !== 0) throw new Error("An invitation that needs no mailbox proof must not send one.");
        return undefined;
      }
      const deliveredProof = mailboxMessages.get(mailboxKey);
      if (result.delivery === "cooldown" && deliveries === 0 && deliveredProof) {
        if (JSON.stringify(result).includes(deliveredProof))
          throw new Error("The public recipient-proof response must not expose the mailbox code.");
        return deliveredProof;
      }
      if (result.delivery !== "email_accepted" || deliveries !== 1 || !proof)
        throw new Error("Expected one recipient-proof email through the ordinary invitation service.");
      if (JSON.stringify(result).includes(proof))
        throw new Error("The public recipient-proof response must not expose the mailbox code.");
      mailboxMessages.set(mailboxKey, proof);
      return proof;
    } finally {
      if (wasTransportMocked && previousTransport) transportSpy.mockImplementation(previousTransport);
      else transportSpy.mockRestore();
      if (wasConfigMocked && previousImplementation) configSpy.mockImplementation(previousImplementation);
      else configSpy.mockRestore();
    }
  } finally {
    release();
  }
}

/** Complete a normal invitation using the synthetic recipient mailbox above. */
export async function acceptWithRecipientProof(
  operations: Pick<OperationsService, "recipientProof" | "acceptInvite">,
  acceptance: { email: string; token: string; [key: string]: unknown },
) {
  const proof = await invitationRecipientProof(operations, acceptance);
  return operations.acceptInvite({ ...acceptance, ...(proof ? { recipient_proof: proof } : {}) });
}
