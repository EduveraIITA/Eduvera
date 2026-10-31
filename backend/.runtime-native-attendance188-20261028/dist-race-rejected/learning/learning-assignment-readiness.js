import { sql } from "kysely";
import { z } from "zod";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
export const assignmentsHubPath = "/areas/messages/assignments";
export function assignmentContinuationPath(source, expectedRevision = source.revision) {
    const query = new URLSearchParams(source.context_kind === "learning_offering"
        ? { scope: "offering", offering_id: source.offering_id } : { scope: "class", class_section_id: source.class_section_id });
    query.set("assignment", source.id);
    query.set("revision", String(expectedRevision));
    return `${assignmentsHubPath}?${query.toString()}`;
}
export function parseAssignmentContinuation(path) {
    if (path.length > 180 || !path.startsWith("/") || path.startsWith("//"))
        return null;
    const url = new URL(path, "https://thatcampus.invalid"), scope = url.searchParams.get("scope");
    const contextKey = scope === "offering" ? "offering_id" : "class_section_id";
    if (url.origin !== "https://thatcampus.invalid" || url.pathname !== assignmentsHubPath || url.hash || !["class", "offering"].includes(scope ?? "")
        || [...url.searchParams.keys()].some(key => !["scope", contextKey, "assignment", "revision"].includes(key))
        || ["scope", contextKey, "assignment", "revision"].some(key => url.searchParams.getAll(key).length !== 1)
        || !/^[1-9]\d*$/u.test(url.searchParams.get("revision") ?? ""))
        return null;
    const id = z.uuid().safeParse(url.searchParams.get("assignment")), context = z.uuid().safeParse(url.searchParams.get(contextKey));
    const revision = Number(url.searchParams.get("revision"));
    return id.success && context.success && Number.isSafeInteger(revision)
        ? { id: id.data, context_kind: scope === "offering" ? "learning_offering" : "class_term", context_id: context.data, expected_revision: revision } : null;
}
async function identityFor(db, identities, user, schoolId) {
    const world = executionEnvironmentStorage.getStore();
    if (!identities || !user.is_active || user.active_school_id !== schoolId || world && world.institution_id !== schoolId)
        return null;
    const identity = await identities.resolveAccountEndpoint(db, { school_id: schoolId, user_id: user.id, at: executionNow().toISOString() });
    return identity.acting ? identity : null;
}
async function canTeach(db, user, schoolId, personId, source) {
    return Boolean((await sql `SELECT CASE WHEN ${source.context_kind}='learning_offering'
    THEN learning_offering_person_can_teach(${schoolId}::uuid,${source.offering_id}::uuid,${user.id}::uuid,${personId}::uuid,'publish',${executionNow()}::timestamptz)
    ELSE EXISTS(SELECT 1 FROM staff_role_bindings binding JOIN staff_profiles staff ON staff.school_id=binding.school_id AND staff.user_id=binding.user_id
      JOIN schools campus ON campus.id=binding.school_id
      WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid AND staff.person_id=${personId}::uuid AND staff.status='active'
        AND binding.context_kind='class' AND binding.scope_id=${source.class_section_id}::uuid AND binding.status='active' AND binding.role_active
        AND 'learning.assignments.manage'=ANY(binding.permissions) AND (binding.subject_id IS NULL OR binding.subject_id=(SELECT subject_id FROM learning_assignments WHERE id=${source.id}::uuid))
        AND (${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date>=binding.starts_on
        AND (binding.ends_on IS NULL OR (${executionNow()}::timestamptz AT TIME ZONE campus.timezone)::date<=binding.ends_on)) END AS allowed`.execute(db)).rows[0]?.allowed);
}
export async function resolveAssignmentContinuation(db, identities, user, schoolId, path) {
    const parsed = parseAssignmentContinuation(path), identity = await identityFor(db, identities, user, schoolId);
    if (!parsed || !identity)
        return null;
    const source = await db.selectFrom("learning_assignments").selectAll().where("school_id", "=", schoolId).where("id", "=", parsed.id).executeTakeFirst();
    if (!source || source.author_id !== user.id || source.context_kind !== parsed.context_kind
        || !["draft", "published"].includes(source.state) || (source.offering_id ?? source.class_section_id) !== parsed.context_id || !await canTeach(db, user, schoolId, identity.person_id, source)
        || source.context_kind === "learning_offering" && source.author_person_id !== identity.person_id)
        return null;
    return { source, path: assignmentContinuationPath(source, parsed.expected_revision),
        ...(source.revision !== parsed.expected_revision ? { recovery: "source_changed" } : {}) };
}
export async function vettedAssignmentsResume(db, identities, user, workspace) {
    const found = workspace.owner_user_id === user.id ? await resolveAssignmentContinuation(db, identities, user, workspace.school_id, workspace.resume_path) : null;
    if (!found)
        return { step: "first_use", path: assignmentsHubPath };
    const step = found.source.state === "draft" ? "first_use" : "operating";
    return { step, path: found.path, ...(found.recovery ? { recovery: found.recovery } : {}),
        ...(step === "first_use" ? { continuation: { kind: "learning_assignment", actor_user_id: user.id, school_id: workspace.school_id,
                source_id: found.source.id, source_revision: found.source.revision, requires_recheck: true } } : {}) };
}
export async function readAssignmentsReadiness(db, identities, user, schoolId) {
    const world = executionEnvironmentStorage.getStore(), now = executionNow(), contexts = [];
    const base = { actor_user_id: user.id, environment_namespace_id: world?.namespace_id ?? `live:${schoolId}`, evaluated_at: now.toISOString(), requires_recheck: true };
    const identity = await identityFor(db, identities, user, schoolId);
    if (!identity)
        return { can_setup: false, contexts, operation: { ...base, action: "unavailable", state: "unavailable", scope: null, source_revision: null, destination: assignmentsHubPath } };
    const canSetup = Boolean(await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).where("role", "=", "admin").executeTakeFirst());
    const classes = (await sql `SELECT DISTINCT section.id,concat('Class ',section.grade,section.section) AS label
    FROM staff_role_bindings binding JOIN staff_profiles staff ON staff.school_id=binding.school_id AND staff.user_id=binding.user_id
    JOIN class_sections section ON section.id=binding.scope_id AND section.school_id=binding.school_id JOIN schools campus ON campus.id=binding.school_id
    WHERE binding.school_id=${schoolId}::uuid AND binding.user_id=${user.id}::uuid AND staff.person_id=${identity.person_id}::uuid AND staff.status='active'
      AND binding.context_kind='class' AND binding.status='active' AND binding.role_active AND 'learning.assignments.manage'=ANY(binding.permissions)
      AND (${now}::timestamptz AT TIME ZONE campus.timezone)::date>=binding.starts_on
      AND (binding.ends_on IS NULL OR (${now}::timestamptz AT TIME ZONE campus.timezone)::date<=binding.ends_on) ORDER BY label,section.id LIMIT 100`.execute(db)).rows;
    for (const row of classes)
        contexts.push({ kind: "class", id: row.id, label: row.label, href: `${assignmentsHubPath}?scope=class&class_section_id=${row.id}`, can_manage: true, can_publish: true, can_review: true });
    const offerings = (await sql `SELECT offering.id,offering.name,bool_or(appointment.can_publish) AS can_publish,bool_or(appointment.can_review) AS can_review
    FROM learning_offerings offering JOIN learning_offering_teaching_assignments appointment ON appointment.school_id=offering.school_id AND appointment.offering_id=offering.id
    JOIN schools campus ON campus.id=offering.school_id WHERE offering.school_id=${schoolId}::uuid AND offering.state='active' AND appointment.person_id=${identity.person_id}::uuid
      AND appointment.starts_on<=(${now}::timestamptz AT TIME ZONE campus.timezone)::date
      AND (appointment.ends_on IS NULL OR appointment.ends_on>(${now}::timestamptz AT TIME ZONE campus.timezone)::date)
    GROUP BY offering.id ORDER BY offering.name,offering.id LIMIT 100`.execute(db)).rows;
    for (const row of offerings)
        contexts.push({ kind: "offering", id: row.id, label: row.name, href: `${assignmentsHubPath}?scope=offering&offering_id=${row.id}`, can_manage: row.can_publish, can_publish: row.can_publish, can_review: row.can_review });
    const learner = await db.selectFrom("learning_assignment_audience as audience").innerJoin("learning_assignments as assignment", "assignment.id", "audience.assignment_id")
        .select("audience.person_id").where("audience.school_id", "=", schoolId).where("audience.person_id", "=", identity.person_id).where("assignment.context_kind", "=", "learning_offering").executeTakeFirst();
    const registered = (await sql `SELECT enrollment.id FROM learning_offering_enrollments enrollment JOIN learning_offerings offering ON offering.id=enrollment.offering_id AND offering.school_id=enrollment.school_id
    JOIN schools campus ON campus.id=enrollment.school_id WHERE enrollment.school_id=${schoolId}::uuid AND enrollment.person_id=${identity.person_id}::uuid AND offering.state='active'
      AND enrollment.starts_on<=(${now}::timestamptz AT TIME ZONE campus.timezone)::date
      AND(enrollment.ends_on IS NULL OR enrollment.ends_on>(${now}::timestamptz AT TIME ZONE campus.timezone)::date) LIMIT 1`.execute(db)).rows[0];
    if (learner || registered)
        contexts.push({ kind: "person", id: identity.person_id, label: "My assignments", href: `${assignmentsHubPath}?scope=person&person_id=${identity.person_id}`, can_manage: false });
    const retained = await db.selectFrom("progressive_onboarding_workspaces").select("resume_path").where("school_id", "=", schoolId).where("owner_user_id", "=", user.id).where("resume_goal_key", "=", "assignments").executeTakeFirst();
    const preferred = retained ? await resolveAssignmentContinuation(db, identities, user, schoolId, retained.resume_path) : null;
    if (preferred)
        return { can_setup: canSetup, contexts, operation: { ...base, action: preferred.source.state === "draft" ? "continue" : "view", state: preferred.source.state,
                scope: { kind: "assignment", id: preferred.source.id }, source_revision: preferred.source.revision, destination: preferred.path,
                ...(preferred.recovery ? { recovery: preferred.recovery } : {}) } };
    const primary = contexts.find(item => item.can_manage) ?? contexts[0];
    return { can_setup: canSetup, contexts, operation: { ...base, action: primary ? primary.can_manage ? "create" : "view" : canSetup ? "create" : "unavailable",
            state: primary || canSetup ? "ready_to_create" : "requires_setup", scope: primary ? { kind: primary.kind, id: primary.id } : null,
            source_revision: null, destination: primary?.href ?? assignmentsHubPath } };
}
//# sourceMappingURL=learning-assignment-readiness.js.map