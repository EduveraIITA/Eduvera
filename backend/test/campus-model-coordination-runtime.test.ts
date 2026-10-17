import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acceptedCoordinationEventSchema,
  coordinationRecipientAgentRefSchema,
  coordinationRecipientSelectorConfigSchema,
  operationalMessageOutcomeSchema,
  recipientOperationalMessageResponseSchema,
} from "../src/campus-model-core/contracts.js";

const schoolId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const recipientId = "00000000-0000-4000-8000-000000000003";
const outboxId = "00000000-0000-4000-8000-000000000004";
const messageId = "00000000-0000-4000-8000-000000000005";

const migration = readFileSync(resolve(process.cwd(), "migrations/106_campus_model_coordination_runtime.sql"), "utf8");
const service = readFileSync(new URL("../src/campus-model-core/campus-model-core.service.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/campus-model-core/campus-model-core.module.ts", import.meta.url), "utf8");

describe("Campus Model Core coordination contracts", () => {
  it("requires an accepted outbox event and explicit recipient selector input", () => {
    const parsed = acceptedCoordinationEventSchema.parse({
      school_id: schoolId,
      source_outbox_event_id: outboxId,
      event_kind: "domain_event",
      event_type: "staff.leave_submitted",
      subject: {
        kind: "staff_leave",
        domain: "staff_operations",
        domain_id: "00000000-0000-4000-8000-000000000006",
        label: "Leave request",
        lifecycle_state: "active",
        source_revision: 1,
      },
      actor_user_id: actorId,
      occurred_at: "2026-10-16T10:00:00.000Z",
      effective_from: "2026-10-16T10:00:00.000Z",
      source_domain: "staff_operations",
      source_record_id: "00000000-0000-4000-8000-000000000006",
      source_revision: 1,
      correlation_id: "00000000-0000-4000-8000-000000000007",
      idempotency_key: "staff-leave-submitted:event-1",
      payload: { state: "submitted" },
      message: {
        subject: "Review leave request",
        summary: "A staff leave request needs an authorized decision.",
        payload: { request_id: "00000000-0000-4000-8000-000000000006" },
      },
      selector_input: {
        selector_key: "leave_decision_owner",
        recipient_agents: [{ agent_kind: "human", user_id: recipientId }],
      },
    });

    expect(parsed.source_outbox_event_id).toBe(outboxId);
    expect(parsed.selector_input.recipient_agents).toEqual([{ agent_kind: "human", user_id: recipientId }]);
    expect(parsed.selector_input).not.toHaveProperty("recipient_agent_ids");
    // user_id is only the domain-facing endpoint reference; private model IDs
    // are resolved and retained inside the core runtime.
    expect(parsed).not.toHaveProperty("message_kind");
    expect(parsed).not.toHaveProperty("required_capability");
  });

  it("rejects duplicate recipient agents instead of silently duplicating work", () => {
    const result = acceptedCoordinationEventSchema.safeParse({
      school_id: schoolId,
      source_outbox_event_id: outboxId,
      event_kind: "domain_event",
      event_type: "staff.leave_submitted",
      subject: {
        kind: "staff_leave",
        domain: "staff_operations",
        domain_id: "leave-1",
        label: "Leave request",
        lifecycle_state: "active",
        source_revision: 1,
      },
      actor_user_id: actorId,
      occurred_at: "2026-10-16T10:00:00.000Z",
      effective_from: "2026-10-16T10:00:00.000Z",
      source_domain: "staff_operations",
      source_record_id: "leave-1",
      source_revision: 1,
      correlation_id: "00000000-0000-4000-8000-000000000007",
      idempotency_key: "staff-leave-submitted:event-2",
      message: { subject: "Review", summary: "Review the request.", payload: {} },
      selector_input: {
        selector_key: "leave_decision_owner",
        recipient_agents: [
          { agent_kind: "human", user_id: recipientId },
          { agent_kind: "human", user_id: recipientId },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("allows only the explicit authorized-agent selector contract", () => {
    const selector = coordinationRecipientSelectorConfigSchema.parse({
      selector_key: "leave_decision_owner",
      mode: "explicit_authorized_agents",
      required_capability: "staff_leave:decide",
      scope_mode: "institution",
      min_recipients: 1,
      max_recipients: 1,
    });
    expect(selector.mode).toBe("explicit_authorized_agents");
    expect(selector.required_capability).toBe("staff_leave:decide");
  });

  it("fails closed for team queues until dated team membership is implemented", () => {
    expect(coordinationRecipientAgentRefSchema.safeParse({
      agent_kind: "team",
      external_ref: "principal-office",
    }).success).toBe(false);
  });

  it("keeps delivery, acknowledgement and response as different outcomes", () => {
    expect(operationalMessageOutcomeSchema.safeParse({
      school_id: schoolId,
      message_id: messageId,
      state: "acknowledged",
      code: "message_acknowledged",
      explanation: "The principal opened the request.",
      occurred_at: "2026-10-16T10:01:00.000Z",
      idempotency_key: "message-acknowledged:event-1",
    }).success).toBe(false);

    expect(operationalMessageOutcomeSchema.safeParse({
      school_id: schoolId,
      message_id: messageId,
      state: "responded",
      actor: { agent_kind: "human", user_id: actorId },
      code: "leave_approved",
      explanation: "The authorized principal approved the request.",
      response: { decision: "approved" },
      occurred_at: "2026-10-16T10:02:00.000Z",
      idempotency_key: "message-responded:event-1",
    }).success).toBe(false);

    expect(operationalMessageOutcomeSchema.parse({
      school_id: schoolId,
      message_id: messageId,
      state: "responded",
      actor: { agent_kind: "human", user_id: actorId },
      source_outbox_event_id: outboxId,
      code: "leave_approved",
      explanation: "The authorized principal approved the request.",
      response: { decision: "approved" },
      occurred_at: "2026-10-16T10:02:00.000Z",
      idempotency_key: "message-responded:event-2",
    }).state).toBe("responded");
  });

  it("binds a recipient response to one exact message and source record", () => {
    const parsed = recipientOperationalMessageResponseSchema.parse({
      school_id: schoolId,
      message_id: messageId,
      correlation_id: "00000000-0000-4000-8000-000000000006",
      recipient: { agent_kind: "human", user_id: recipientId },
      actor: { agent_kind: "human", user_id: recipientId },
      expected_source_record_id: "00000000-0000-4000-8000-000000000007",
      expected_source_revision: 1,
      source_outbox_event_id: outboxId,
      code: "leave_approved",
      explanation: "The current configured owner approved this leave request.",
      response: { decision: "approved" },
      occurred_at: "2026-10-16T10:02:00.000Z",
      idempotency_key: "message-response:exact-source",
    });
    expect(parsed.message_id).toBe(messageId);
    expect(parsed.expected_source_record_id).toBe("00000000-0000-4000-8000-000000000007");
  });
});

describe("Campus Model Core coordination migration", () => {
  it("creates private tenant-constrained configuration, reaction and message records", () => {
    for (const table of [
      "campus_model_behaviour_versions",
      "campus_model_event_subscriptions",
      "campus_model_reactions",
      "campus_model_coordination_exceptions",
      "campus_model_operational_messages",
      "campus_model_operational_message_outcomes",
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("REFERENCES event_outbox(id,school_id)");
    expect(migration).toContain("REFERENCES campus_model_agents(id,school_id)");
    expect(migration).toContain("FROM PUBLIC");
    expect(migration).toContain("ARRAY['anon','authenticated']");
  });

  it("does not install hidden default behaviour or derive recipients from roles", () => {
    expect(migration).not.toMatch(/INSERT INTO campus_model_behaviour_versions/i);
    expect(migration).not.toMatch(/INSERT INTO campus_model_event_subscriptions/i);
    expect(migration).toContain("recipient_selector->>'mode'='explicit_authorized_agents'");
    expect(migration).not.toMatch(/principal|teacher|admin|fallback_recipient/i);
    expect(migration).toContain("status varchar(16) NOT NULL CHECK(status IN ('draft','approved','retired'))");
  });

  it("retains every distinct operational message state", () => {
    for (const state of ["queued", "delivered", "acknowledged", "responded", "expired", "cancelled", "dead_letter"]) {
      expect(migration).toContain(`'${state}'`);
    }
    expect(migration).toContain("source_outbox_event_id uuid NOT NULL");
    expect(migration).toContain("dispatch_outbox_event_id uuid");
    expect(migration).toContain("correlation_id uuid NOT NULL");
    expect(migration).toContain("causation_event_id uuid");
  });
});

describe("Campus Model Core coordination architecture", () => {
  it("exports one provider-neutral runtime port through the core module", () => {
    expect(moduleSource).toContain("COORDINATION_RUNTIME_PORT");
    expect(moduleSource).toContain("useExisting: CampusModelCoreService");
    expect(service).toContain("implements CampusModelCorePort");
    expect(service).toContain("CoordinationRuntimePort");
    expect(service).toContain("publishAcceptedEvent(");
    expect(service).toContain("recordMessageOutcome(");
  });

  it("fails closed without effective approved configuration and validates authority", () => {
    expect(service).toContain("behaviour.status='approved'");
    expect(service).toContain("No approved Operating-rule behaviour is active");
    expect(service).toContain("More than one Operating-rule behaviour matches");
    expect(service).toContain("recordCoordinationException");
    expect(service).toContain('status: "unmatched"');
    expect(service).toContain("authority.capability=${selector.required_capability}");
    expect(service).toContain("Every selected recipient must be active and authorized");
    expect(service).toContain("authority.effective_from<=CURRENT_TIMESTAMP");
    expect(service).toContain("The assigned recipient no longer has the capability required by this request.");
    expect(service).toContain("FOR SHARE OF authority");
    expect(service).toContain("message.id=${input.message_id}::uuid");
    expect(service).toContain("event.source_record_id=${input.expected_source_record_id}");
    expect(service).toContain("reaction.selector_snapshot");
    expect(service).toContain("JOIN school_memberships membership");
    expect(service).toContain("reference.user_id");
    expect(service).toContain("reference.external_ref");
    expect(service).not.toMatch(/defaultBehaviour|defaultRecipient|fallbackRecipient/);
  });

  it("retains idempotent source, reaction, dispatch and response evidence", () => {
    expect(service).toContain("source_outbox_event_id");
    expect(service).toContain("ON CONFLICT(realm_id,environment_namespace_id,idempotency_key) DO NOTHING");
    expect(service).toContain("campus.coordination.message_queued");
    expect(service).toContain("audience_user_ids=${dispatchAudience}::uuid[]");
    expect(service).toContain("notification_payload IS NULL");
    expect(service).toContain("This message outcome key was already used for a different result");
    expect(service).toContain("senderMayCancel");
    expect(service).toContain("its original sender may cancel it");
  });
});
