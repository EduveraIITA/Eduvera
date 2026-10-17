import { readFileSync } from "node:fs";
import type { Transaction } from "kysely";
import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { CoordinationRuntimePort } from "../src/campus-model-core/coordination-runtime.port.js";
import type { Database } from "../src/database/types.js";
import type {
  GovernanceDecisionAuthorityPort,
  GovernanceDecisionAuthorityReceipt,
} from "../src/governance/decision-authority.port.js";
import { StaffLeaveModelBridgeService } from "../src/staff-operations/staff-leave-model-bridge.service.js";
import { StaffOperationsService } from "../src/staff-operations/staff-operations.service.js";
import type { TemporalContextPort } from "../src/campus-model-core/temporal-context.port.js";
import { createStaffCoverageReconciliationTestDouble } from "./staff-coverage-reconciliation.test-support.js";

const ids = {
  school: "00000000-0000-4000-8000-000000000001",
  requester: "00000000-0000-4000-8000-000000000002",
  owner: "00000000-0000-4000-8000-000000000003",
  person: "00000000-0000-4000-8000-000000000004",
  request: "00000000-0000-4000-8000-000000000005",
  profile: "00000000-0000-4000-8000-000000000006",
  policy: "00000000-0000-4000-8000-000000000007",
  outbox: "00000000-0000-4000-8000-000000000008",
  command: "00000000-0000-4000-8000-000000000009",
  event: "00000000-0000-4000-8000-000000000010",
  behaviour: "00000000-0000-4000-8000-000000000011",
  subscription: "00000000-0000-4000-8000-000000000012",
  reaction: "00000000-0000-4000-8000-000000000013",
  message: "00000000-0000-4000-8000-000000000014",
  outcome: "00000000-0000-4000-8000-000000000015",
  office: "00000000-0000-4000-8000-000000000016",
  appointment: "00000000-0000-4000-8000-000000000017",
  rule: "00000000-0000-4000-8000-000000000018",
  source: "00000000-0000-4000-8000-000000000019",
  membership: "00000000-0000-4000-8000-000000000020",
};

const transaction = {} as Transaction<Database>;
const authorityReceipt: GovernanceDecisionAuthorityReceipt = {
  school_id: ids.school,
  matter_code: "staff_leave_decision",
  evaluated_at: "2026-10-16T10:00:00.000Z",
  effective_date: "2026-10-16",
  institution_timezone: "Asia/Kolkata",
  decision_mode: "individual",
  user_id: ids.owner,
  account: { id: ids.owner, is_active: true },
  memberships: [{ id: ids.membership, role: "admin", is_active: true }],
  person: { id: ids.person, revision: 2 },
  office: { id: ids.office, revision: 3, status: "active", authority_source_id: ids.source },
  appointment: {
    id: ids.appointment,
    revision: 4,
    status: "active",
    appointment_kind: "appointed",
    starts_on: "2026-04-01",
    ends_on: null,
    authority_source_id: ids.source,
    evidence_reference: "appointment:principal",
  },
  rule: {
    id: ids.rule,
    revision: 5,
    status: "confirmed",
    decision_mode: "individual",
    effective_from: "2026-04-01",
    effective_until: null,
    conditions_summary: "The current officeholder decides.",
    authority_source_ids: [ids.source],
  },
  sources: [{
    id: ids.source,
    revision: 6,
    source_kind: "appointment_order",
    reference: "PRINCIPAL-1",
    provision: "Staff leave",
    evidence_reference: "document:PRINCIPAL-1",
    verification_state: "verified",
    effective_from: "2026-04-01",
    effective_until: null,
    verified_by: ids.owner,
    verified_at: "2026-04-01T00:00:00.000Z",
  }],
};

function matchedReceipt() {
  return {
    status: "matched" as const,
    event_id: ids.event,
    behaviour_version_id: ids.behaviour,
    subscription_id: ids.subscription,
    reaction_ids: [ids.reaction],
    message_ids: [ids.message],
    deliveries: [{
      reaction_id: ids.reaction,
      message_id: ids.message,
      recipient: { agent_kind: "human" as const, user_id: ids.owner },
    }],
    replayed: false,
  };
}

function setup(receipt: ReturnType<typeof matchedReceipt> | {
  status: "unmatched";
  event_id: string;
  exception_id: string;
  exception_code: "configuration_missing";
  reaction_ids: [];
  message_ids: [];
  replayed: false;
} = matchedReceipt()) {
  const resolveDecisionOwner = vi.fn().mockResolvedValue(authorityReceipt);
  const assertDecisionAuthority = vi.fn().mockResolvedValue(authorityReceipt);
  const authority: GovernanceDecisionAuthorityPort = {
    resolveDecisionOwner,
    assertDecisionAuthority,
  };
  const publishAcceptedEvent = vi.fn().mockResolvedValue(receipt);
  const recordMessageOutcome = vi.fn().mockResolvedValue({
    message_id: ids.message,
    reaction_id: ids.reaction,
    state: "cancelled",
    outcome_id: ids.outcome,
    replayed: false,
  });
  const recordRecipientResponse = vi.fn().mockResolvedValue({
    message_id: ids.message,
    reaction_id: ids.reaction,
    state: "responded",
    outcome_id: ids.outcome,
    replayed: false,
  });
  const coordination: CoordinationRuntimePort = {
    findExactTrace: vi.fn(),
    hasAcceptedSourceEvent: vi.fn(),
    listOperationalMessageWork: vi.fn(),
    resolveEventRoute: vi.fn(),
    authorizeCandidateRecipients: vi.fn(),
    publishAcceptedEvent,
    recordMessageOutcome,
    recordRecipientResponse,
  };
  return {
    authority,
    coordination,
    mocks: {
      resolveDecisionOwner,
      assertDecisionAuthority,
      publishAcceptedEvent,
      recordMessageOutcome,
      recordRecipientResponse,
    },
    service: new StaffLeaveModelBridgeService(authority, coordination),
  };
}

function submissionInput() {
  return {
    school_id: ids.school,
    actor_user_id: ids.requester,
    request: {
      id: ids.request,
      staff_profile_id: ids.profile,
      staff_profile_revision: 9,
      policy_id: ids.policy,
      starts_on: "2026-10-20",
      ends_on: "2026-10-21",
      portion: "full_day",
      requested_days: "2.00",
      status: "submitted",
      revision: 1,
    },
    source_outbox_event_id: ids.outbox,
    command_id: ids.command,
    occurred_at: "2026-10-16T10:00:00.000Z",
    decision_owner: authorityReceipt,
  };
}

describe("staff leave model bridge", () => {
  it("resolves only the configured staff-leave decision owner", async () => {
    const { mocks, service } = setup();
    await expect(service.resolveDecisionOwner(
      transaction,
      ids.school,
      new Date("2026-10-16T10:00:00.000Z"),
    )).resolves.toBe(authorityReceipt);
    expect(mocks.resolveDecisionOwner).toHaveBeenCalledWith(
      transaction,
      ids.school,
      "staff_leave_decision",
      expect.any(Date),
    );
  });

  it("publishes one configured Request to that owner without private leave text", async () => {
    const { mocks, service } = setup();
    await expect(service.publishSubmitted(transaction, submissionInput()))
      .resolves.toMatchObject({ status: "matched", event_id: ids.event });

    const published = mocks.publishAcceptedEvent.mock.calls[0]![1];
    expect(published).toMatchObject({
      event_type: "staff.leave.submitted",
      source_domain: "staff_operations",
      source_record_id: ids.request,
      source_revision: 1,
      correlation_id: ids.command,
      causation_event_id: null,
      selector_input: {
        selector_key: "leave_decision_owner",
        recipient_agents: [{ agent_kind: "human", user_id: ids.owner }],
        scope: null,
      },
      payload: {
        request_id: ids.request,
        staff_profile_id: ids.profile,
        status: "submitted",
        revision: 1,
      },
      context: {
        kind: "staff_profile",
        domain_id: ids.profile,
        source_revision: 9,
      },
    });
    const serialized = JSON.stringify(published);
    expect(serialized).not.toMatch(/reason|handover/i);
    expect(serialized).not.toContain("Family medical appointment");
    expect(serialized).not.toContain("Period 2 needs cover");
  });

  it("fails the owning transaction when behaviour configuration is missing", async () => {
    const { service } = setup({
      status: "unmatched",
      event_id: ids.event,
      exception_id: ids.outcome,
      exception_code: "configuration_missing",
      reaction_ids: [],
      message_ids: [],
      replayed: false,
    });
    await expect(service.publishSubmitted(transaction, submissionInput()))
      .rejects.toThrow(/decision route is not fully configured/i);
  });

  it("records the exact current recipient's typed response without decision notes", async () => {
    const { mocks, service } = setup();
    await expect(service.assertDecisionAuthority(
      transaction,
      ids.school,
      ids.owner,
      new Date("2026-10-16T10:02:00.000Z"),
    )).resolves.toBe(authorityReceipt);
    expect(mocks.assertDecisionAuthority).toHaveBeenCalledWith(
      transaction,
      ids.school,
      "staff_leave_decision",
      ids.owner,
      expect.any(Date),
    );

    await expect(service.recordDecisionResponse(transaction, {
      school_id: ids.school,
      actor_user_id: ids.owner,
      decision: "approved",
      message_id: ids.message,
      request_id: ids.request,
      source_revision: 1,
      resulting_revision: 2,
      affected_periods: 3,
      source_outbox_event_id: ids.outbox,
      correlation_id: ids.command,
      command_id: ids.outcome,
      occurred_at: "2026-10-16T10:02:00.000Z",
      decision_authority: authorityReceipt,
    })).resolves.toMatchObject({ state: "responded", outcome_id: ids.outcome });

    const response = mocks.recordRecipientResponse.mock.calls[0]![1];
    expect(response).toMatchObject({
      message_id: ids.message,
      correlation_id: ids.command,
      recipient: { agent_kind: "human", user_id: ids.owner },
      actor: { agent_kind: "human", user_id: ids.owner },
      expected_source_record_id: ids.request,
      expected_source_revision: 1,
      code: "staff_leave_approved",
      response: {
        request_id: ids.request,
        decision: "approved",
        resulting_revision: 2,
        affected_periods: 3,
      },
      idempotency_key: `staff-leave-response:${ids.request}:${ids.message}:${ids.owner}:${ids.outcome}`,
    });
    expect(JSON.stringify(response)).not.toMatch(/note|reason|handover/i);
  });

  it("closes the original Request when its staff member withdraws", async () => {
    const { mocks, service } = setup();
    await expect(service.cancelSubmittedRequest(transaction, {
      school_id: ids.school,
      actor_user_id: ids.requester,
      message_id: ids.message,
      source_outbox_event_id: ids.outbox,
      command_id: ids.command,
      occurred_at: "2026-10-16T10:03:00.000Z",
    })).resolves.toMatchObject({ state: "cancelled" });

    expect(mocks.recordMessageOutcome).toHaveBeenCalledWith(transaction, {
      school_id: ids.school,
      message_id: ids.message,
      state: "cancelled",
      actor: { agent_kind: "human", user_id: ids.requester },
      source_outbox_event_id: ids.outbox,
      code: "staff_leave_withdrawn",
      explanation: "The requesting staff member withdrew the pending leave request.",
      response: null,
      occurred_at: "2026-10-16T10:03:00.000Z",
      idempotency_key: `staff-leave-withdrawal:${ids.message}:${ids.requester}:${ids.command}`,
    });
  });

  it("does not give a second technical administrator leave-review access", async () => {
    const secondAdmin = "00000000-0000-4000-8000-000000000021";
    const assertDecisionAuthority = vi.fn().mockRejectedValue(
      new ForbiddenException("The current officeholder must decide this staff-leave request."),
    );
    const modelBridge = {
      assertDecisionAuthority,
    };
    const database = {};
    const staff = new StaffOperationsService(
      database as never,
      modelBridge as never,
      {} as never,
      createStaffCoverageReconciliationTestDouble(),
      {} as TemporalContextPort,
      {} as never,
    );
    await expect((staff as unknown as {
      canReviewStaffLeave: (
        user: { id: string },
        schoolId: string,
        transaction: Transaction<Database>,
      ) => Promise<boolean>;
    }).canReviewStaffLeave({ id: secondAdmin }, ids.school, transaction)).resolves.toBe(false);
    expect(assertDecisionAuthority).toHaveBeenCalledWith(
      transaction,
      ids.school,
      secondAdmin,
      expect.any(Date),
    );
  });
});

describe("staff leave domain integration contract", () => {
  const service = readFileSync(
    new URL("../src/staff-operations/staff-operations.service.ts", import.meta.url),
    "utf8",
  );
  const migration = readFileSync(
    new URL("../migrations/108_staff_leave_command_idempotency.sql", import.meta.url),
    "utf8",
  );
  const requests = readFileSync(
    new URL("../src/requests/requests.service.ts", import.meta.url),
    "utf8",
  );

  it("removes all-admin leave routing and retains complete command evidence", () => {
    const submit = service.slice(service.indexOf("async requestLeave"), service.indexOf("async decideLeave"));
    const decide = service.slice(service.indexOf("async decideLeave"), service.indexOf("async assignCoverage"));
    expect(submit).toContain("decisionOwner.user_id");
    expect(submit).not.toContain("SELECT user_id FROM school_memberships");
    expect(decide).toContain("assertDecisionAuthority");
    expect(decide).not.toContain("this.principal(");
    expect(decide).not.toContain("SELECT user_id FROM school_memberships");
    expect(service).toContain("AND (${canReviewStaffLeave} OR profile.user_id=${user.id}::uuid)");
    expect(service).toContain("CASE WHEN ${canReviewStaffLeave} OR absent.user_id=${user.id}::uuid");
    expect(service).toContain("THEN leave_request.reason ELSE NULL END AS leave_reason");
    expect(service).toContain("THEN task.handover_note ELSE '' END AS handover_note");
    expect(requests).toContain("const canReviewStaffLeave = await this.canReviewStaffLeave(user, scope.school_id, transaction)");
    expect(requests).toContain("AND ${canReviewStaffLeave}");
    expect(requests).toContain("/work/staff-leave?school=");
    expect(decide).toContain("The staff-leave decision owner changed after submission.");
    const withdraw = service.slice(service.indexOf("async withdrawLeave"));
    expect(withdraw).toContain("cancelSubmittedRequest");
    expect(withdraw).toContain("submissionTrace.original_owner_user_id");
    expect(withdraw).toContain('cancellation_authority: "original_message_sender"');
    expect(withdraw).not.toContain("resolveDecisionOwner");
    expect(withdraw).not.toContain("SELECT user_id FROM school_memberships");
    expect(migration).toContain("correlation_id uuid NOT NULL");
    expect(migration).toContain("causation_event_id uuid");
    expect(migration).toContain("authority_receipt jsonb");
    expect(migration).toContain("coordination_receipt jsonb");
    expect(migration).toContain("REFERENCES staff_leave_requests(id,school_id)");
    expect(migration).toContain("REFERENCES campus_model_events(id,school_id)");
    expect(migration).toContain("WHERE command_type='submit'");
  });
});
