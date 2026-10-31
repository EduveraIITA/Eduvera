import { ForbiddenException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import type { HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";

type Db = Kysely<Database> | Transaction<Database>;
export const accommodationPath = "/areas/accommodation";
export const accommodationSetupPath = "/more/setup/capabilities?task=accommodation";
export const accommodationDestination = (id: string) => `${accommodationPath}?stay_id=${id}`;

export interface AccommodationOperationReadiness {
  actor_user_id: string; environment_namespace_id: string;
  action: "view" | "offer" | "configure" | "unavailable";
  state: "arrangement_recorded" | "offer_recorded" | "ready_to_offer" | "needs_rooms" | "unavailable";
  scope: { kind: "stay"; id: string } | null; source_revision: number | null;
  evaluated_at: string; requires_recheck: true; destination: string;
}

/** Presentation state can select one source, never a resident, actor or world. */
export function parseAccommodationContinuation(path: string) {
  if (path.length > 180 || !path.startsWith("/") || path.startsWith("//")) return null;
  const url = new URL(path, "https://thatcampus.invalid");
  if (url.origin !== "https://thatcampus.invalid" || url.pathname !== accommodationPath || url.hash
    || [...url.searchParams.keys()].some(key => key !== "stay_id") || url.searchParams.getAll("stay_id").length !== 1) return null;
  const parsed = z.uuid().safeParse(url.searchParams.get("stay_id"));
  return parsed.success ? { stay_id: parsed.data } : null;
}

async function identity(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const world = executionEnvironmentStorage.getStore();
  if (!identities || !user.is_active || user.active_school_id !== schoolId || world && world.institution_id !== schoolId) return null;
  const actor = await identities.resolveAccountEndpoint(db as Transaction<Database>, {
    school_id: schoolId, user_id: user.id, at: executionNow().toISOString(),
  });
  if (!actor.acting) return null;
  let canOffer = false;
  try { await institutionSchoolPermissionForUser(db, user.id, schoolId, "accommodation.manage", true); canOffer = true; }
  catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
  return { person_id: actor.person_id, can_offer: canOffer };
}

type Stay = { id: string; revision: number; resident_person_id: string; coordinator_person_id: string;
  recorder_person_id: string; accepted_at: Date | string | null; state: string };

export async function resolveAccommodationContinuation(db: Db, identities: HumanAgentIdentityPort | undefined,
  user: AuthUser, schoolId: string, path: string) {
  const parsed = parseAccommodationContinuation(path), actor = await identity(db, identities, user, schoolId);
  if (!parsed || !actor) return null;
  // Setup authority never makes an unrelated manager a resident-data participant.
  const source = (await sql<Stay>`SELECT id,revision,resident_person_id,coordinator_person_id,recorder_person_id,accepted_at,state
    FROM accommodation_stays WHERE school_id=${schoolId}::uuid AND id=${parsed.stay_id}::uuid
      AND ${actor.person_id}::uuid IN(resident_person_id,coordinator_person_id,recorder_person_id)`.execute(db)).rows[0];
  return source ? { source, path: accommodationDestination(source.id) } : null;
}

export async function vettedAccommodationResume(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser,
  workspace: { school_id: string; owner_user_id: string | null; resume_path: string }) {
  const retained = workspace.owner_user_id === user.id
    ? await resolveAccommodationContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
  return retained ? { step: retained.source.accepted_at ? "operating" as const : "first_use" as const, path: retained.path }
    : { step: "first_use" as const, path: accommodationPath };
}

export async function readAccommodationReadiness(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const base = { actor_user_id: user.id, environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
    evaluated_at: executionNow().toISOString(), requires_recheck: true as const };
  const actor = await identity(db, identities, user, schoolId);
  const source = actor ? (await sql<Stay>`SELECT id,revision,resident_person_id,coordinator_person_id,recorder_person_id,accepted_at,state
    FROM accommodation_stays WHERE school_id=${schoolId}::uuid
      AND ${actor.person_id}::uuid IN(resident_person_id,coordinator_person_id,recorder_person_id)
      AND (accepted_at IS NOT NULL OR state='offered')
    ORDER BY (accepted_at IS NOT NULL) DESC,created_at DESC,id DESC LIMIT 1`.execute(db)).rows[0] : undefined;
  const hasRooms = actor?.can_offer ? Boolean((await sql`SELECT id FROM accommodation_rooms
    WHERE school_id=${schoolId}::uuid AND active LIMIT 1`.execute(db)).rows[0]) : false;
  const operation: AccommodationOperationReadiness = source
    ? { ...base, action: "view", state: source.accepted_at ? "arrangement_recorded" : "offer_recorded",
      scope: { kind: "stay", id: source.id }, source_revision: source.revision, destination: accommodationDestination(source.id) }
    : { ...base, action: actor?.can_offer ? hasRooms ? "offer" : "configure" : "unavailable",
      state: actor?.can_offer ? hasRooms ? "ready_to_offer" : "needs_rooms" : "unavailable",
      scope: null, source_revision: null, destination: accommodationPath };
  return { operation };
}
