import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "kysely";
import type { Database } from "../src/database/types.js";
import type { AuthenticatedRequest } from "../src/common/request.js";
import type { CoordinationRuntimePort, MatchedCoordinationPublishReceipt } from "../src/campus-model-core/coordination-runtime.port.js";
import type { PreparedDomainCommand } from "../src/campus-model-core/domain-command-gateway.port.js";
import { acceptedCoordinationEventSchema, recipientOperationalMessageResponseSchema } from "../src/campus-model-core/contracts.js";
import { FollowupModelBridgeService, followupCoordinationSummary, type FollowupModelReceipt } from "../src/coordination/followup-model-bridge.service.js";

const tx = {} as Transaction<Database>;
const ids = { school: randomUUID(), followup: randomUUID(), student: randomUUID(), owner: randomUUID(), guardian: randomUUID(), secondGuardian: randomUUID(), outbox: randomUUID() };
const req = (user = ids.owner) => ({ authUser: { id: user }, requestId: randomUUID() }) as AuthenticatedRequest;
const source = (revision = 1, state = "awaiting_response") => ({ id: ids.followup, school_id: ids.school, student_id: ids.student, owner_user_id: ids.owner, revision, state });
const prepared: PreparedDomainCommand = { status: "ready", command_id: randomUUID(), realm_id: randomUUID(), environment_namespace_id: `live:${ids.school}`,
  actor_agent_id: randomUUID(), authority_receipt_id: randomUUID(), target_entity_id: randomUUID(), request_hash: "a".repeat(64), replayed: false };
function fixture() {
  const currentRoutes = new Map<string, { status: "matched"; behaviour_version_id: string; subscription_id: string }>();
  const commands = { prepareDomainCommand: vi.fn().mockResolvedValue(prepared), completeDomainCommand: vi.fn().mockResolvedValue({}) };
  const journal = { recordAcceptedEvent: vi.fn().mockResolvedValue({ event_id: randomUUID() }) };
  const coordination = {
    publishAcceptedEvent: vi.fn().mockImplementation((_db, raw) => {
      const input = acceptedCoordinationEventSchema.parse(raw);
      const deliveries = input.selector_input.recipient_agents.map(recipient => ({ message_id: randomUUID(), reaction_id: randomUUID(), recipient }));
      const route = { status: "matched" as const, behaviour_version_id: randomUUID(), subscription_id: randomUUID() };
      currentRoutes.set(input.event_type, route);
      return Promise.resolve({ ...route, event_id: randomUUID(), deliveries,
        message_ids: deliveries.map(item => item.message_id), reaction_ids: deliveries.map(item => item.reaction_id), replayed: false });
    }),
    findExactTrace: vi.fn().mockImplementation((_db, input) => Promise.resolve({ event_id: randomUUID(), correlation_id: ids.followup,
      message_id: input.message_id, message_state: "queued", message_open: true })),
    recordRecipientResponse: vi.fn().mockImplementation((_db, raw) => { recipientOperationalMessageResponseSchema.parse(raw); return Promise.resolve({}); }),
    recordMessageOutcome: vi.fn().mockResolvedValue({}),
    supersedeDomainMessage: vi.fn().mockResolvedValue({}),
    resolveEventRoute: vi.fn().mockImplementation((_db, input) => Promise.resolve(currentRoutes.get(input.event_type))),
    authorizeCandidateRecipients: vi.fn().mockImplementation((_db, input) => Promise.resolve({ authorised: input.recipients, unresolved: [], unauthorized: [] })),
  };
  return { commands, journal, coordination, service: new FollowupModelBridgeService(commands,
    journal, coordination as unknown as CoordinationRuntimePort) };
}
const input = (previous: FollowupModelReceipt | null = null, action = "opened", recipients = [ids.guardian, ids.secondGuardian]) => ({ action,
  key: randomUUID(), outbox_id: ids.outbox, previous, recipient_user_ids: recipients, response_recipient_user_id: null as string | null, channel: "app", observed_at: null });

describe("owning Coordination to Core bridge", () => {
  it("prepares the identified actor and current domain authority before mutation, retaining only the payload hash", async () => {
    const f = fixture();
    expect(await f.service.prepare(tx, req(), source(0), randomUUID(), "b".repeat(64), "opened", "staff", null)).toBe(prepared);
    expect(f.commands.prepareDomainCommand).toHaveBeenCalledWith(tx, expect.objectContaining({ current_revision: 0, expected_revision: 0,
      actor_user_id: ids.owner, correlation_id: ids.followup, capability: "followups.manage", authority_attestation: expect.objectContaining({ decision: "allowed" }),
      safe_context: expect.objectContaining({ payload_hash: "b".repeat(64) }) }));
  });
  it("routes each explicit guardian under approved configuration with no private question or reply body", async () => {
    const f = fixture(), receipt = await f.service.accepted(tx, req(), source(), prepared, input());
    expect(receipt.route?.status).toBe("matched");
    expect((receipt.route as MatchedCoordinationPublishReceipt).deliveries).toHaveLength(2);
    expect(f.coordination.publishAcceptedEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ selector_input: expect.objectContaining({ selector_key: "attendance_followup_guardians" }),
      payload: expect.objectContaining({ source_command_id: prepared.command_id }) }));
    expect(JSON.stringify(f.coordination.publishAcceptedEvent.mock.calls)).not.toMatch(/question|family appointment|body/u);
    expect(f.commands.completeDomainCommand).toHaveBeenCalledWith(tx, expect.objectContaining({ terminal_state: "accepted", resulting_revision: 1 }));
  });
  it("retains a visible configuration exception while preserving authorized manual follow-up", async () => {
    const f = fixture();
    f.coordination.publishAcceptedEvent.mockResolvedValue({ status: "unmatched", event_id: randomUUID(), exception_id: randomUUID(), exception_code: "configuration_missing",
      message_ids: [], reaction_ids: [], replayed: false });
    const receipt = await f.service.accepted(tx, req(), source(), prepared, input());
    expect(followupCoordinationSummary(receipt)).toMatchObject({ status: "manual_followup", exception_code: "configuration_missing" });
    expect(f.commands.completeDomainCommand).toHaveBeenCalledWith(tx, expect.objectContaining({ terminal_state: "accepted" }));
  });
  it("never invents an account for a passive guardian or guesses an administrator recipient", async () => {
    const f = fixture(), receipt = await f.service.accepted(tx, req(), source(), prepared, input(null, "opened", []));
    expect(f.coordination.publishAcceptedEvent).not.toHaveBeenCalled();
    expect(f.journal.recordAcceptedEvent).toHaveBeenCalledWith(tx, expect.objectContaining({ payload: expect.objectContaining({ coordination_exception: "recipient_unresolved" }) }));
    expect(followupCoordinationSummary(receipt)).toMatchObject({ status: "manual_followup", exception_code: "recipient_unresolved" });
  });
  it("responds to the exact guardian delivery, supersedes the other invitation, and hands review to the existing owner", async () => {
    const f = fixture(), previous = await f.service.accepted(tx, req(), source(), prepared, input());
    const next = await f.service.accepted(tx, req(ids.guardian), source(2, "in_review"), prepared,
      { ...input(previous, "guardian_reply", [ids.owner]), response_recipient_user_id: ids.guardian });
    expect(f.coordination.findExactTrace).toHaveBeenCalledTimes(2);
    for (const delivery of (previous.route as MatchedCoordinationPublishReceipt).deliveries)
      expect(f.coordination.findExactTrace).toHaveBeenCalledWith(tx, expect.objectContaining({ source_revision: 1, message_id: delivery.message_id }));
    expect(f.coordination.recordRecipientResponse).toHaveBeenCalledTimes(1);
    expect(f.coordination.recordRecipientResponse).toHaveBeenCalledWith(tx, expect.objectContaining({ actor: { agent_kind: "human", user_id: ids.guardian },
      response: expect.objectContaining({ assisted_capture: false }) }));
    expect(f.coordination.recordMessageOutcome).not.toHaveBeenCalled();
    expect(f.coordination.supersedeDomainMessage).toHaveBeenCalledTimes(1);
    expect(f.coordination.supersedeDomainMessage).toHaveBeenCalledWith(tx, expect.objectContaining({ command_id: prepared.command_id,
      previous_event_id: previous.event_id, resulting_event_id: next.event_id, required_capability: "followups.manage" }));
    expect(next.closure).toBe("awaiting_owner_review");
    expect((next.route as MatchedCoordinationPublishReceipt).deliveries[0]?.recipient).toEqual({ agent_kind: "human", user_id: ids.owner });
  });
  it("records assisted capture as staff evidence rather than pretending the guardian used the app", async () => {
    const f = fixture(), previous = await f.service.accepted(tx, req(), source(), prepared, input());
    await f.service.accepted(tx, req(), source(2, "in_review"), prepared, { ...input(previous, "assisted_reply", [ids.owner]),
      response_recipient_user_id: ids.guardian, channel: "phone", observed_at: "2026-10-24T10:00:00Z" });
    expect(f.coordination.recordRecipientResponse).not.toHaveBeenCalled();
    expect(f.coordination.recordMessageOutcome).not.toHaveBeenCalled();
    expect(f.coordination.supersedeDomainMessage).toHaveBeenCalledTimes(2);
    expect(f.coordination.publishAcceptedEvent).toHaveBeenLastCalledWith(tx, expect.objectContaining({
      actor_user_id: ids.owner, payload: expect.objectContaining({ capture: { assisted_capture: true, channel: "phone", observed_at: "2026-10-24T10:00:00Z" } }) }));
  });
  it("keeps late manual evidence recordable but does not claim an expired protocol response", async () => {
    const f = fixture(), previous = await f.service.accepted(tx, req(), source(), prepared, input());
    (previous.route as MatchedCoordinationPublishReceipt).route_snapshot = { message_kind: "request", message_schema_version: 1,
      response_due_at: "2000-01-01T00:00:00Z", expires_at: null };
    await f.service.accepted(tx, req(ids.guardian), source(2, "in_review"), prepared, { ...input(previous, "guardian_reply", [ids.owner]), response_recipient_user_id: ids.guardian });
    expect(f.coordination.recordRecipientResponse).not.toHaveBeenCalled();
    expect(f.coordination.supersedeDomainMessage).toHaveBeenCalledTimes(2);
  });
  it("does not turn rotated or revoked protocol authority into a recipient response, while preserving valid native capture", async () => {
    const f = fixture(), previous = await f.service.accepted(tx, req(), source(), prepared, input());
    f.coordination.authorizeCandidateRecipients.mockResolvedValue({ authorised: [], unresolved: [], unauthorized: [{ agent_kind: "human", user_id: ids.guardian }] });
    const next = await f.service.accepted(tx, req(ids.guardian), source(2, "in_review"), prepared,
      { ...input(previous, "guardian_reply", [ids.owner]), response_recipient_user_id: ids.guardian });
    expect(f.coordination.recordRecipientResponse).not.toHaveBeenCalled();
    expect(f.coordination.supersedeDomainMessage).toHaveBeenCalledTimes(2);
    expect(next.closure).toBe("awaiting_owner_review");
  });
  it("journals terminal domain closure without a hidden next recipient or new automation", async () => {
    const f = fixture();
    const receipt = await f.service.accepted(tx, req(), source(3, "resolved"), prepared, input(null, "resolved", []));
    expect(receipt.closure).toBe("terminal_domain_decision");
    expect(f.coordination.publishAcceptedEvent).not.toHaveBeenCalled();
    expect(f.journal.recordAcceptedEvent).toHaveBeenCalled();
    expect(followupCoordinationSummary(receipt).status).toBe("closed");
  });
  it("fails closed if retained per-recipient evidence cannot be matched to the source revision", async () => {
    const f = fixture(), previous = await f.service.accepted(tx, req(), source(), prepared, input());
    f.coordination.findExactTrace.mockResolvedValue(null);
    await expect(f.service.accepted(tx, req(ids.guardian), source(2, "in_review"), prepared, input(previous, "guardian_reply", [ids.owner])))
      .rejects.toThrow("exact follow-up handoff evidence");
  });
});
