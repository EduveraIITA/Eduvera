import { ForbiddenException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import type { HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { institutionSchoolPermissionForUser } from "../roles/authorization.js";

type Db = Kysely<Database> | Transaction<Database>;
export const facilitiesPath = "/areas/facilities";
export const facilitiesSetupPath = "/more/setup/capabilities?task=facilities";
export const facilitiesDestination = (id: string) => `${facilitiesPath}?repair_id=${id}`;
export interface FacilitiesOperationReadiness {
  actor_user_id: string; environment_namespace_id: string;
  action: "report" | "view" | "configure" | "unavailable";
  state: "repair_recorded" | "ready_to_report" | "needs_intake" | "unavailable";
  scope: { kind: "repair"; id: string } | null; source_revision: number | null;
  evaluated_at: string; requires_recheck: true; destination: string;
}

export function parseFacilitiesContinuation(path: string) {
  if (path.length > 180 || !path.startsWith("/") || path.startsWith("//")) return null;
  const url = new URL(path, "https://thatcampus.invalid");
  if (url.origin !== "https://thatcampus.invalid" || url.pathname !== facilitiesPath || url.hash
    || [...url.searchParams.keys()].some(key => key !== "repair_id") || url.searchParams.getAll("repair_id").length !== 1) return null;
  const parsed = z.uuid().safeParse(url.searchParams.get("repair_id"));
  return parsed.success ? { repair_id: parsed.data } : null;
}

async function identity(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const world = executionEnvironmentStorage.getStore();
  if (!identities || !user.is_active || user.active_school_id !== schoolId || world && world.institution_id !== schoolId) return null;
  const actor = await identities.resolveAccountEndpoint(db as Transaction<Database>, {
    school_id: schoolId, user_id: user.id, at: executionNow().toISOString(),
  });
  if (!actor.acting) return null;
  let canManage = false;
  try { await institutionSchoolPermissionForUser(db, user.id, schoolId, "facilities.manage", true); canManage = true; }
  catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
  return { person_id: actor.person_id, can_manage: canManage };
}

type Repair = { id: string; revision: number; reporter_person_id: string; recorder_person_id: string; coordinator_person_id: string; handler_person_id: string; verifier_person_id: string };
export async function resolveFacilitiesContinuation(db: Db, identities: HumanAgentIdentityPort | undefined,
  user: AuthUser, schoolId: string, path: string) {
  const parsed = parseFacilitiesContinuation(path), actor = await identity(db, identities, user, schoolId);
  if (!parsed || !actor) return null;
  // A technical manager is not automatically a participant in every private repair.
  const source = (await sql<Repair>`SELECT id,revision,reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id
    FROM facilities_repairs WHERE school_id=${schoolId}::uuid AND id=${parsed.repair_id}::uuid
      AND ${actor.person_id}::uuid IN(reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id)`.execute(db)).rows[0];
  return source ? { source, path: facilitiesDestination(source.id) } : null;
}

export async function vettedFacilitiesResume(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser,
  workspace: { school_id: string; owner_user_id: string | null; resume_path: string }) {
  const accepted = workspace.owner_user_id === user.id
    ? await resolveFacilitiesContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
  return accepted ? { step: "operating" as const, path: accepted.path }
    : { step: "first_use" as const, path: facilitiesPath };
}

export async function readFacilitiesReadiness(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const base = { actor_user_id: user.id, environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
    evaluated_at: executionNow().toISOString(), requires_recheck: true as const };
  const actor = await identity(db, identities, user, schoolId);
  const source = actor ? (await sql<Repair>`SELECT id,revision,reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id
    FROM facilities_repairs WHERE school_id=${schoolId}::uuid
      AND ${actor.person_id}::uuid IN(reporter_person_id,recorder_person_id,coordinator_person_id,handler_person_id,verifier_person_id)
    ORDER BY created_at DESC,id DESC LIMIT 1`.execute(db)).rows[0] : undefined;
  let routeReady = false;
  if (actor && identities) {
    const rule = (await sql<{ handler_person_id: string; verifier_mode: string; verifier_person_id: string | null }>`
      SELECT handler_person_id,verifier_mode,verifier_person_id FROM facilities_intake_rules
      WHERE school_id=${schoolId}::uuid ORDER BY revision DESC LIMIT 1`.execute(db)).rows[0];
    if (rule) {
      const handler = await identities.resolvePersonAgent(db as Transaction<Database>, {
        school_id: schoolId, person_id: rule.handler_person_id, at: base.evaluated_at,
      });
      // An accepted intake rule names the exact handling responsibility. Its
      // active recipient need not manage all repair settings or other people.
      routeReady = handler.acting;
      if (routeReady && rule.verifier_mode === "named") {
        routeReady = Boolean(rule.verifier_person_id && (await identities.resolvePersonAgent(db as Transaction<Database>, {
          school_id: schoolId, person_id: rule.verifier_person_id, at: base.evaluated_at,
        })).acting);
      }
    }
  }
  const operation: FacilitiesOperationReadiness = source
    ? { ...base, action: "view", state: "repair_recorded", scope: { kind: "repair", id: source.id }, source_revision: source.revision, destination: facilitiesDestination(source.id) }
    : { ...base, action: routeReady ? "report" : actor?.can_manage ? "configure" : "unavailable",
      state: routeReady ? "ready_to_report" : actor?.can_manage ? "needs_intake" : "unavailable",
      scope: null, source_revision: null, destination: facilitiesPath };
  return { operation };
}
