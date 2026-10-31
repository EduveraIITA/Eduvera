import { createHash } from "node:crypto";
import type { CampusMotionClaim, CampusMotionPoint, CampusMotionProjection, CampusMotionSubject } from "./campus-motion.contracts.js";
import type { CampusViewDayOccurrence, CampusViewMotionParticipant } from "./campus-view.repository.js";

export interface CampusMotionClaimInput {
  /** Private canonical People ID, class entity ID, or logical activity group ID. */
  identity: string;
  kind: CampusMotionSubject["kind"];
  occurrence_id: string;
  space_id: string | null;
  starts_at: Date | string;
  ends_at: Date | string;
  expected_count: number;
  source: CampusMotionClaim["source"];
}

export interface CampusMotionPointInput {
  id: string;
  space_id: string;
  observed_at: Date | string;
  dimension: CampusMotionPoint["dimension"];
  source: CampusMotionPoint["source"];
}

const SUBJECT_LIMIT = 128;
const CLAIM_LIMIT = 512;
const POINT_LIMIT = 64;
const instant = (value: Date | string): string | null => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

/** A complete explicit required-participant snapshot can represent anonymous
 * individuals. An incomplete/private-bounded snapshot remains one planned group;
 * a partial roster is never added beside that group's full expected count. */
export function campusDayMotionClaims(
  occurrences: readonly CampusViewDayOccurrence[],
  participants: readonly CampusViewMotionParticipant[],
): CampusMotionClaimInput[] {
  const byOccurrence = new Map<string, Set<string>>();
  for (const participant of participants.slice(0, 1024)) {
    const people = byOccurrence.get(participant.occurrence_id) ?? new Set<string>();
    people.add(participant.person_id); byOccurrence.set(participant.occurrence_id, people);
  }
  const claims: CampusMotionClaimInput[] = [];
  for (const occurrence of occurrences) {
    const basis = { occurrence_id: occurrence.occurrence_id, space_id: occurrence.space_id,
      starts_at: occurrence.starts_at, ends_at: occurrence.ends_at, source: { domain: occurrence.source_domain,
        record_id: occurrence.source_record_id, revision: occurrence.source_revision } };
    const people = byOccurrence.get(occurrence.id) ?? new Set<string>();
    const hasCount = Number.isSafeInteger(occurrence.expected_count) && occurrence.expected_count > 0;
    const complete = hasCount && people.size === occurrence.expected_count;
    if (complete) {
      for (const identity of [...people].sort()) claims.push({ ...basis, identity, kind: "person", expected_count: 1 });
    } else if (hasCount) {
      claims.push({ ...basis, identity: occurrence.class_entity_id
        ? `class:${occurrence.class_entity_id}` : `activity:${occurrence.occurrence_id}`,
      kind: "group", expected_count: occurrence.expected_count });
    }
    if (occurrence.responsible_person_id && (!hasCount || occurrence.expected_includes_responsible === false)
      && !(complete && people.has(occurrence.responsible_person_id))) {
      claims.push({ ...basis, identity: occurrence.responsible_person_id, kind: "person", expected_count: 1 });
    }
  }
  return claims;
}

/** No identity lookup, coordinate inference, location confirmation, or clock advancement.
 * Callers supply only current owner-authorized records from the selected store. */
export function projectCampusMotion(input: {
  school_id: string;
  campus_id: string | null;
  viewer_user_id: string;
  as_of: string;
  environment: CampusMotionProjection["environment"];
  space_ids: ReadonlySet<string>;
  claims: readonly CampusMotionClaimInput[];
  points?: readonly CampusMotionPointInput[];
  source_limited?: boolean;
}): CampusMotionProjection {
  const scope = [input.school_id, input.campus_id, input.viewer_user_id, input.environment.kind,
    input.environment.namespace_id ?? `live:${input.school_id}`];
  const key = (kind: string, identity: string) => createHash("sha256")
    .update(JSON.stringify([...scope, kind, identity])).digest("hex").slice(0, 32);
  const subjects = new Map<string, CampusMotionSubject>();
  const claims = new Map<string, { subject: CampusMotionSubject; claim: CampusMotionClaim }>();
  let limited = input.source_limited ?? false;
  const ordered = [...input.claims].sort((left, right) =>
    new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
    || left.occurrence_id.localeCompare(right.occurrence_id) || left.identity.localeCompare(right.identity));

  for (const record of ordered) {
    if (!input.campus_id || !record.identity || !record.occurrence_id
      || record.space_id !== null && !input.space_ids.has(record.space_id)
      || !Number.isSafeInteger(record.expected_count) || record.expected_count <= 0
      || record.kind !== "group" && record.expected_count !== 1
      || !record.source.domain || !record.source.record_id
      || !Number.isSafeInteger(record.source.revision) || record.source.revision < 1) continue;
    const startsAt = instant(record.starts_at), endsAt = instant(record.ends_at);
    if (!startsAt || !endsAt || startsAt >= endsAt) continue;
    // Person and self share the same identity domain. The endpoint decides which
    // one applies; adding a role never creates a second human.
    const subjectKey = key(record.kind === "group" ? "group" : "person", record.identity);
    const claimId = key("claim", `${subjectKey}:${record.occurrence_id}`);
    const retained = claims.get(claimId);
    if (retained) {
      if (retained.claim.source.revision >= record.source.revision) continue;
      Object.assign(retained.claim, { space_id: record.space_id, starts_at: startsAt, ends_at: endsAt,
        expected_count: record.expected_count, source: { ...record.source } });
      continue;
    }
    if (claims.size >= CLAIM_LIMIT || !subjects.has(subjectKey) && subjects.size >= SUBJECT_LIMIT) {
      limited = true; continue;
    }
    const subject = subjects.get(subjectKey) ?? { subject_key: subjectKey, kind: record.kind, claims: [] };
    subjects.set(subjectKey, subject);
    const claim: CampusMotionClaim = { id: claimId, space_id: record.space_id, starts_at: startsAt, ends_at: endsAt,
      expected_count: record.expected_count, spatial_claim: "expected_context_only", source: { ...record.source } };
    subject.claims.push(claim); claims.set(claimId, { subject, claim });
  }
  for (const subject of subjects.values()) subject.claims.sort((left, right) =>
    left.starts_at.localeCompare(right.starts_at) || left.id.localeCompare(right.id));

  const points = new Map<string, CampusMotionPoint>();
  for (const record of [...(input.points ?? [])].sort((left, right) =>
    new Date(right.observed_at).getTime() - new Date(left.observed_at).getTime() || left.id.localeCompare(right.id))) {
    const observedAt = instant(record.observed_at);
    if (!input.campus_id || !input.space_ids.has(record.space_id) || !observedAt
      || Date.parse(observedAt) > Date.parse(input.as_of) || points.has(record.id)) continue;
    if (points.size >= POINT_LIMIT) { limited = true; continue; }
    points.set(record.id, { id: record.id, space_id: record.space_id, observed_at: observedAt, dimension: record.dimension,
      spatial_claim: "point_observation_only", source: { ...record.source } });
  }
  return { schema_version: 1, school_id: input.school_id, campus_id: input.campus_id, as_of: input.as_of,
    environment: { ...input.environment }, subjects: [...subjects.values()], points: [...points.values()],
    limits: { subjects: SUBJECT_LIMIT, claims: CLAIM_LIMIT, points: POINT_LIMIT, source_limited: limited },
    limitations: ["Figures illustrate authorized scheduled expectations, not tracked people or measured occupancy.",
      "A scan is a timestamped point observation, not continuous presence.",
      ...(limited ? ["This read reached a bounded source or display limit; scheduled context may be incomplete."] : [])] };
}
