import { ConflictException, ForbiddenException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import type { HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { effectiveSchoolAccess } from "../roles/authorization.js";

export const feeAuthorityExpectedSchema = z.object({
  mandate_revision: z.number().int().positive(), office_revision: z.number().int().positive(), appointment_revision: z.number().int().positive(),
  rule_revision: z.number().int().nonnegative(), source_revisions: z.array(z.object({ id: z.uuid(), revision: z.number().int().positive() }).strict()).min(1).max(10),
}).strict();
export type FeeAuthorityExpected = z.infer<typeof feeAuthorityExpectedSchema>;
export function sameFeeAuthorityExpected(left: FeeAuthorityExpected, right: FeeAuthorityExpected) {
  const sources = (value: FeeAuthorityExpected) => [...value.source_revisions].sort((a, b) => a.id.localeCompare(b.id));
  const a = sources(left), b = sources(right);
  return left.mandate_revision === right.mandate_revision && left.office_revision === right.office_revision
    && left.appointment_revision === right.appointment_revision && left.rule_revision === right.rule_revision
    && a.length === b.length && a.every((source, index) => source.id === b[index]?.id && source.revision === b[index]?.revision);
}
export const confirmFeeAuthoritySchema = z.object({ command_id: z.uuid(), mandate_id: z.uuid(), expected: feeAuthorityExpectedSchema, attestation: z.literal(true) }).strict();
const conditionsSchema = z.object({ max_amount_inr: z.number().int().min(1).max(100_000_000).optional() }).strict();
/** Empty conditions are unlimited; the only supported limit is whole INR.
 * Free-text limits must be blank or exactly describe that same supported cap. */
export function feeMandateLimit(conditions: unknown, summary: string): number | null {
  const parsed = conditionsSchema.safeParse(conditions);
  if (!parsed.success) throw new ConflictException("The Finance mandate has conditions this payment-plan flow cannot enforce.");
  const amount = parsed.data.max_amount_inr;
  const text = summary.trim();
  if (text && (amount === undefined || ![`Maximum amount INR ${amount}`, `Maximum ₹${amount}`].includes(text)))
    throw new ConflictException("The Finance mandate has a free-text limit that needs a supported payment-plan rule.");
  return amount === undefined ? null : amount * 100;
}
export interface FeeAuthoritySource { id: string; revision: number; title: string; reference: string; provision: string;
  source_kind: string; verification_state: string; effective_from: string; effective_until: string | null }
export interface FeeAuthorityCandidate {
  mandate_id: string; title: string; office_id: string; office_title: string; appointment_id: string; person_id: string; user_id: string;
  holder_name: string; max_amount_paise: number | null; effective_from: string; effective_until: string | null;
  expected: FeeAuthorityExpected; sources: FeeAuthoritySource[];
}

/** Uses only native Governance/People/access records and the public identity port. */
export async function eligibleFeeAuthority(tx: Transaction<Database>, schoolId: string, identities: HumanAgentIdentityPort, at: Date) {
  const rows = (await sql<{ mandate_id: string; title: string; mandate_revision: number; conditions: unknown; limit_summary: string;
    effective_from: string; effective_until: string | null; office_id: string; office_title: string; office_revision: number;
    appointment_id: string; appointment_revision: number; person_id: string; user_id: string; holder_name: string; source_ids: string[] }>`
    SELECT mandate.id AS mandate_id,mandate.title,mandate.revision AS mandate_revision,mandate.conditions,mandate.limit_summary,
      mandate.effective_from::text,mandate.effective_until::text,office.id AS office_id,office.title AS office_title,office.revision AS office_revision,
      appointment.id AS appointment_id,appointment.revision AS appointment_revision,person.id AS person_id,account.id AS user_id,
      btrim(person.first_name||' '||person.last_name) AS holder_name,
      array_remove(ARRAY[mandate.authority_source_id,office.authority_source_id,appointment.authority_source_id],NULL) AS source_ids
    FROM institution_authority_mandates mandate JOIN schools school ON school.id=mandate.school_id
    JOIN institution_governance_offices office ON office.school_id=mandate.school_id AND office.id=mandate.holder_office_id AND office.status='active'
    JOIN institution_governance_appointments appointment ON appointment.school_id=office.school_id AND appointment.office_id=office.id AND appointment.status='active'
    JOIN school_people person ON person.school_id=appointment.school_id AND person.id=appointment.person_id
    JOIN users account ON account.id=appointment.linked_user_id AND account.is_active
    WHERE mandate.school_id=${schoolId}::uuid AND mandate.status='active' AND mandate.holder_body_id IS NULL AND mandate.responsibility_type_id IS NULL
      AND 'decide'=ANY(mandate.powers) AND 'fee_instalment_decision'=ANY(mandate.matter_codes)
      AND (${at}::timestamptz AT TIME ZONE school.timezone)::date>=mandate.effective_from
      AND (mandate.effective_until IS NULL OR (${at}::timestamptz AT TIME ZONE school.timezone)::date<=mandate.effective_until)
      AND (${at}::timestamptz AT TIME ZONE school.timezone)::date>=appointment.starts_on
      AND (appointment.ends_on IS NULL OR (${at}::timestamptz AT TIME ZONE school.timezone)::date<=appointment.ends_on)
    ORDER BY mandate.id,appointment.id FOR SHARE OF mandate,office,appointment,person,account`.execute(tx)).rows;
  const result: FeeAuthorityCandidate[] = [], rejected: string[] = [];
  for (const row of rows) {
    try {
      if (rows.some(other => other.office_id === row.office_id && other.appointment_id !== row.appointment_id))
        throw new ConflictException("The Finance office has ambiguous current holders.");
      const actor = await identities.resolveAccountEndpoint(tx, { school_id: schoolId, user_id: row.user_id, at: at.toISOString() });
      if (!actor.acting || actor.person_id !== row.person_id) throw new ConflictException("The Finance holder needs a current linked campus account.");
      const access = await effectiveSchoolAccess(tx, row.user_id, schoolId, "fees.manage", true);
      if (!access.sources.some(source => source.permission === "fees.manage")) throw new ForbiddenException("The Finance holder needs current fee-management access.");
      const sources = (await sql<FeeAuthoritySource>`SELECT source.id,source.revision,source.title,source.reference,source.provision,source.source_kind,
          source.verification_state,source.effective_from::text,source.effective_until::text FROM institution_authority_sources source
        JOIN schools school ON school.id=source.school_id WHERE source.school_id=${schoolId}::uuid AND source.id=ANY(${[...new Set(row.source_ids)]}::uuid[])
          AND (source.verification_state='verified' OR source.verification_state='self_attested' AND source.source_kind='owner_declaration')
          AND source.effective_from IS NOT NULL AND (${at}::timestamptz AT TIME ZONE school.timezone)::date>=source.effective_from
          AND (source.effective_until IS NULL OR (${at}::timestamptz AT TIME ZONE school.timezone)::date<=source.effective_until)
        ORDER BY source.id FOR SHARE OF source`.execute(tx)).rows;
      if (sources.length !== new Set(row.source_ids).size) throw new ConflictException("The Finance authority source is missing, expired or not confirmed.");
      result.push({ mandate_id: row.mandate_id, title: row.title, office_id: row.office_id, office_title: row.office_title, appointment_id: row.appointment_id,
        person_id: row.person_id, user_id: row.user_id, holder_name: row.holder_name, max_amount_paise: feeMandateLimit(row.conditions, row.limit_summary),
        effective_from: row.effective_from, effective_until: row.effective_until, sources,
        expected: { mandate_revision: row.mandate_revision, office_revision: row.office_revision, appointment_revision: row.appointment_revision,
          rule_revision: 0, source_revisions: sources.map(({ id, revision }) => ({ id, revision })) } });
    } catch (error) {
      if (!(error instanceof ConflictException || error instanceof ForbiddenException)) throw error;
      rejected.push(error.message);
    }
  }
  return { candidates: result, reasons: [...new Set(rejected)] };
}

export async function requireAdoptedFeeAuthority(tx: Transaction<Database>, schoolId: string, rule: { id: string; revision: number },
  officeId: string, appointmentId: string, userId: string, identities: HumanAgentIdentityPort | undefined, at: Date) {
  if (!identities) throw new ConflictException("Current Finance identity verification is unavailable.");
  const adoption = (await sql<{ id: string; mandate_id: string; mandate_revision: number; office_id: string; office_revision: number;
    appointment_id: string; appointment_revision: number; source_revisions: unknown; max_amount_paise: string | number | null; confirmed_by: string; person_id: string }>`
    SELECT * FROM fee_authority_adoptions WHERE school_id=${schoolId}::uuid AND rule_id=${rule.id}::uuid AND rule_revision=${rule.revision} FOR SHARE`.execute(tx)).rows[0];
  if (!adoption) throw new ConflictException("The payment-plan approver must confirm their existing Finance authority in Fees.");
  const candidate = (await eligibleFeeAuthority(tx, schoolId, identities, at)).candidates.find(item => item.mandate_id === adoption.mandate_id && item.user_id === userId);
  if (!candidate || candidate.office_id !== officeId || candidate.appointment_id !== appointmentId || adoption.office_id !== officeId
    || adoption.appointment_id !== appointmentId || adoption.confirmed_by !== userId || adoption.person_id !== candidate.person_id
    || adoption.mandate_revision !== candidate.expected.mandate_revision || adoption.office_revision !== candidate.expected.office_revision
    || adoption.appointment_revision !== candidate.expected.appointment_revision
    || !feeAuthorityExpectedSchema.safeParse({ ...candidate.expected, source_revisions: adoption.source_revisions }).success
    || !sameFeeAuthorityExpected({ ...candidate.expected, source_revisions: adoption.source_revisions as FeeAuthorityExpected["source_revisions"] }, candidate.expected)
    || (adoption.max_amount_paise === null ? null : Number(adoption.max_amount_paise)) !== candidate.max_amount_paise)
    throw new ConflictException("The payment-plan authority changed. Its current holder must review and confirm it again in Fees.");
  return { adoption_id: adoption.id, mandate_id: candidate.mandate_id, mandate_revision: candidate.expected.mandate_revision, max_amount_paise: candidate.max_amount_paise };
}
