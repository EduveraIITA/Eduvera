import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
export const feeChargeGroupKind = z.enum(["participation", "class", "organization", "learning"]);
export const feeChargeSelectionSchema = z.object({
    person_ids: z.array(z.uuid()).max(500),
    groups: z.array(z.object({ kind: feeChargeGroupKind, id: z.uuid() }).strict()).max(20),
}).strict().refine(value => value.person_ids.length + value.groups.length > 0, "Choose at least one person or group.");
function assertPurpose(scope) {
    if (scope.purpose !== "fee_charge_issue")
        throw new ForbiddenException("This People adapter is limited to charge selection.");
}
function canonicalSelection(selection) {
    return { person_ids: [...new Set(selection.person_ids)].sort(), groups: [...new Map(selection.groups.map(group => [`${group.kind}:${group.id}`, group])).values()]
            .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)) };
}
/** Purpose-specific People read adapter. Finance must establish current scoped access
 * before calling it; no SIS permission, protected profile or account state is returned. */
export async function feeChargeAudienceCatalogue(tx, scope, input) {
    assertPurpose(scope);
    const { school_id: schoolId, today } = scope, offset = (input.page - 1) * 25;
    if (input.kind === "people") {
        return (await sql `WITH matching AS (
      SELECT id,trim(concat_ws(' ',first_name,last_name)) AS label,revision FROM school_people
      WHERE school_id=${schoolId}::uuid AND retired_at IS NULL
        AND (${input.search}='' OR strpos(lower(trim(concat_ws(' ',first_name,last_name))),lower(${input.search}))>0)
    ), page AS (SELECT * FROM matching ORDER BY lower(label),id LIMIT 25 OFFSET ${offset})
    SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(label),id) FROM page),'[]'::jsonb) AS results,
      (SELECT count(*)::int FROM matching) AS total`.execute(tx)).rows[0];
    }
    return (await sql `WITH catalogue AS (
    SELECT g.id,'participation'::text AS kind,g.name,(SELECT count(DISTINCT m.person_id)::int
      FROM participation_group_members m JOIN school_people p ON p.school_id=m.school_id AND p.id=m.person_id
      WHERE m.school_id=g.school_id AND m.group_id=g.id AND p.retired_at IS NULL
        AND m.starts_on<=${today}::date AND(m.ends_on IS NULL OR m.ends_on>=${today}::date)) AS member_count
      FROM participation_groups g WHERE g.school_id=${schoolId}::uuid AND g.is_active
    UNION ALL SELECT c.id,'class','Class '||c.grade||c.section||' · '||c.academic_year,
      (SELECT count(DISTINCT p.id)::int FROM enrollments e JOIN students s ON s.id=e.student_id AND s.school_id=c.school_id
        JOIN school_people p ON p.school_id=s.school_id AND p.id=s.person_id JOIN academic_terms t ON t.id=e.term_id AND t.school_id=c.school_id
        WHERE e.class_section_id=c.id AND p.retired_at IS NULL AND e.enrolled_on<=${today}::date
          AND(e.inactive_from IS NULL OR e.inactive_from>${today}::date) AND t.academic_year=c.academic_year
          AND t.starts_on<=${today}::date AND t.ends_on>=${today}::date)
      FROM class_sections c WHERE c.school_id=${schoolId}::uuid
    UNION ALL SELECT n.id,'organization',n.name,(SELECT count(DISTINCT p.id)::int FROM organization_node_members m
      JOIN staff_profiles s ON s.school_id=m.school_id AND s.id=m.staff_id JOIN school_people p ON p.school_id=s.school_id AND p.id=s.person_id
      WHERE m.school_id=n.school_id AND m.node_id=n.id AND p.retired_at IS NULL)
      FROM organization_nodes n WHERE n.school_id=${schoolId}::uuid AND ${scope.organization_visible}
    UNION ALL SELECT o.id,'learning',o.name,(SELECT count(DISTINCT e.person_id)::int FROM learning_offering_enrollments e
      JOIN school_people p ON p.school_id=e.school_id AND p.id=e.person_id WHERE e.school_id=o.school_id AND e.offering_id=o.id
        AND p.retired_at IS NULL AND e.starts_on<=${today}::date AND(e.ends_on IS NULL OR e.ends_on>${today}::date))
      FROM learning_offerings o WHERE o.school_id=${schoolId}::uuid AND o.state='active'
  ), matching AS (SELECT * FROM catalogue WHERE ${input.search}='' OR strpos(lower(name),lower(${input.search}))>0),
    page AS (SELECT * FROM matching ORDER BY lower(name),kind,id LIMIT 25 OFFSET ${offset})
  SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY lower(name),kind,id) FROM page),'[]'::jsonb) AS results,
    (SELECT count(*)::int FROM matching) AS total`.execute(tx)).rows[0];
}
async function readGroup(tx, scope, group, lock) {
    const { school_id: schoolId, today } = scope;
    if (group.kind === "organization" && !scope.organization_visible)
        throw new ForbiddenException("Organization groups require current administrator access.");
    const source = group.kind === "participation"
        ? (await sql `SELECT name,jsonb_build_object('id',id,'revision',revision,'is_active',is_active) AS fact
        FROM participation_groups WHERE school_id=${schoolId}::uuid AND id=${group.id}::uuid AND is_active ${lock ? sql `FOR SHARE` : sql ``}`.execute(tx)).rows[0]
        : group.kind === "learning"
            ? (await sql `SELECT name,jsonb_build_object('id',id,'revision',revision,'state',state) AS fact
          FROM learning_offerings WHERE school_id=${schoolId}::uuid AND id=${group.id}::uuid AND state='active' ${lock ? sql `FOR SHARE` : sql ``}`.execute(tx)).rows[0]
            : group.kind === "class"
                ? (await sql `SELECT 'Class '||grade||section||' · '||academic_year AS name,
            jsonb_build_object('id',id,'revision',revision,'academic_year',academic_year) AS fact FROM class_sections
            WHERE school_id=${schoolId}::uuid AND id=${group.id}::uuid ${lock ? sql `FOR SHARE` : sql ``}`.execute(tx)).rows[0]
                : (await sql `SELECT n.name,jsonb_build_object('id',n.id,'structure_revision',s.revision) AS fact
            FROM organization_nodes n JOIN organization_structures s ON s.school_id=n.school_id
            WHERE n.school_id=${schoolId}::uuid AND n.id=${group.id}::uuid ${lock ? sql `FOR SHARE OF n,s` : sql ``}`.execute(tx)).rows[0];
    if (!source)
        throw new BadRequestException("A selected group is no longer available in this campus. Review the audience again.");
    const members = group.kind === "participation"
        ? (await sql `SELECT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS name,p.revision,
        jsonb_build_object('id',m.id,'revision',m.revision,'starts_on',m.starts_on::text,'ends_on',m.ends_on::text) AS source
        FROM participation_group_members m JOIN school_people p ON p.school_id=m.school_id AND p.id=m.person_id
        WHERE m.school_id=${schoolId}::uuid AND m.group_id=${group.id}::uuid AND p.retired_at IS NULL
          AND m.starts_on<=${today}::date AND(m.ends_on IS NULL OR m.ends_on>=${today}::date)
        ORDER BY p.id,m.id ${lock ? sql `FOR SHARE OF m,p` : sql ``}`.execute(tx)).rows
        : group.kind === "learning"
            ? (await sql `SELECT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS name,p.revision,
          jsonb_build_object('id',m.id,'revision',m.revision,'starts_on',m.starts_on::text,'ends_on',m.ends_on::text) AS source
          FROM learning_offering_enrollments m JOIN school_people p ON p.school_id=m.school_id AND p.id=m.person_id
          WHERE m.school_id=${schoolId}::uuid AND m.offering_id=${group.id}::uuid AND p.retired_at IS NULL
            AND m.starts_on<=${today}::date AND(m.ends_on IS NULL OR m.ends_on>${today}::date)
          ORDER BY p.id,m.id ${lock ? sql `FOR SHARE OF m,p` : sql ``}`.execute(tx)).rows
            : group.kind === "class"
                ? (await sql `SELECT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS name,p.revision,
            jsonb_build_object('id',m.id,'revision',m.revision,'student_id',s.id,'term_id',t.id,'term_revision',t.revision,
              'enrolled_on',m.enrolled_on::text,'inactive_from',m.inactive_from::text,'term_starts_on',t.starts_on::text,'term_ends_on',t.ends_on::text) AS source
            FROM enrollments m JOIN students s ON s.id=m.student_id AND s.school_id=${schoolId}::uuid
            JOIN school_people p ON p.school_id=s.school_id AND p.id=s.person_id JOIN academic_terms t ON t.id=m.term_id AND t.school_id=s.school_id
            JOIN class_sections c ON c.school_id=s.school_id AND c.id=m.class_section_id AND c.academic_year=t.academic_year
            WHERE c.id=${group.id}::uuid AND p.retired_at IS NULL AND m.enrolled_on<=${today}::date
              AND(m.inactive_from IS NULL OR m.inactive_from>${today}::date) AND t.starts_on<=${today}::date AND t.ends_on>=${today}::date
            ORDER BY p.id,m.id ${lock ? sql `FOR SHARE OF m,s,p,t,c` : sql ``}`.execute(tx)).rows
                : (await sql `SELECT p.id AS person_id,trim(concat_ws(' ',p.first_name,p.last_name)) AS name,p.revision,
            jsonb_build_object('node_id',m.node_id,'staff_id',m.staff_id) AS source FROM organization_node_members m
            JOIN staff_profiles s ON s.school_id=m.school_id AND s.id=m.staff_id JOIN school_people p ON p.school_id=s.school_id AND p.id=s.person_id
            WHERE m.school_id=${schoolId}::uuid AND m.node_id=${group.id}::uuid AND p.retired_at IS NULL
            ORDER BY p.id,m.staff_id ${lock ? sql `FOR SHARE OF m,s,p` : sql ``}`.execute(tx)).rows;
    return { ...group, name: source.name, source: source.fact, members };
}
/** One coherent transaction snapshot, not a monotonic roster version or future rule. */
export async function feeChargeAudienceSnapshot(tx, scope, raw, lock = false) {
    assertPurpose(scope);
    const selection = canonicalSelection(feeChargeSelectionSchema.parse(raw)), groups = [];
    for (const group of selection.groups)
        groups.push(await readGroup(tx, scope, group, lock));
    const direct = selection.person_ids.length ? (await sql `SELECT id AS person_id,trim(concat_ws(' ',first_name,last_name)) AS name,revision
    FROM school_people WHERE school_id=${scope.school_id}::uuid AND id=ANY(${selection.person_ids}::uuid[]) AND retired_at IS NULL
    ORDER BY id ${lock ? sql `FOR SHARE` : sql ``}`.execute(tx)).rows : [];
    if (direct.length !== selection.person_ids.length)
        throw new BadRequestException("A selected person is no longer available in this campus. Review the audience again.");
    const people = [...new Map([...direct, ...groups.flatMap(group => group.members)].map(person => [person.person_id,
            { person_id: person.person_id, name: person.name, revision: person.revision }])).values()].sort((a, b) => a.person_id.localeCompare(b.person_id));
    if (!people.length)
        throw new BadRequestException("The selected groups have no current people. Choose people or a current group.");
    if (people.length > 500)
        throw new BadRequestException("Choose at most 500 unique people. This selection was not split or recorded.");
    const summaries = groups.map(group => ({ kind: group.kind, id: group.id, name: group.name,
        member_count: new Set(group.members.map(person => person.person_id)).size }));
    return { selection, today: scope.today, people, groups: summaries, person_count: people.length,
        duplicate_count: raw.person_ids.length + summaries.reduce((sum, group) => sum + group.member_count, 0) - people.length,
        evidence: { version: 1, school_id: scope.school_id, environment_namespace_id: scope.environment_namespace_id, today: scope.today, selection, direct, people,
            groups: groups.map(group => ({ kind: group.kind, id: group.id, name: group.name, source: group.source, members: group.members })) } };
}
//# sourceMappingURL=fee-charge-audience.js.map