import { describe, expect, it } from "vitest";
import { acceptedDomainEventSchema } from "../src/campus-model-core/contracts.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("communication domain event contract", () => {
  it("accepts privacy-safe agent participation without chat content", () => {
    const event = acceptedDomainEventSchema.parse({
      school_id: id,
      source_outbox_event_id: "00000000-0000-4000-8000-000000000002",
      event_type: "communication.message.sent",
      subject: {
        kind: "communication_message", domain: "communication", domain_id: "00000000-0000-4000-8000-000000000003",
        label: "School message", lifecycle_state: "active", source_revision: 1, metadata: {},
      },
      context: {
        kind: "conversation", domain: "communication", domain_id: "00000000-0000-4000-8000-000000000004",
        label: "School conversation", lifecycle_state: "active", source_revision: 1, metadata: {},
      },
      actor_user_id: "00000000-0000-4000-8000-000000000005",
      audience_user_ids: ["00000000-0000-4000-8000-000000000006"],
      occurred_at: "2026-10-17T10:00:00.000Z",
      effective_from: "2026-10-17T10:00:00.000Z",
      effective_until: null,
      source_domain: "communication",
      source_record_id: "00000000-0000-4000-8000-000000000003",
      source_revision: 1,
      correlation_id: "00000000-0000-4000-8000-000000000007",
      causation_event_id: null,
      idempotency_key: "communication-message-sent:message-1",
      payload: { has_attachment: false, recipient_count: 1 },
    });
    expect(event.event_type).toBe("communication.message.sent");
    expect(JSON.stringify(event)).not.toContain("message body");
  });

  it("rejects duplicate audience agents", () => {
    const base = {
      school_id: id, source_outbox_event_id: "00000000-0000-4000-8000-000000000002",
      event_type: "communication.message.sent",
      subject: { kind: "communication_message", domain: "communication", domain_id: id, label: "Message", lifecycle_state: "active", source_revision: 1, metadata: {} },
      context: null, actor_user_id: "00000000-0000-4000-8000-000000000005",
      occurred_at: "2026-10-17T10:00:00.000Z", effective_from: "2026-10-17T10:00:00.000Z", effective_until: null,
      source_domain: "communication", source_record_id: id, source_revision: 1,
      correlation_id: "00000000-0000-4000-8000-000000000007", causation_event_id: null,
      idempotency_key: "communication-message-sent:message-1", payload: {},
    };
    expect(() => acceptedDomainEventSchema.parse({ ...base, audience_user_ids: [id, id] })).toThrow(/unique/i);
  });
});
