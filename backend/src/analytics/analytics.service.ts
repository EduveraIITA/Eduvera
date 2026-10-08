import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { effectiveSchoolAccess } from "../roles/authorization.js";
import { SchoolService } from "../school/school.service.js";
import { addCounts, attendanceMetric, attendanceTrend, dateOffset, emptyCounts, round, type AttendanceCounts } from "./analytics-metrics.js";
import { institutionSnapshot, registerSubmission } from "./institution-metrics.js";

const inputSchema = z.object({
  period: z.enum(["term", "30", "90"]).default("term"),
  student_id: z.uuid().optional(), class_id: z.uuid().optional(),
});
const portalSchema = z.enum(["principal", "teacher", "parent", "student"]);
type Scope = { school: string; user: string; admin: boolean; family: boolean; student: string | null; term: string;
  from: string; to: string; today: string; timezone: string; classId: string | null };
type Term = { id: string; name: string; starts_on: string; ends_on: string; attendance_threshold: string | number };
type DailyRow = AttendanceCounts & { date: string; class_id: string; class_name: string };

@Injectable()
export class AnalyticsService {
  constructor(private readonly db: DatabaseService, private readonly school: SchoolService) {}

  async overview(user: AuthUser, schoolId: string, portalValue: string, query: unknown) {
    z.uuid().parse(schoolId);
    const portal = portalSchema.parse(portalValue), input = inputSchema.parse(query);
    if (user.active_school_id && user.active_school_id !== schoolId) throw new ForbiddenException("Select this institution before opening Analytics.");
    const role = { principal: "admin", teacher: "staff", parent: "guardian", student: "student" }[portal];
    const membership = await sql<{ timezone: string; today: string }>`
      SELECT school.timezone,(now() AT TIME ZONE school.timezone)::date::text AS today
      FROM school_memberships member JOIN schools school ON school.id=member.school_id
      JOIN users account ON account.id=member.user_id AND account.is_active
      WHERE member.user_id=${user.id}::uuid AND member.school_id=${schoolId}::uuid
        AND member.role=${role} AND member.is_active LIMIT 1`.execute(this.db);
    const context = membership.rows[0];
    if (!context) throw new ForbiddenException("Active access to this view is required.");
    const family = portal === "parent" || portal === "student";
    if (family && input.class_id || !family && input.student_id) throw new BadRequestException("This filter is not available in this view.");
    let student = null;
    let term: Term | undefined;
    if (family) {
      // Explicit persona check: a staff/guardian dual-role account cannot use a
      // family URL to retrieve records via its broader staff relationship.
      const learner = await this.school.studentForUser(user, input.student_id);
      const allowed = await sql<{ ok: boolean }>`SELECT EXISTS (
        SELECT 1 FROM students s WHERE s.id=${learner.id}::uuid AND s.school_id=${schoolId}::uuid
          AND ((${portal}='student' AND s.user_id=${user.id}::uuid) OR (${portal}='parent' AND EXISTS (
            SELECT 1 FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id
            WHERE gr.school_id=s.school_id AND gr.student_id=s.id AND p.user_id=${user.id}::uuid)))
      ) AS ok`.execute(this.db);
      if (!allowed.rows[0]?.ok) throw new ForbiddenException("This learner is not available in your family view.");
      const enrollment = await this.school.enrollment(learner.id);
      student = await this.school.studentDto(learner, enrollment);
      term = { id: enrollment.term_id, name: enrollment.term_name, starts_on: enrollment.starts_on,
        ends_on: enrollment.ends_on, attendance_threshold: enrollment.attendance_threshold };
    } else {
      term = (await sql<Term>`SELECT id,name,starts_on,ends_on,attendance_threshold FROM academic_terms
        WHERE school_id=${schoolId}::uuid AND is_active AND starts_on<=${context.today}::date
        ORDER BY (${context.today}::date BETWEEN starts_on AND ends_on) DESC, starts_on DESC LIMIT 1`.execute(this.db)).rows[0];
    }
    if (!term) throw new NotFoundException("Set up an active academic term to view Analytics.");
    // A term can be longer than a year; this read model deliberately caps its
    // reporting window, labels it explicitly and never includes future records.
    const to = [term.ends_on, context.today].sort()[0]!;
    const from = [term.starts_on, dateOffset(to, -(input.period === "term" ? 365 : Number(input.period) - 1))].sort().at(-1)!;
    const scope: Scope = { school: schoolId, user: user.id, admin: portal === "principal", family,
      student: student?.id ?? null, term: term.id, from, to, today: context.today, timezone: context.timezone, classId: input.class_id ?? null };
    const permissions = family ? null : await effectiveSchoolAccess(this.db, user.id, schoolId);
    const permits = (permission: string) => family || permissions?.sources.some(source => source.permission === permission);
    const classes = family ? [] : (await sql<{ id: string; name: string }>`SELECT c.id,'Class '||c.grade||c.section AS name
      FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year
      WHERE c.school_id=${schoolId}::uuid AND t.id=${term.id}::uuid
        AND (${scope.admin} OR staff_has_class_permission(${schoolId}::uuid,${user.id}::uuid,'attendance.view',c.id,${context.today}::date)
          OR EXISTS(SELECT 1 FROM assessments a JOIN assessment_cycles cycle ON cycle.id=a.cycle_id
            WHERE a.school_id=c.school_id AND a.class_section_id=c.id AND cycle.term_id=t.id
              AND staff_has_resource_permission(${schoolId}::uuid,${user.id}::uuid,'assessments.view','assessment',a.id,${context.today}::date)))
      ORDER BY c.grade,c.section`.execute(this.db)).rows;
    if (input.class_id && !classes.some(item => item.id === input.class_id)) throw new ForbiddenException("This class is not available in your Analytics view.");
    const [attendance, assessments, institution, registers] = await Promise.all([
      permits("attendance.view") ? this.attendance(scope, input.period === "term", classes) : null,
      permits("assessments.view") ? this.assessments(scope) : null,
      scope.admin && !scope.classId ? institutionSnapshot(this.db, scope) : null,
      scope.admin && permits("attendance.view") ? registerSubmission(this.db, scope) : null,
    ]);
    return { portal, generated_at: new Date().toISOString(), student, term: { ...term, attendance_threshold: Number(term.attendance_threshold) },
      range: { period: input.period, from, to, capped: input.period === "term" && from > term.starts_on },
      scope_label: family ? student?.user.display_name ?? "Learner" : input.class_id ? classes.find(item => item.id === input.class_id)!.name
        : portal === "principal" ? "All classes" : "Your assigned work",
      selected_class_id: input.class_id ?? null, classes, attendance, assessments, institution, registers };
  }

  private async attendance(scope: Scope, monthly: boolean, classes: Array<{ id: string; name: string }>) {
    const { school, user, from, to, today, student, admin, family, classId } = scope;
    const result = await sql<DailyRow>`WITH scoped AS MATERIALIZED (
      SELECT ar.date,ar.class_section_id,ar.status,'Class '||c.grade||c.section AS class_name
      FROM attendance_records ar JOIN students s ON s.id=ar.student_id AND s.school_id=${school}::uuid
      JOIN class_sections c ON c.id=ar.class_section_id AND c.school_id=s.school_id
      WHERE ar.date BETWEEN ${from}::date AND ${to}::date
        AND (${student}::uuid IS NULL OR ar.student_id=${student}::uuid)
        AND (${classId}::uuid IS NULL OR c.id=${classId}::uuid)
    ), candidate_dates AS MATERIALIZED (
      SELECT DISTINCT date,class_section_id FROM scoped
    ), allowed_dates AS MATERIALIZED (
      SELECT date,class_section_id FROM candidate_dates
      WHERE ${family} OR ${admin} OR (
        staff_has_class_permission(${school}::uuid,${user}::uuid,'attendance.view',class_section_id,${today}::date)
        AND staff_has_class_permission(${school}::uuid,${user}::uuid,'attendance.view',class_section_id,date))
    ) SELECT ar.date::text AS date,ar.class_section_id AS class_id,ar.class_name,
      count(*) FILTER(WHERE status='present')::int AS present,
      count(*) FILTER(WHERE status='late')::int AS late,
      count(*) FILTER(WHERE status='half_day')::int AS half_day,
      count(*) FILTER(WHERE status='absent')::int AS absent,
      count(*) FILTER(WHERE status='excused')::int AS excused
      FROM scoped ar JOIN allowed_dates allowed USING(date,class_section_id)
      GROUP BY ar.date,ar.class_section_id,ar.class_name ORDER BY ar.date,ar.class_name`.execute(this.db);
    const counts = emptyCounts(), comparisons = new Map<string, { id: string; name: string; counts: AttendanceCounts }>();
    // Only attendance-authorized classes can appear in this comparison, even
    // when someone also has an assessment-only assignment in another class.
    for (const row of result.rows) {
      addCounts(counts, row);
      if (!comparisons.has(row.class_id)) comparisons.set(row.class_id, { id: row.class_id, name: row.class_name, counts: emptyCounts() });
      addCounts(comparisons.get(row.class_id)!.counts, row);
    }
    if (admin) for (const cls of classes.filter(item => !classId || item.id === classId)) {
      if (!comparisons.has(cls.id)) comparisons.set(cls.id, { ...cls, counts: emptyCounts() });
    }
    return { ...attendanceMetric(counts), trend: attendanceTrend(result.rows, from, to, monthly), subjects: await this.subjectAttendance(scope),
      classes: family ? [] : [...comparisons.values()].map(item => ({ id: item.id, name: item.name, ...attendanceMetric(item.counts) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })) };
  }

  private async subjectAttendance(scope: Scope) {
    const { school, user, from, to, today, student, admin, family, classId, term, timezone } = scope;
    // The same recorded-day + effective-lesson projection used by
    // SchoolService.refreshSubjectAttendance, bounded to the requested period.
    // This is not a claim that every individual lesson was directly marked.
    const result = await sql<{ id: string; name: string; held: number; attended: number; excused: number }>`
      WITH scoped AS MATERIALIZED (
        SELECT ar.* FROM attendance_records ar
        JOIN students s ON s.id=ar.student_id AND s.school_id=${school}::uuid
        JOIN enrollments e ON e.student_id=s.id AND e.class_section_id=ar.class_section_id
          AND e.term_id=${term}::uuid AND e.is_active AND ar.date>=e.enrolled_on
        WHERE ar.date BETWEEN ${from}::date AND ${to}::date
          AND (${student}::uuid IS NULL OR ar.student_id=${student}::uuid)
          AND (${classId}::uuid IS NULL OR ar.class_section_id=${classId}::uuid)
      ), candidate_dates AS MATERIALIZED (
        SELECT DISTINCT date,class_section_id FROM scoped
      ), allowed_dates AS MATERIALIZED (
        SELECT date,class_section_id FROM candidate_dates WHERE ${family} OR ${admin} OR (
          staff_has_class_permission(${school}::uuid,${user}::uuid,'attendance.view',class_section_id,${today}::date)
          AND staff_has_class_permission(${school}::uuid,${user}::uuid,'attendance.view',class_section_id,date))
      ), recorded_dates AS (SELECT DISTINCT date FROM allowed_dates), lessons AS MATERIALIZED (
        SELECT slot.*,days.date,
          row_number() OVER (PARTITION BY slot.class_section_id,slot.term_id,days.date ORDER BY slot.period_number,slot.starts_at,slot.id)::int AS instructional_index,
          count(*) OVER (PARTITION BY slot.class_section_id,slot.term_id,days.date)::int AS instructional_count
        FROM recorded_dates days CROSS JOIN LATERAL effective_school_schedule(${school}::uuid,days.date) slot
        WHERE slot.term_id=${term}::uuid AND slot.slot_type='class' AND slot.subject_id IS NOT NULL AND NOT slot.cancelled
      ) SELECT s.id,s.name,count(*)::int AS held,
        count(*) FILTER(WHERE ar.status IN ('present','late') OR (ar.status='half_day' AND (
          (ar.check_out_at IS NOT NULL AND (ar.check_out_at AT TIME ZONE ${timezone})::date=ar.date
            AND (ar.check_out_at AT TIME ZONE ${timezone})::time>=lesson.ends_at)
          OR (ar.check_out_at IS NULL AND lesson.instructional_index*2<=lesson.instructional_count+1))))::int AS attended,
        count(*) FILTER(WHERE ar.status='excused')::int AS excused
      FROM scoped ar JOIN allowed_dates allowed USING(date,class_section_id)
      JOIN lessons lesson ON lesson.class_section_id=ar.class_section_id AND lesson.date=ar.date
      JOIN subjects s ON s.id=lesson.subject_id AND s.school_id=${school}::uuid
      GROUP BY s.id,s.name ORDER BY s.name`.execute(this.db);
    return result.rows.map(row => ({ ...row, counted: row.held-row.excused,
      percentage: row.held>row.excused ? round(row.attended*100/(row.held-row.excused)) : null }));
  }

  private async assessments(scope: Scope) {
    const { school, user, admin, family, student, term, from, to, timezone, today, classId } = scope;
    // Latest immutable release, not mutable marks during a correction. Only
    // aggregate scores leave this service; no roster or private feedback leaks.
    const aggregates = await sql<{ kind: "subject" | "class" | "overall"; id: string | null; name: string | null; scored: number; other: number; average: string | null; assessments: number; distribution: number[] }>`
      WITH authorized AS MATERIALIZED (
        SELECT a.* FROM assessments a JOIN assessment_cycles cycle ON cycle.id=a.cycle_id AND cycle.school_id=a.school_id
        WHERE a.school_id=${school}::uuid AND cycle.term_id=${term}::uuid
          AND (a.scheduled_at AT TIME ZONE ${timezone})::date BETWEEN ${from}::date AND ${to}::date
          AND (${classId}::uuid IS NULL OR a.class_section_id=${classId}::uuid)
          AND (${family} OR ${admin} OR staff_has_resource_permission(${school}::uuid,${user}::uuid,'assessments.view','assessment',a.id,${today}::date))
      ), latest AS MATERIALIZED (
        SELECT DISTINCT ON(p.assessment_id) p.id,p.assessment_id
        FROM assessment_publications p JOIN authorized a ON a.id=p.assessment_id
        WHERE p.school_id=${school}::uuid AND p.published_at<=now()
        ORDER BY p.assessment_id,p.sequence DESC
      ) SELECT CASE WHEN GROUPING(s.id)=0 THEN 'subject' WHEN GROUPING(c.id)=0 THEN 'class' ELSE 'overall' END AS kind,
        CASE WHEN GROUPING(s.id)=0 THEN s.id ELSE c.id END AS id,
        CASE WHEN GROUPING(s.id)=0 THEN s.name WHEN GROUPING(c.id)=0 THEN 'Class '||c.grade||c.section ELSE NULL END AS name,
        count(*) FILTER(WHERE r.outcome='scored')::int AS scored,
        count(*) FILTER(WHERE r.outcome<>'scored')::int AS other,
        avg(r.marks*100.0/a.maximum_marks) FILTER(WHERE r.outcome='scored') AS average,
        ARRAY[
          count(*) FILTER(WHERE r.outcome='scored' AND r.marks*100.0/a.maximum_marks<20),
          count(*) FILTER(WHERE r.outcome='scored' AND r.marks*100.0/a.maximum_marks>=20 AND r.marks*100.0/a.maximum_marks<40),
          count(*) FILTER(WHERE r.outcome='scored' AND r.marks*100.0/a.maximum_marks>=40 AND r.marks*100.0/a.maximum_marks<60),
          count(*) FILTER(WHERE r.outcome='scored' AND r.marks*100.0/a.maximum_marks>=60 AND r.marks*100.0/a.maximum_marks<80),
          count(*) FILTER(WHERE r.outcome='scored' AND r.marks*100.0/a.maximum_marks>=80)
        ]::int[] AS distribution,
        count(DISTINCT a.id)::int AS assessments
      FROM latest p JOIN authorized a ON a.id=p.assessment_id
      JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      JOIN class_sections c ON c.id=a.class_section_id AND c.school_id=a.school_id
      JOIN assessment_publication_results r ON r.publication_id=p.id AND r.school_id=a.school_id AND r.assessment_id=a.id
      WHERE (${student}::uuid IS NULL OR r.student_id=${student}::uuid)
      GROUP BY GROUPING SETS ((s.id,s.name),(c.id,c.grade,c.section),()) ORDER BY name NULLS LAST`.execute(this.db);
    const pipeline = family ? [] : (await sql<{ status: string; count: number }>`SELECT a.status,count(*)::int AS count
      FROM assessments a JOIN assessment_cycles cycle ON cycle.id=a.cycle_id AND cycle.school_id=a.school_id
      WHERE a.school_id=${school}::uuid AND cycle.term_id=${term}::uuid
        AND (COALESCE(a.scheduled_at,a.created_at) AT TIME ZONE ${timezone})::date BETWEEN ${from}::date AND ${to}::date
        AND (${classId}::uuid IS NULL OR a.class_section_id=${classId}::uuid)
        AND (${admin} OR staff_has_resource_permission(${school}::uuid,${user}::uuid,'assessments.view','assessment',a.id,${today}::date))
      GROUP BY a.status ORDER BY a.status`.execute(this.db)).rows;
    const metric = (item: typeof aggregates.rows[number]) => ({ scored: item.scored, other: item.other, assessments: item.assessments,
      average: item.average === null ? null : round(Number(item.average)) });
    const comparison = (kind: string) => aggregates.rows.filter(item => item.kind===kind).map(item => ({ id: item.id!, name: item.name!, ...metric(item) }));
    const overall = aggregates.rows.find(item => item.kind==='overall')!;
    return { overall: { ...metric(overall), distribution: overall.distribution }, subjects: comparison('subject'),
      classes: family ? [] : comparison('class'), pipeline };
  }
}
