import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  humanAgentAccountEndpointLinkSchema,
  humanAgentAccountEndpointCloseSchema,
  humanAgentAccountEndpointReplaceSchema,
  humanAgentAccountResolutionSchema,
  humanAgentPersonResolutionSchema,
} from "../src/campus-model-core/contracts.js";

const schoolId = "00000000-0000-4000-8000-000000000001";
const personId = "00000000-0000-4000-8000-000000000002";
const userId = "00000000-0000-4000-8000-000000000003";
const actorId = "00000000-0000-4000-8000-000000000004";

const migration = readFileSync(resolve(process.cwd(), "migrations/107_campus_model_human_agent_identity.sql"), "utf8");
const service = readFileSync(new URL("../src/campus-model-core/campus-model-core.service.ts", import.meta.url), "utf8");
const moduleSource = readFileSync(new URL("../src/campus-model-core/campus-model-core.module.ts", import.meta.url), "utf8");
const portSource = readFileSync(new URL("../src/campus-model-core/human-agent-identity.port.ts", import.meta.url), "utf8");

describe("Campus Model human-agent identity contracts", () => {
  it("links one explicit same-school person and account over a dated interval", () => {
    const endpoint = humanAgentAccountEndpointLinkSchema.parse({
      school_id: schoolId,
      person_id: personId,
      user_id: userId,
      actor_user_id: actorId,
      effective_from: "2026-10-16T10:00:00.000Z",
      effective_until: "2027-10-16T10:00:00.000Z",
      source_domain: "people",
      source_record_id: personId,
      source_revision: 2,
    });
    expect(endpoint.person_id).toBe(personId);
    expect(endpoint.user_id).toBe(userId);
  });

  it("rejects an invalid endpoint interval", () => {
    expect(humanAgentAccountEndpointLinkSchema.safeParse({
      school_id: schoolId,
      person_id: personId,
      user_id: userId,
      actor_user_id: actorId,
      effective_from: "2026-10-16T10:00:00.000Z",
      effective_until: "2026-10-16T09:59:59.000Z",
      source_domain: "people",
      source_record_id: personId,
      source_revision: 2,
    }).success).toBe(false);
  });

  it("keeps account and person resolution institution-scoped and time-aware", () => {
    expect(humanAgentAccountResolutionSchema.parse({
      school_id: schoolId,
      user_id: userId,
      at: "2026-10-16T10:00:00.000Z",
    }).school_id).toBe(schoolId);
    expect(humanAgentPersonResolutionSchema.parse({
      school_id: schoolId,
      person_id: personId,
      at: "2026-10-16T10:00:00.000Z",
    }).person_id).toBe(personId);
  });

  it("requires revision, evidence and idempotency for endpoint closure and replacement", () => {
    const close = humanAgentAccountEndpointCloseSchema.parse({
      school_id: schoolId,
      endpoint_id: "00000000-0000-4000-8000-000000000005",
      actor_user_id: actorId,
      expected_revision: 3,
      effective_at: "2026-10-16T10:00:00.000Z",
      disposition: "revoked",
      reason: "Account access was withdrawn.",
      source_domain: "people",
      source_record_id: "identity-change-1",
      source_revision: 4,
      idempotency_key: "identity-close-1",
    });
    expect(close.expected_revision).toBe(3);
    const replacement = humanAgentAccountEndpointReplaceSchema.parse({
      school_id: schoolId,
      current_endpoint_id: close.endpoint_id,
      replacement_user_id: userId,
      actor_user_id: actorId,
      current_expected_revision: 3,
      effective_at: "2026-10-16T10:00:00.000Z",
      reason: "Move the person to a replacement campus account.",
      source_domain: "people",
      source_record_id: "identity-change-2",
      source_revision: 5,
      idempotency_key: "identity-replace-1",
    });
    expect(replacement.current_disposition).toBe("ended");
  });
});

describe("Campus Model human-agent identity migration", () => {
  it("moves human identity from user_id to a school-person-stable agent", () => {
    expect(migration).toContain("ALTER TABLE campus_model_agents ADD COLUMN person_id uuid");
    expect(migration).toContain("campus_model_agents_human_person_scope_fk");
    expect(migration).toContain("campus_model_agents_human_person_idx");
    expect(migration).toContain("UPDATE campus_model_agents SET user_id=NULL WHERE agent_kind='human'");
    expect(migration).toContain("agent_kind='human' AND person_id IS NOT NULL AND user_id IS NULL");
  });

  it("creates private effective-dated account and external-channel endpoints", () => {
    expect(migration).toContain("CREATE TABLE campus_model_agent_endpoints");
    expect(migration).toContain("endpoint_kind IN ('account','external_channel')");
    expect(migration).toContain("effective_from timestamptz NOT NULL");
    expect(migration).toContain("effective_until timestamptz");
    expect(migration).toContain("guard_campus_model_agent_endpoint_overlap");
    expect(migration).toContain("A human agent cannot have overlapping campus account endpoints");
    expect(migration).toContain(":human-agent-account:");
    expect(migration).toContain("ALTER TABLE campus_model_agent_endpoints ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE campus_model_agent_endpoints,campus_model_agent_endpoint_transitions FROM PUBLIC");
    expect(migration).toContain("CREATE TABLE campus_model_agent_endpoint_transitions");
    expect(migration).toContain("resulting_endpoint_revision integer NOT NULL");
    expect(migration).toContain("ALTER TABLE campus_model_agent_endpoint_transitions ENABLE ROW LEVEL SECURITY");
  });

  it("backfills only explicit account relationships and stops ambiguous identity", () => {
    expect(migration).toContain("student.user_id,student.person_id,'student_profile'");
    expect(migration).toContain("parent.user_id,profile.person_id,'guardian_profile'");
    expect(migration).toContain("profile.user_id,profile.person_id,'staff_profile'");
    expect(migration).toContain("appointment.linked_user_id,appointment.person_id,'governance_appointment'");
    expect(migration).toContain("count(DISTINCT person_id)>1");
    expect(migration).toContain("No name, email or phone matching");
    expect(migration).not.toMatch(/lower\([^\n]*(?:phone|email)[^\n]*\)\s*=|contact_phone\s*=|contact_email\s*=/i);
  });

  it("gives every newly inserted staff profile an explicit person without contact matching", () => {
    expect(migration).toContain("CREATE FUNCTION ensure_staff_profile_person_identity()");
    expect(migration).toContain("BEFORE INSERT ON staff_profiles");
    expect(migration).toContain("RETURNING id INTO NEW.person_id");
    expect(migration).toContain("REVOKE ALL ON FUNCTION ensure_staff_profile_person_identity() FROM PUBLIC");
  });

  it("does not turn account-less campus people into acting agents", () => {
    expect(migration).toContain("Active account members receive a stable agent now. Account-less people do not.");
    expect(migration).toMatch(/INSERT INTO campus_model_agents[\s\S]*JOIN users user_account/);
    expect(migration).toMatch(/WHERE EXISTS \([\s\S]*school_memberships membership/);
    expect(migration).toContain("membership.is_active AND membership.role='admin'");
    expect(migration).not.toMatch(/INSERT INTO campus_model_agents[\s\S]*FROM school_people person\s*(?:;|ON CONFLICT)/);
  });

  it("maps approved Telegram or WhatsApp connections without granting authority", () => {
    expect(migration).toContain("FROM agent_channel_connections connection");
    expect(migration).toContain("connection.external_user_id");
    expect(migration).toContain("account_endpoint.agent_id");
    expect(migration).toContain("Provider possession never grants campus authority");
  });
});

describe("Campus Model human-agent identity architecture", () => {
  it("exports one narrow identity port through the existing core service", () => {
    expect(portSource).toContain("HUMAN_AGENT_IDENTITY_PORT");
    expect(portSource).toContain("resolveAccountEndpoint(");
    expect(portSource).toContain("resolvePersonAgent(");
    expect(portSource).toContain("linkAccountEndpoint(");
    expect(portSource).toContain("closeAccountEndpoint(");
    expect(portSource).toContain("replaceAccountEndpoint(");
    expect(moduleSource).toContain("HUMAN_AGENT_IDENTITY_PORT");
    expect(moduleSource).toContain("useExisting: CampusModelCoreService");
    expect(service).toContain("HumanAgentIdentityPort");
  });

  it("resolves legacy user references through endpoints and rechecks ability to act", () => {
    expect(service).toContain("campus_model_agent_endpoints endpoint");
    expect(service).toContain("endpoint.user_id=${userId}::uuid");
    expect(service).toContain("membership.is_active");
    expect(service).toContain("account.is_active");
    expect(service).toContain("profile.person_id=agent.person_id");
    expect(service).toContain("profile_unlinked");
    expect(service).toContain("resolveOrProvisionHumanAgent(");
    expect(service).toContain("institution_governance_appointments appointment");
    expect(service).toContain("candidates.length > 1");
    expect(service).not.toContain("agent.user_id=${reference.user_id}::uuid");
  });

  it("keeps identity linking authorized and exact replays immutable", () => {
    expect(service).toContain("input.actor_user_id !== input.user_id && !actorAccess.active_admin");
    expect(service).toContain("Only the account owner or an active institution administrator");
    expect(service).toContain("same_effective_from");
    expect(service).toContain("same_effective_until");
    expect(service).toContain("same_source");
    expect(service).toContain("same_metadata");
    expect(service).toContain("already exists with different identity evidence or dates");
    expect(service).not.toMatch(/UPDATE campus_model_agent_endpoints SET status='active'/);
    expect(service).not.toMatch(/status=CASE WHEN campus_model_agents\.status='revoked'/);
    expect(service).toContain("A revoked account endpoint cannot be changed.");
    expect(service).toContain("This endpoint transition key was already used for different work.");
  });

  it("fails closed instead of letting the core create a People-domain person", () => {
    const provisioner = service.slice(
      service.indexOf("private async resolveOrProvisionHumanAgent("),
      service.indexOf("private async resolveAccountEndpointIn("),
    );
    expect(provisioner).not.toContain("INSERT INTO school_people");
    expect(provisioner).toContain('"profile_unlinked"');
  });

  it("replays the original selector recipient instead of a current replacement account", () => {
    expect(service).toContain("reaction.selector_snapshot");
    expect(service).toContain("resolved_recipient_agent_ids");
    expect(service).toContain("coordinationRecipientAgentRefSchema.parse");
    expect(service).not.toContain("The human recipient no longer has an active account endpoint.");
  });

  it("returns an explicit non-acting state for an unlinked person", () => {
    expect(portSource).toContain('acting: false');
    expect(portSource).toContain('"account_not_linked"');
    expect(service).toContain('hasHistory ? "endpoint_inactive" : "account_not_linked"');
    expect(service).toContain('"agent_not_registered"');
  });
});
