import { randomUUID } from "node:crypto";
import type { DatabaseService } from "../src/database/database.service.js";
import type { HumanAgentIdentityPort } from "../src/campus-model-core/human-agent-identity.port.js";
import type { AuthUser } from "../src/common/request.js";

/** Explicit fictional pre-existing authority, not onboarding/adoption evidence.
 * Confirm it only through FeeAuthorityService to exercise ordinary adoption. */
export async function createFeeAuthorityMandateFixture(db: DatabaseService, identities: HumanAgentIdentityPort, schoolId: string, actor: AuthUser,
  conditions: Record<string, unknown> = {}) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12), day = new Date().toISOString().slice(0, 10);
  const identity = await db.transaction().execute(tx => identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: actor.id, at: new Date().toISOString() }));
  if (!identity.acting) throw new Error("The authority fixture needs an existing canonical person/account endpoint.");
  const source = await db.insertInto("institution_authority_sources").values({ school_id: schoolId, code: `finance_${suffix}`, title: "Synthetic payment-plan mandate source",
    source_kind: "governing_instrument", issuer: "Fictional institution", jurisdiction: "Synthetic QA", reference: `QA-${suffix}`, provision: "The named Finance office decides payment plans.",
    evidence_reference: `synthetic:${suffix}`, verification_state: "verified", effective_from: day, effective_until: null, verified_by: actor.id, verified_at: new Date(), created_by: actor.id }).returning("id").executeTakeFirstOrThrow();
  const office = await db.insertInto("institution_governance_offices").values({ school_id: schoolId, code: `finance_${suffix}`, title: "Finance approvals",
    purpose: "The existing explicit Finance payment-plan mandate.", authority_source_id: source.id, status: "active", created_by: actor.id }).returning("id").executeTakeFirstOrThrow();
  const appointment = await db.insertInto("institution_governance_appointments").values({ school_id: schoolId, office_id: office.id, seat_id: null,
    person_id: identity.person_id, linked_user_id: actor.id, appointment_kind: "appointed", starts_on: day, ends_on: null, status: "active",
    authority_source_id: source.id, evidence_reference: `synthetic:${suffix}`, created_by: actor.id }).returning("id").executeTakeFirstOrThrow();
  const mandate = await db.insertInto("institution_authority_mandates").values({ school_id: schoolId, code: `finance_${suffix}`, title: "Payment-plan decisions",
    authority_source_id: source.id, holder_office_id: office.id, holder_body_id: null, responsibility_type_id: null, powers: ["decide"],
    matter_codes: ["fee_instalment_decision"], limit_summary: "", conditions, effective_from: day, effective_until: null, delegable: false, status: "active", created_by: actor.id }).returning("id").executeTakeFirstOrThrow();
  return { mandateId: mandate.id, officeId: office.id, appointmentId: appointment.id, sourceId: source.id, personId: identity.person_id };
}
