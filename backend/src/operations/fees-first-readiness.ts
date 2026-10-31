import { ForbiddenException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import type { HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { operationalFeeAccess } from "./operational-fee-access.js";

type Db = Kysely<Database> | Transaction<Database>;
export const feesHubPath = "/areas/fees/ledger";
export const feesSetupPath = "/more/setup/capabilities?task=fees";
export interface FeesOperationReadiness {
  actor_user_id: string; environment_namespace_id: string;
  action: "record_charge" | "view" | "unavailable";
  state: "ready_to_record" | "charge_recorded" | "unavailable";
  scope: { kind: "invoice"; id: string; person_id: string } | { kind: "batch"; id: string; person_count: number } | null;
  source_revision: number | null; evaluated_at: string; requires_recheck: true; destination: string;
}
export function feesInvoiceDestination(source: { id: string; person_id: string }) {
  return `${feesHubPath}?${new URLSearchParams({ person_id: source.person_id, invoice_id: source.id }).toString()}`;
}
export function feesBatchDestination(source: { id: string }) {
  return `${feesHubPath}?${new URLSearchParams({ batch_id: source.id }).toString()}`;
}
export function parseFeesContinuation(path: string) {
  if (path.length > 180 || !path.startsWith("/") || path.startsWith("//")) return null;
  const url = new URL(path, "https://thatcampus.invalid");
  if (url.origin !== "https://thatcampus.invalid" || url.pathname !== feesHubPath || url.hash) return null;
  if (url.searchParams.has("batch_id")) {
    if ([...url.searchParams.keys()].some(key => key !== "batch_id") || url.searchParams.getAll("batch_id").length !== 1) return null;
    const batch = z.uuid().safeParse(url.searchParams.get("batch_id"));
    return batch.success ? { batch_id: batch.data } : null;
  }
  if ([...url.searchParams.keys()].some(key => !["person_id", "invoice_id"].includes(key))
    || ["person_id", "invoice_id"].some(key => url.searchParams.getAll(key).length !== 1)) return null;
  const person = z.uuid().safeParse(url.searchParams.get("person_id"));
  const invoice = z.uuid().safeParse(url.searchParams.get("invoice_id"));
  return person.success && invoice.success ? { person_id: person.data, invoice_id: invoice.data } : null;
}
async function currentIssuer(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const world = executionEnvironmentStorage.getStore();
  if (!identities || !user.is_active || user.active_school_id !== schoolId || world && world.institution_id !== schoolId) return null;
  const identity = await identities.resolveAccountEndpoint(db as Transaction<Database>, {
    school_id: schoolId, user_id: user.id, at: executionNow().toISOString(),
  });
  if (!identity.acting) return null;
  try { await operationalFeeAccess(db, user.id, schoolId); }
  catch (error) { if (error instanceof ForbiddenException) return null; throw error; }
  return identity;
}
/** A recorded charge is an obligation, never proof of payment or plan authority. */
export async function resolveFeesContinuation(db: Db, identities: HumanAgentIdentityPort | undefined,
  user: AuthUser, schoolId: string, path: string) {
  const parsed = parseFeesContinuation(path);
  if (!parsed || !await currentIssuer(db, identities, user, schoolId)) return null;
  if ("batch_id" in parsed) {
    const source = (await sql<{ id: string; person_count: number; created_by: string }>`SELECT id,person_count,created_by
      FROM fee_charge_batches WHERE school_id=${schoolId}::uuid AND id=${parsed.batch_id}::uuid`.execute(db)).rows[0];
    if (!source || source.created_by !== user.id) return null;
    return { kind: "batch" as const, source, path: feesBatchDestination(source) };
  }
  const source = await db.selectFrom("fee_invoices").select(["id", "person_id", "created_by"])
    .where("school_id", "=", schoolId).where("id", "=", parsed.invoice_id)
    .where("person_id", "=", parsed.person_id).where("student_id", "is", null).executeTakeFirst();
  if (!source?.person_id || source.created_by !== user.id) return null;
  return { kind: "invoice" as const, source: { ...source, person_id: source.person_id }, path: feesInvoiceDestination({ id: source.id, person_id: source.person_id }) };
}
export async function vettedFeesResume(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser,
  workspace: { school_id: string; owner_user_id: string | null; resume_step: string; resume_path: string }) {
  const source = workspace.owner_user_id === user.id
    ? await resolveFeesContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
  return source ? { step: "operating" as const, path: source.path }
    : { step: "first_use" as const, path: feesHubPath };
}
export async function readFeesReadiness(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const base = { actor_user_id: user.id, environment_namespace_id: executionEnvironmentStorage.getStore()?.namespace_id ?? `live:${schoolId}`,
    evaluated_at: executionNow().toISOString(), requires_recheck: true as const };
  if (!await currentIssuer(db, identities, user, schoolId)) return { operation: { ...base, action: "unavailable", state: "unavailable",
    scope: null, source_revision: null, destination: feesHubPath } satisfies FeesOperationReadiness };
  const retained = await db.selectFrom("progressive_onboarding_workspaces").select("resume_path")
    .where("school_id", "=", schoolId).where("owner_user_id", "=", user.id).where("resume_goal_key", "=", "fees").executeTakeFirst();
  const source = retained ? await resolveFeesContinuation(db, identities, user, schoolId, retained.resume_path) : null;
  return { operation: source ? { ...base, action: "view", state: "charge_recorded",
    scope: source.kind === "batch" ? { kind: "batch", id: source.source.id, person_count: source.source.person_count }
      : { kind: "invoice", id: source.source.id, person_id: source.source.person_id }, source_revision: 1,
    destination: source.path } satisfies FeesOperationReadiness
    : { ...base, action: "record_charge", state: "ready_to_record", scope: null, source_revision: null,
      destination: feesHubPath } satisfies FeesOperationReadiness };
}
