import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import type { Database } from "../database/types.js";
import type { HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";

type Db = Kysely<Database> | Transaction<Database>;
type Source = { id: string; author_id: string; context_kind: "class_term" | "learning_offering"; offering_id: string | null;
  class_section_id: string | null; term_id: string | null; state: string; revision: number };
export interface AssignmentsOperationReadiness {
  actor_user_id: string; environment_namespace_id: string; action: "create" | "continue" | "view" | "unavailable";
  state: "requires_setup" | "ready_to_create" | "draft" | "published" | "unavailable";
  scope: { kind: "class" | "offering" | "person" | "assignment"; id: string } | null;
  source_revision: number | null; evaluated_at: string; requires_recheck: true; destination: string;
  recovery?: "source_changed" | "source_unavailable" | "authority_changed";
}
export interface AssignmentContextReadiness {
  kind: "class" | "offering" | "person"; id: string; label: string; href: string; can_manage: boolean; can_publish?: boolean; can_review?: boolean;
}
export const assignmentsHubPath = "/areas/messages/assignments";
export function assignmentContinuationPath(source: Pick<Source, "id" | "revision" | "context_kind" | "offering_id" | "class_section_id">, expectedRevision = source.revision) {
  const query = new URLSearchParams(source.context_kind === "learning_offering"
    ? { scope: "offering", offering_id: source.offering_id! } : { scope: "class", class_section_id: source.class_section_id! });
  query.set("assignment", source.id); query.set("revision", String(expectedRevision));
  return `${assignmentsHubPath}?${query.toString()}`;
}
export function parseAssignmentContinuation(path: string) {
  if (path.length > 180 || !path.startsWith("/") || path.startsWith("//")) return null;
  const url = new URL(path, "https://thatcampus.invalid"), scope = url.searchParams.get("scope");
  const contextKey = scope === "offering" ? "offering_id" : "class_section_id";
  if (url.origin !== "https://thatcampus.invalid" || url.pathname !== assignmentsHubPath || url.hash || !["class", "offering"].includes(scope ?? "")
    || [...url.searchParams.keys()].some(key => !["scope", contextKey, "assignment", "revision"].includes(key))
    || ["scope", contextKey, "assignment", "revision"].some(key => url.searchParams.getAll(key).length !== 1)
    || !/^[1-9]\d*$/u.test(url.searchParams.get("revision") ?? "")) return null;
  const id = z.uuid().safeParse(url.searchParams.get("assignment")), context = z.uuid().safeParse(url.searchParams.get(contextKey));
  const revision = Number(url.searchParams.get("revision"));
  return id.success && context.success && Number.isSafeInteger(revision)
    ? { id: id.data, context_kind: scope === "offering" ? "learning_offering" as const : "class_term" as const, context_id: context.data, expected_revision: revision } : null;
}
async function identityFor(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const world = executionEnvironmentStorage.getStore();
  if (!identities || !user.is_active || user.active_school_id !== schoolId || world && world.institution_id !== schoolId) return null;
  const identity = await identities.resolveAccountEndpoint(db as Transaction<Database>, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
  return identity.acting ? identity : null;
}
async function canTeach(db: Db, user: AuthUser, schoolId: string, personId: string, source: Source) {
  return Boolean((await sql<{ allowed: boolean }>`SELECT CASE WHEN ${source.context_kind}='learning_offering'
    THEN learning_offering_person_can_teach(${schoolId}::uuid,${source.offering_id}::uuid,${user.id}::uuid,${personId}::uuid,'publish',${executionNow()}::timestamptz)
    ELSE EXISTS(SELECT 1 FROM staff_role_bindings binding JOIN staff_profiles staff ON staff.school_id=binding.school_id AND staff.user_id=binding.user_id
      JOIN schools campus ON campus.id=binding.school_id
      WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid AND staff.person_id=${personId}::uuid AND staff.status='active'
        AND binding.context_kind='class' AND binding.scope_id=${source.class_section_id}::uuid AND binding.status='active' AND binding.role_active
        AND 'learning.assignments.manage'=ANY(binding.permissions) AND (binding.subject_id IS NULL OR binding.subject_id=(SELECT subject_id FROM learning_assignments WHERE id=${source.id}::uuid))
        AND (${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date>=binding.starts_on
        AND (binding.ends_on IS NULL OR (${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date<=binding.ends_on)) END AS allowed`.execute(db)).rows[0]?.allowed);
}
export async function resolveAssignmentContinuation(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string, path: string) {
  const parsed = parseAssignmentContinuation(path), identity = await identityFor(db, identities, user, schoolId);
  if (!parsed || !identity) return null;
  const source = await db.selectFrom("learning_assignments").selectAll().where("school_id", "=", schoolId).where("id", "=", parsed.id).executeTakeFirst();
  if (!source || source.author_id !== user.id || source.context_kind !== parsed.context_kind
    || !["draft", "published"].includes(source.state) || (source.offering_id ?? source.class_section_id) !== parsed.context_id || !await canTeach(db, user, schoolId, identity.person_id, source)
    || source.context_kind === "learning_offering" && source.author_person_id !== identity.person_id) return null;
  return { source, path: assignmentContinuationPath(source, parsed.expected_revision),
    ...(source.revision !== parsed.expected_revision ? { recovery: "source_changed" as const } : {}) };
}
export async function vettedAssignmentsResume(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser,
  workspace: { school_id: string; owner_user_id: string | null; resume_step: string; resume_path: string }) {
  const found = workspace.owner_user_id === user.id ? await resolveAssignmentContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
  if (!found) return { step: "first_use" as const, path: assignmentsHubPath };
  const step = found.source.state === "draft" ? "first_use" as const : "operating" as const;
  return { step, path: found.path, ...(found.recovery ? { recovery: found.recovery } : {}),
    ...(step === "first_use" ? { continuation: { kind: "learning_assignment" as const, actor_user_id: user.id, school_id: workspace.school_id,
      source_id: found.source.id, source_revision: found.source.revision, requires_recheck: true as const } } : {}) };
}
export async function readAssignmentsReadiness(db: Db, identities: HumanAgentIdentityPort | undefined, user: AuthUser, schoolId: string) {
  const world = executionEnvironmentStorage.getStore(), now = executionNow(), contexts: AssignmentContextReadiness[] = [];
  const base = { actor_user_id: user.id, environment_namespace_id: world?.namespace_id ?? `live:${schoolId}`, evaluated_at: now.toISOString(), requires_recheck: true as const };
  const identity = await identityFor(db, identities, user, schoolId);
  if (!identity) return { can_setup: false, contexts, academic_person_id: null, operation: { ...base, action: "unavailable", state: "unavailable", scope: null, source_revision: null, destination: assignmentsHubPath } satisfies AssignmentsOperationReadiness };
  const academic = (await sql<{ available: boolean }>`SELECT EXISTS(
    SELECT 1 FROM learning_offering_enrollments enrollment JOIN learning_offerings offering ON offering.school_id=enrollment.school_id AND offering.id=enrollment.offering_id
    JOIN learning_offering_academic_contexts binding ON binding.school_id=offering.school_id AND binding.offering_id=offering.id JOIN schools school ON school.id=enrollment.school_id
    WHERE enrollment.school_id=${schoolId}::uuid AND enrollment.person_id=${identity.person_id}::uuid AND offering.state='active'
      AND enrollment.starts_on<=(${now}::timestamptz AT TIME ZONE school.timezone)::date
      AND(enrollment.ends_on IS NULL OR enrollment.ends_on>(${now}::timestamptz AT TIME ZONE school.timezone)::date)
    UNION ALL SELECT 1 FROM assessment_publication_results result WHERE result.school_id=${schoolId}::uuid AND result.person_id=${identity.person_id}::uuid AND result.student_id IS NULL
    UNION ALL SELECT 1 FROM grading_report_students report JOIN grading_report_batches batch ON batch.school_id=report.school_id AND batch.id=report.batch_id AND batch.status='published'
      WHERE report.school_id=${schoolId}::uuid AND report.person_id=${identity.person_id}::uuid AND report.student_id IS NULL
  ) AS available`.execute(db)).rows[0]!.available;
  const academicPersonId = academic ? identity.person_id : null;
  const canSetup = Boolean(await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).where("role", "=", "admin").executeTakeFirst());
  const classes = (await sql<{ id: string; label: string }>`SELECT DISTINCT section.id,concat('Class ',section.grade,section.section) AS label
    FROM staff_role_bindings binding JOIN staff_profiles staff ON staff.school_id=binding.school_id AND staff.user_id=binding.user_id
    JOIN class_sections section ON section.id=binding.scope_id AND section.school_id=binding.school_id JOIN schools campus ON campus.id=binding.school_id
    WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid AND staff.person_id=${identity.person_id}::uuid AND staff.status='active'
      AND binding.context_kind='class' AND binding.status='active' AND binding.role_active AND 'learning.assignments.manage'=ANY(binding.permissions)
      AND (${now}::timestamptz AT TIME ZONE campus.timezone)::date>=binding.starts_on
      AND (binding.ends_on IS NULL OR (${now}::timestamptz AT TIME ZONE campus.timezone)::date<=binding.ends_on) ORDER BY label,section.id LIMIT 100`.execute(db)).rows;
  for (const row of classes) contexts.push({ kind: "class", id: row.id, label: row.label, href: `${assignmentsHubPath}?scope=class&class_section_id=${row.id}`, can_manage: true, can_publish: true, can_review: true });
  const offerings = (await sql<{ id: string; name: string; can_publish: boolean; can_review: boolean }>`SELECT offering.id,offering.name,bool_or(appointment.can_publish) AS can_publish,bool_or(appointment.can_review) AS can_review
    FROM learning_offerings offering JOIN learning_offering_teaching_assignments appointment ON appointment.school_id=offering.school_id AND appointment.offering_id=offering.id
    JOIN schools campus ON campus.id=offering.school_id WHERE offering.school_id=${schoolId}::uuid AND offering.state='active' AND appointment.person_id=${identity.person_id}::uuid
      AND appointment.starts_on<=(${now}::timestamptz AT TIME ZONE campus.timezone)::date
      AND (appointment.ends_on IS NULL OR appointment.ends_on>(${now}::timestamptz AT TIME ZONE campus.timezone)::date)
    GROUP BY offering.id ORDER BY offering.name,offering.id LIMIT 100`.execute(db)).rows;
  for (const row of offerings) contexts.push({ kind: "offering", id: row.id, label: row.name, href: `${assignmentsHubPath}?scope=offering&offering_id=${row.id}`, can_manage: row.can_publish, can_publish: row.can_publish, can_review: row.can_review });
  const learner = await db.selectFrom("learning_assignment_audience as audience").innerJoin("learning_assignments as assignment", "assignment.id", "audience.assignment_id")
    .select("audience.person_id").where("audience.school_id", "=", schoolId).where("audience.person_id", "=", identity.person_id).where("assignment.context_kind", "=", "learning_offering").executeTakeFirst();
  const registered = (await sql<{ id: string }>`SELECT enrollment.id FROM learning_offering_enrollments enrollment JOIN learning_offerings offering ON offering.id=enrollment.offering_id AND offering.school_id=enrollment.school_id
    JOIN schools campus ON campus.id=enrollment.school_id WHERE enrollment.school_id=${schoolId}::uuid AND enrollment.person_id=${identity.person_id}::uuid AND offering.state='active'
      AND enrollment.starts_on<=(${now}::timestamptz AT TIME ZONE campus.timezone)::date
      AND(enrollment.ends_on IS NULL OR enrollment.ends_on>(${now}::timestamptz AT TIME ZONE campus.timezone)::date) LIMIT 1`.execute(db)).rows[0];
  if (learner || registered) contexts.push({ kind: "person", id: identity.person_id, label: "My assignments", href: `${assignmentsHubPath}?scope=person&person_id=${identity.person_id}`, can_manage: false });
  const retained = await db.selectFrom("progressive_onboarding_workspaces").select("resume_path").where("school_id", "=", schoolId).where("owner_user_id", "=", user.id).where("resume_goal_key", "=", "assignments").executeTakeFirst();
  const preferred = retained ? await resolveAssignmentContinuation(db, identities, user, schoolId, retained.resume_path) : null;
  if (preferred) return { can_setup: canSetup, contexts, academic_person_id: academicPersonId, operation: { ...base, action: preferred.source.state === "draft" ? "continue" : "view", state: preferred.source.state,
    scope: { kind: "assignment", id: preferred.source.id }, source_revision: preferred.source.revision, destination: preferred.path,
    ...(preferred.recovery ? { recovery: preferred.recovery } : {}) } satisfies AssignmentsOperationReadiness };
  const primary = contexts.find(item => item.can_manage) ?? contexts[0];
  return { can_setup: canSetup, contexts, academic_person_id: academicPersonId, operation: { ...base, action: primary ? primary.can_manage ? "create" : "view" : canSetup ? "create" : "unavailable",
    state: primary || canSetup ? "ready_to_create" : "requires_setup", scope: primary ? { kind: primary.kind, id: primary.id } : null,
    source_revision: null, destination: primary?.href ?? assignmentsHubPath } satisfies AssignmentsOperationReadiness };
}
