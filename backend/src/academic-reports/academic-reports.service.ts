import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { schoolPermission } from "../roles/authorization.js";

type Db = Kysely<Database> | Transaction<Database>;
const uuid = z.string().uuid();
const percentage = z.coerce.number().min(0).max(100);
const bandInput = z.object({
  code: z.string().trim().min(1).max(24).transform((value) => value.toUpperCase()),
  label: z.string().trim().min(1).max(80),
  minimum_percentage: percentage,
  maximum_percentage: percentage,
});
const schemeInput = z.object({
  term_id: uuid,
  class_section_id: uuid,
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(32).transform((value) => value.toUpperCase()),
  absence_treatment: z.enum(["incomplete", "zero"]).default("incomplete"),
  review_mode: z.enum(["owner_review", "independent"]).default("independent"),
  bands: z.array(bandInput).min(1).max(20),
});
const componentInput = z.object({
  code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(100),
  weight_percentage: z.coerce.number().positive().max(100),
  assessment_ids: z.array(uuid).min(1).max(30),
});
const subjectPlanInput = z.object({
  subject_id: uuid,
  pass_percentage: percentage.nullable().default(null),
  expected_revision: z.coerce.number().int().positive(),
  components: z.array(componentInput).min(1).max(20),
});
const revisionInput = z.object({ expected_revision: z.coerce.number().int().positive(), note: z.string().trim().max(1000).default("") });
const generateInput = z.object({ expected_revision: z.coerce.number().int().positive(), correction_reason: z.string().trim().max(500).default("") });
const commentInput = z.object({
  expected_revision: z.coerce.number().int().positive(),
  class_teacher_comment: z.string().trim().max(1000).default(""),
  principal_comment: z.string().trim().max(1000).default(""),
});

interface PublishedSource {
  assessment_id: string;
  publication_id: string;
  title: string;
  maximum_marks: number;
  results: Map<string, { outcome: "scored" | "absent" | "exempt" | "withheld" | "not_evaluated"; marks: number | null }>;
}

@Injectable()
export class AcademicReportsService {
  constructor(private readonly db: DatabaseService) {}

  private async principal(user: AuthUser, schoolId: string, db: Db = this.db) {
    uuid.parse(schoolId);
    const member = await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
    if (!member) throw new ForbiddenException("Institution administrator access is required.");
  }

  private async classCommenter(user: AuthUser, schoolId: string, classSectionId: string, db: Db = this.db) {
    const admin = await db.selectFrom("school_memberships").select("id").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("role", "=", "admin").where("is_active", "=", true).executeTakeFirst();
    if (admin) return "admin" as const;
    await schoolPermission(db, user, schoolId, "reports.comment");
    const assignment = (await sql<{ ok: boolean }>`SELECT EXISTS(
      SELECT 1 FROM class_section_staff_assignments assignment
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.class_section_id=${classSectionId}::uuid
        AND assignment.user_id=${user.id}::uuid AND assignment.role='class_teacher'
        AND assignment.valid_from<=CURRENT_DATE AND (assignment.valid_until IS NULL OR assignment.valid_until>=CURRENT_DATE)
    ) AS ok`.execute(db)).rows[0]?.ok;
    if (!assignment) throw new ForbiddenException("Only the assigned class teacher can add report remarks.");
    return "class_teacher" as const;
  }

  private async audit(db: Db, user: AuthUser, schoolId: string, schemeId: string | null, batchId: string | null, action: string, fromStatus: string | null, toStatus: string | null, metadata: Record<string, unknown> = {}) {
    await db.insertInto("grading_report_audits").values({ school_id: schoolId, scheme_id: schemeId, batch_id: batchId, actor_id: user.id, action, from_status: fromStatus, to_status: toStatus, metadata }).execute();
  }

  private validateBands(bands: Array<z.infer<typeof bandInput>>) {
    const sorted = [...bands].sort((left, right) => left.minimum_percentage - right.minimum_percentage);
    if (sorted[0]!.minimum_percentage !== 0 || sorted.at(-1)!.maximum_percentage !== 100) throw new BadRequestException("Grade bands must cover 0 through 100.");
    const codes = new Set<string>();
    for (let index = 0; index < sorted.length; index += 1) {
      const band = sorted[index]!;
      if (band.maximum_percentage < band.minimum_percentage) throw new BadRequestException("A grade band cannot end before it starts.");
      if (codes.has(band.code)) throw new BadRequestException("Grade band codes must be unique.");
      codes.add(band.code);
      if (index > 0 && Math.abs(band.minimum_percentage - (sorted[index - 1]!.maximum_percentage + 0.01)) > 0.001) throw new BadRequestException("Grade bands cannot overlap or leave gaps.");
    }
    return sorted;
  }

  private gradeFor(bands: Array<{ code: string; minimum_percentage: string; maximum_percentage: string }>, value: number) {
    return bands.find((band) => value >= Number(band.minimum_percentage) - 0.0001 && value <= Number(band.maximum_percentage) + 0.0001)?.code ?? "";
  }

  async workspace(user: AuthUser, schoolId: string) {
    uuid.parse(schoolId);
    const membership = await this.db.selectFrom("school_memberships").select("role").where("school_id", "=", schoolId).where("user_id", "=", user.id).where("is_active", "=", true).executeTakeFirst();
    if (!membership || !["admin", "staff"].includes(membership.role)) throw new ForbiddenException("Staff access is required.");
    const admin = membership.role === "admin";
    if (!admin) await schoolPermission(this.db, user, schoolId, "reports.comment");
    const classScope = admin ? sql`` : sql`AND EXISTS(SELECT 1 FROM class_section_staff_assignments mine WHERE mine.school_id=scheme.school_id AND mine.class_section_id=scheme.class_section_id AND mine.user_id=${user.id}::uuid AND mine.role='class_teacher' AND mine.valid_from<=CURRENT_DATE AND (mine.valid_until IS NULL OR mine.valid_until>=CURRENT_DATE))`;
    const schemes = await sql`SELECT scheme.*,term.name AS term_name,term.academic_year,'Class '||section.grade||section.section AS class_name,
      (SELECT count(*)::int FROM grading_scheme_subjects subject_plan WHERE subject_plan.scheme_id=scheme.id) AS subject_count,
      (SELECT count(*)::int FROM grading_report_batches batch WHERE batch.scheme_id=scheme.id) AS report_count
      FROM grading_schemes scheme JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      WHERE scheme.school_id=${schoolId}::uuid ${classScope} ORDER BY term.starts_on DESC,section.grade,section.section,scheme.created_at DESC`.execute(this.db);
    const batches = await sql`SELECT batch.*,scheme.name AS scheme_name,scheme.review_mode,'Class '||section.grade||section.section AS class_name,term.name AS term_name,
      count(student.id)::int AS learner_count,count(student.id) FILTER(WHERE student.outcome='incomplete')::int AS incomplete_count
      FROM grading_report_batches batch JOIN grading_schemes scheme ON scheme.id=batch.scheme_id JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      LEFT JOIN grading_report_students student ON student.batch_id=batch.id WHERE batch.school_id=${schoolId}::uuid ${classScope}
      GROUP BY batch.id,scheme.name,scheme.review_mode,section.grade,section.section,term.name ORDER BY batch.generated_at DESC`.execute(this.db);
    if (!admin) return { mode: "staff", schemes: schemes.rows, batches: batches.rows };
    const [terms, classes, subjects, assessments] = await Promise.all([
      sql`SELECT id,name,academic_year,starts_on,ends_on FROM academic_terms WHERE school_id=${schoolId}::uuid AND is_active ORDER BY starts_on DESC`.execute(this.db),
      sql`SELECT id,'Class '||grade||section AS name,academic_year FROM class_sections WHERE school_id=${schoolId}::uuid ORDER BY academic_year DESC,grade,section`.execute(this.db),
      sql`SELECT id,name,color,icon FROM subjects WHERE school_id=${schoolId}::uuid ORDER BY name`.execute(this.db),
      sql`SELECT assessment.id,assessment.title,assessment.subject_id,assessment.class_section_id,cycle.term_id,assessment.maximum_marks,
        COALESCE((SELECT max(sequence) FROM assessment_publications publication WHERE publication.assessment_id=assessment.id),0)::int AS publication_sequence
        FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
        WHERE assessment.school_id=${schoolId}::uuid AND assessment.status='published' ORDER BY assessment.scheduled_at,assessment.title`.execute(this.db),
    ]);
    return { mode: "admin", schemes: schemes.rows, batches: batches.rows, references: { terms: terms.rows, classes: classes.rows, subjects: subjects.rows, assessments: assessments.rows } };
  }

  async schemeDetail(user: AuthUser, schoolId: string, schemeId: string) {
    await this.principal(user, schoolId);
    uuid.parse(schemeId);
    const scheme = (await sql`SELECT scheme.*,term.name AS term_name,term.academic_year,'Class '||section.grade||section.section AS class_name
      FROM grading_schemes scheme JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      WHERE scheme.school_id=${schoolId}::uuid AND scheme.id=${schemeId}::uuid`.execute(this.db)).rows[0];
    if (!scheme) throw new NotFoundException("Grading scheme not found.");
    const bands = await this.db.selectFrom("grading_scheme_bands").selectAll().where("school_id", "=", schoolId).where("scheme_id", "=", schemeId).orderBy("display_order").execute();
    const subjects = await sql`SELECT plan.*,subject.name AS subject_name,subject.color,subject.icon FROM grading_scheme_subjects plan JOIN subjects subject ON subject.id=plan.subject_id WHERE plan.scheme_id=${schemeId}::uuid ORDER BY plan.display_order,subject.name`.execute(this.db);
    const components = await sql`SELECT component.*,array_agg(mapping.assessment_id ORDER BY assessment.scheduled_at,assessment.title) AS assessment_ids,
      array_agg(assessment.title ORDER BY assessment.scheduled_at,assessment.title) AS assessment_titles
      FROM grading_components component JOIN grading_component_assessments mapping ON mapping.component_id=component.id JOIN assessments assessment ON assessment.id=mapping.assessment_id
      WHERE component.school_id=${schoolId}::uuid AND component.scheme_subject_id IN(SELECT id FROM grading_scheme_subjects WHERE scheme_id=${schemeId}::uuid)
      GROUP BY component.id ORDER BY component.scheme_subject_id,component.display_order`.execute(this.db);
    return { scheme, bands, subjects: subjects.rows, components: components.rows };
  }

  async createScheme(user: AuthUser, schoolId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = schemeInput.parse(body);
    const bands = this.validateBands(data.bands);
    return this.db.transaction().execute(async (db) => {
      const term = await db.selectFrom("academic_terms").selectAll().where("id", "=", data.term_id).where("school_id", "=", schoolId).executeTakeFirst();
      const section = await db.selectFrom("class_sections").selectAll().where("id", "=", data.class_section_id).where("school_id", "=", schoolId).executeTakeFirst();
      if (!term || !section || term.academic_year !== section.academic_year) throw new BadRequestException("Choose a class and term from the same academic year.");
      let scheme;
      try {
        scheme = await db.insertInto("grading_schemes").values({ school_id: schoolId, term_id: data.term_id, class_section_id: data.class_section_id, name: data.name, code: data.code, absence_treatment: data.absence_treatment, review_mode: data.review_mode, created_by: user.id, updated_by: user.id }).returningAll().executeTakeFirstOrThrow();
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ConflictException("This grading scheme code is already used for the class and term.");
        throw error;
      }
      await db.insertInto("grading_scheme_bands").values(bands.map((band, index) => ({ school_id: schoolId, scheme_id: scheme.id, code: band.code, label: band.label, minimum_percentage: String(band.minimum_percentage), maximum_percentage: String(band.maximum_percentage), display_order: index + 1 }))).execute();
      await this.audit(db, user, schoolId, scheme.id, null, "grading.scheme.created", null, "draft", { bands: bands.length });
      return scheme;
    });
  }

  async saveSubjectPlan(user: AuthUser, schoolId: string, schemeId: string, body: unknown) {
    await this.principal(user, schoolId);
    uuid.parse(schemeId);
    const data = subjectPlanInput.parse(body);
    const componentTotal = data.components.reduce((total, component) => total + component.weight_percentage, 0);
    if (Math.abs(componentTotal - 100) > 0.001) throw new BadRequestException("Subject component weights must total 100%.");
    const assessmentIds = data.components.flatMap((component) => component.assessment_ids);
    if (new Set(assessmentIds).size !== assessmentIds.length) throw new BadRequestException("An assessment can be used in only one component.");
    return this.db.transaction().execute(async (db) => {
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", schemeId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!scheme) throw new NotFoundException("Grading scheme not found.");
      if (scheme.status !== "draft") throw new ConflictException("Active grading schemes cannot be edited. Create a new scheme version instead.");
      if (scheme.revision !== data.expected_revision) throw new ConflictException("This grading scheme changed. Refresh before saving.");
      const subject = await db.selectFrom("subjects").select("id").where("id", "=", data.subject_id).where("school_id", "=", schoolId).executeTakeFirst();
      if (!subject) throw new BadRequestException("Choose a subject in this institution.");
      const eligible = await sql<{ id: string }>`SELECT assessment.id FROM assessments assessment JOIN assessment_cycles cycle ON cycle.id=assessment.cycle_id
        WHERE assessment.school_id=${schoolId}::uuid AND assessment.id=ANY(${assessmentIds}::uuid[]) AND assessment.class_section_id=${scheme.class_section_id}::uuid
          AND cycle.term_id=${scheme.term_id}::uuid AND assessment.subject_id=${data.subject_id}::uuid AND assessment.status='published'
          AND EXISTS(SELECT 1 FROM assessment_publications publication WHERE publication.assessment_id=assessment.id)`.execute(db);
      if (eligible.rows.length !== assessmentIds.length) throw new BadRequestException("Every mapped assessment must be published for this class, term and subject.");
      const existing = await db.selectFrom("grading_scheme_subjects").select("id").where("scheme_id", "=", schemeId).where("subject_id", "=", data.subject_id).executeTakeFirst();
      if (existing) await db.deleteFrom("grading_scheme_subjects").where("id", "=", existing.id).execute();
      const displayOrder = (await sql<{ next: number }>`SELECT COALESCE(max(display_order),0)+1 AS next FROM grading_scheme_subjects WHERE scheme_id=${schemeId}::uuid`.execute(db)).rows[0]!.next;
      const plan = await db.insertInto("grading_scheme_subjects").values({ school_id: schoolId, scheme_id: schemeId, subject_id: data.subject_id, pass_percentage: data.pass_percentage === null ? null : String(data.pass_percentage), display_order: displayOrder }).returningAll().executeTakeFirstOrThrow();
      for (const [index, component] of data.components.entries()) {
        const row = await db.insertInto("grading_components").values({ school_id: schoolId, scheme_subject_id: plan.id, code: component.code, name: component.name, weight_percentage: String(component.weight_percentage), display_order: index + 1 }).returningAll().executeTakeFirstOrThrow();
        await db.insertInto("grading_component_assessments").values(component.assessment_ids.map((assessmentId) => ({ school_id: schoolId, component_id: row.id, assessment_id: assessmentId }))).execute();
      }
      const updated = await db.updateTable("grading_schemes").set({ revision: scheme.revision + 1, updated_by: user.id, updated_at: new Date() }).where("id", "=", schemeId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, schemeId, null, "grading.subject.saved", "draft", "draft", { subject_id: data.subject_id, components: data.components.length });
      return updated;
    });
  }

  async activateScheme(user: AuthUser, schoolId: string, schemeId: string, body: unknown) {
    await this.principal(user, schoolId);
    const data = revisionInput.parse(body);
    return this.db.transaction().execute(async (db) => {
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", schemeId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!scheme) throw new NotFoundException("Grading scheme not found.");
      if (scheme.status !== "draft") throw new ConflictException("Only a draft grading scheme can be activated.");
      if (scheme.revision !== data.expected_revision) throw new ConflictException("This grading scheme changed. Refresh before activating.");
      const plans = await sql<{ id: string; weight: string; mappings: number }>`SELECT plan.id,COALESCE(sum(component.weight_percentage),0)::numeric AS weight,
        count(mapping.assessment_id)::int AS mappings FROM grading_scheme_subjects plan LEFT JOIN grading_components component ON component.scheme_subject_id=plan.id
        LEFT JOIN grading_component_assessments mapping ON mapping.component_id=component.id WHERE plan.scheme_id=${schemeId}::uuid GROUP BY plan.id`.execute(db);
      if (!plans.rows.length) throw new BadRequestException("Add at least one subject grading plan.");
      if (plans.rows.some((plan) => Math.abs(Number(plan.weight) - 100) > 0.001 || plan.mappings < 1)) throw new BadRequestException("Every subject needs mapped components totalling 100%.");
      const updated = await db.updateTable("grading_schemes").set({ status: "active", revision: scheme.revision + 1, activated_by: user.id, activated_at: new Date(), updated_by: user.id, updated_at: new Date() }).where("id", "=", schemeId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, schemeId, null, "grading.scheme.activated", "draft", "active", { note: data.note });
      return updated;
    });
  }

  private async publishedSources(db: Db, schoolId: string, assessmentIds: string[]) {
    const sources = new Map<string, PublishedSource>();
    for (const assessmentId of assessmentIds) {
      const publication = (await sql<{ id: string; title: string; maximum_marks: string }>`SELECT publication.id,assessment.title,assessment.maximum_marks FROM assessment_publications publication
        JOIN assessments assessment ON assessment.id=publication.assessment_id WHERE publication.school_id=${schoolId}::uuid AND publication.assessment_id=${assessmentId}::uuid
        ORDER BY publication.sequence DESC LIMIT 1`.execute(db)).rows[0];
      if (!publication) throw new BadRequestException("Every mapped assessment needs a published result.");
      const rows = await db.selectFrom("assessment_publication_results").select(["student_id", "outcome", "marks"]).where("school_id", "=", schoolId).where("publication_id", "=", publication.id).execute();
      sources.set(assessmentId, { assessment_id: assessmentId, publication_id: publication.id, title: publication.title, maximum_marks: Number(publication.maximum_marks), results: new Map(rows.map((row) => [row.student_id, { outcome: row.outcome, marks: row.marks === null ? null : Number(row.marks) }])) });
    }
    return sources;
  }

  async generateReport(user: AuthUser, schoolId: string, schemeId: string, body: unknown) {
    await this.principal(user, schoolId);
    uuid.parse(schemeId);
    const data = generateInput.parse(body);
    return this.db.transaction().execute(async (db) => {
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", schemeId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!scheme) throw new NotFoundException("Grading scheme not found.");
      if (scheme.status !== "active") throw new ConflictException("Activate the grading scheme before generating reports.");
      if (scheme.revision !== data.expected_revision) throw new ConflictException("This grading scheme changed. Refresh before generating reports.");
      const sequence = Number((await sql<{ next: number }>`SELECT COALESCE(max(sequence),0)+1 AS next FROM grading_report_batches WHERE scheme_id=${schemeId}::uuid`.execute(db)).rows[0]!.next);
      if (sequence > 1 && data.correction_reason.length < 3) throw new BadRequestException("Add a reason for the corrected report release.");
      const bands = await db.selectFrom("grading_scheme_bands").selectAll().where("scheme_id", "=", schemeId).orderBy("display_order").execute();
      const plans = await db.selectFrom("grading_scheme_subjects").selectAll().where("scheme_id", "=", schemeId).orderBy("display_order").execute();
      const components = await db.selectFrom("grading_components").selectAll().where("scheme_subject_id", "in", plans.map((plan) => plan.id)).orderBy("display_order").execute();
      const mappings = await db.selectFrom("grading_component_assessments").selectAll().where("component_id", "in", components.map((component) => component.id)).execute();
      const assessmentIds = [...new Set(mappings.map((mapping) => mapping.assessment_id))];
      const sources = await this.publishedSources(db, schoolId, assessmentIds);
      const fingerprint = createHash("sha256").update(JSON.stringify({ scheme_revision: scheme.revision, publications: [...sources.values()].map((source) => [source.assessment_id, source.publication_id]).sort() })).digest("hex");
      const roster = await sql<{ student_id: string }>`SELECT enrollment.student_id FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id
        WHERE enrollment.class_section_id=${scheme.class_section_id}::uuid AND enrollment.term_id=${scheme.term_id}::uuid AND enrollment.is_active AND student.school_id=${schoolId}::uuid ORDER BY enrollment.roll_number NULLS LAST,enrollment.student_id`.execute(db);
      if (!roster.rows.length) throw new BadRequestException("The class has no active learners in this term.");
      const batch = await db.insertInto("grading_report_batches").values({ school_id: schoolId, scheme_id: schemeId, sequence, source_scheme_revision: scheme.revision, source_fingerprint: fingerprint, correction_reason: data.correction_reason, generated_by: user.id }).returningAll().executeTakeFirstOrThrow();
      for (const learner of roster.rows) {
        const subjectSnapshots: Array<{ plan: typeof plans[number]; outcome: "complete" | "incomplete" | "exempt" | "withheld"; percentage: number | null; grade: string; componentSnapshots: Array<{ component: typeof components[number]; outcome: "complete" | "incomplete" | "exempt"; percentage: number | null; weightedPoints: number | null; sourceRows: Array<{ source: PublishedSource; result: { outcome: "scored" | "absent" | "exempt" | "withheld" | "not_evaluated"; marks: number | null } | undefined }> }> }> = [];
        for (const plan of plans) {
          const planComponents = components.filter((component) => component.scheme_subject_id === plan.id);
          const componentSnapshots = planComponents.map((component) => {
            const sourceRows = mappings.filter((mapping) => mapping.component_id === component.id).map((mapping) => ({ source: sources.get(mapping.assessment_id)!, result: sources.get(mapping.assessment_id)!.results.get(learner.student_id) }));
            let incomplete = false;
            const values: number[] = [];
            let exemptCount = 0;
            for (const row of sourceRows) {
              if (!row.result || ["withheld", "not_evaluated"].includes(row.result.outcome)) incomplete = true;
              else if (row.result.outcome === "exempt") exemptCount += 1;
              else if (row.result.outcome === "absent") {
                if (scheme.absence_treatment === "zero") values.push(0); else incomplete = true;
              } else if (row.result.outcome === "scored" && row.result.marks !== null) values.push((row.result.marks / row.source.maximum_marks) * 100);
            }
            if (incomplete) return { component, outcome: "incomplete" as const, percentage: null, weightedPoints: null, sourceRows };
            if (!values.length && exemptCount === sourceRows.length) return { component, outcome: "exempt" as const, percentage: null, weightedPoints: null, sourceRows };
            const value = values.reduce((total, item) => total + item, 0) / values.length;
            return { component, outcome: "complete" as const, percentage: value, weightedPoints: value * Number(component.weight_percentage) / 100, sourceRows };
          });
          let outcome: "complete" | "incomplete" | "exempt" | "withheld" = "complete";
          let value: number | null = null;
          if (componentSnapshots.some((component) => component.outcome === "incomplete")) outcome = "incomplete";
          else {
            const completed = componentSnapshots.filter((component) => component.outcome === "complete");
            if (!completed.length) outcome = "exempt";
            else {
              const activeWeight = completed.reduce((total, component) => total + Number(component.component.weight_percentage), 0);
              value = completed.reduce((total, component) => total + (component.weightedPoints ?? 0), 0) * 100 / activeWeight;
            }
          }
          subjectSnapshots.push({ plan, outcome, percentage: value, grade: value === null ? "" : this.gradeFor(bands, value), componentSnapshots });
        }
        const completedSubjects = subjectSnapshots.filter((subject) => subject.outcome === "complete" && subject.percentage !== null);
        const learnerOutcome = subjectSnapshots.some((subject) => subject.outcome === "incomplete") || !completedSubjects.length ? "incomplete" as const : "complete" as const;
        const overall = learnerOutcome === "complete" ? completedSubjects.reduce((total, subject) => total + subject.percentage!, 0) / completedSubjects.length : null;
        const reportStudent = await db.insertInto("grading_report_students").values({ school_id: schoolId, batch_id: batch.id, student_id: learner.student_id, outcome: learnerOutcome, overall_percentage: overall === null ? null : overall.toFixed(2), overall_grade: overall === null ? "" : this.gradeFor(bands, overall) }).returningAll().executeTakeFirstOrThrow();
        for (const subjectSnapshot of subjectSnapshots) {
          const reportSubject = await db.insertInto("grading_report_subjects").values({ school_id: schoolId, batch_id: batch.id, report_student_id: reportStudent.id, scheme_subject_id: subjectSnapshot.plan.id, subject_id: subjectSnapshot.plan.subject_id, outcome: subjectSnapshot.outcome, percentage: subjectSnapshot.percentage === null ? null : subjectSnapshot.percentage.toFixed(2), grade: subjectSnapshot.grade, pass_percentage: subjectSnapshot.plan.pass_percentage, passed: subjectSnapshot.outcome === "complete" && subjectSnapshot.plan.pass_percentage !== null ? subjectSnapshot.percentage! >= Number(subjectSnapshot.plan.pass_percentage) : null }).returningAll().executeTakeFirstOrThrow();
          for (const componentSnapshot of subjectSnapshot.componentSnapshots) {
            const reportComponent = await db.insertInto("grading_report_components").values({ school_id: schoolId, batch_id: batch.id, report_subject_id: reportSubject.id, component_id: componentSnapshot.component.id, component_name: componentSnapshot.component.name, weight_percentage: componentSnapshot.component.weight_percentage, outcome: componentSnapshot.outcome, percentage: componentSnapshot.percentage === null ? null : componentSnapshot.percentage.toFixed(2), weighted_points: componentSnapshot.weightedPoints === null ? null : componentSnapshot.weightedPoints.toFixed(4), source_assessment_count: componentSnapshot.sourceRows.length }).returningAll().executeTakeFirstOrThrow();
            await db.insertInto("grading_report_assessment_sources").values(componentSnapshot.sourceRows.map((row) => ({ school_id: schoolId, batch_id: batch.id, report_component_id: reportComponent.id, assessment_id: row.source.assessment_id, publication_id: row.source.publication_id, student_id: learner.student_id, outcome: row.result?.outcome ?? "not_evaluated", marks: row.result?.outcome === "scored" && row.result.marks !== null ? String(row.result.marks) : null, maximum_marks: String(row.source.maximum_marks), normalized_percentage: row.result?.outcome === "scored" && row.result.marks !== null ? ((row.result.marks / row.source.maximum_marks) * 100).toFixed(2) : null }))).execute();
          }
        }
      }
      await this.audit(db, user, schoolId, schemeId, batch.id, sequence === 1 ? "report.generated" : "report.correction.generated", null, "draft", { sequence, learners: roster.rows.length, source_fingerprint: fingerprint });
      return batch;
    });
  }

  async reportDetail(user: AuthUser, schoolId: string, batchId: string) {
    uuid.parse(batchId);
    const batch = (await sql`SELECT batch.*,scheme.name AS scheme_name,scheme.review_mode,scheme.class_section_id,term.name AS term_name,term.academic_year,'Class '||section.grade||section.section AS class_name
      FROM grading_report_batches batch JOIN grading_schemes scheme ON scheme.id=batch.scheme_id JOIN academic_terms term ON term.id=scheme.term_id JOIN class_sections section ON section.id=scheme.class_section_id
      WHERE batch.school_id=${schoolId}::uuid AND batch.id=${batchId}::uuid`.execute(this.db)).rows[0] as Record<string, unknown> | undefined;
    if (!batch) throw new NotFoundException("Report batch not found.");
    await this.classCommenter(user, schoolId, String(batch.class_section_id));
    const students = await sql`SELECT report.*,person.first_name,person.last_name,student.admission_number,enrollment.roll_number
      FROM grading_report_students report JOIN students student ON student.id=report.student_id JOIN school_people person ON person.id=student.person_id
      LEFT JOIN grading_schemes scheme ON scheme.id=${String(batch.scheme_id)}::uuid LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.term_id=scheme.term_id AND enrollment.class_section_id=scheme.class_section_id
      WHERE report.batch_id=${batchId}::uuid ORDER BY enrollment.roll_number NULLS LAST,person.first_name,person.last_name`.execute(this.db);
    const subjects = await sql`SELECT report.*,subject.name AS subject_name,subject.color,subject.icon FROM grading_report_subjects report JOIN subjects subject ON subject.id=report.subject_id WHERE report.batch_id=${batchId}::uuid ORDER BY report.report_student_id,subject.name`.execute(this.db);
    const components = await sql`SELECT * FROM grading_report_components WHERE batch_id=${batchId}::uuid ORDER BY report_subject_id,component_name`.execute(this.db);
    return { batch, students: students.rows, subjects: subjects.rows, components: components.rows };
  }

  async updateComments(user: AuthUser, schoolId: string, batchId: string, studentId: string, body: unknown) {
    uuid.parse(batchId); uuid.parse(studentId);
    const data = commentInput.parse(body);
    return this.db.transaction().execute(async (db) => {
      const context = (await sql<{ class_section_id: string; status: string; scheme_id: string }>`SELECT scheme.class_section_id,batch.status,batch.scheme_id FROM grading_report_batches batch JOIN grading_schemes scheme ON scheme.id=batch.scheme_id WHERE batch.school_id=${schoolId}::uuid AND batch.id=${batchId}::uuid`.execute(db)).rows[0];
      if (!context) throw new NotFoundException("Report batch not found.");
      const actor = await this.classCommenter(user, schoolId, context.class_section_id, db);
      if (context.status !== "draft") throw new ConflictException("Remarks can only be edited before review.");
      const row = await db.selectFrom("grading_report_students").selectAll().where("batch_id", "=", batchId).where("student_id", "=", studentId).forUpdate().executeTakeFirst();
      if (!row) throw new NotFoundException("Learner report not found.");
      if (row.comment_revision !== data.expected_revision) throw new ConflictException("These remarks changed. Refresh before saving.");
      const updated = await db.updateTable("grading_report_students").set({ class_teacher_comment: data.class_teacher_comment, principal_comment: actor === "admin" ? data.principal_comment : row.principal_comment, comment_revision: row.comment_revision + 1, comment_updated_by: user.id, comment_updated_at: new Date() }).where("id", "=", row.id).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, context.scheme_id, batchId, "report.remarks.updated", "draft", "draft", { student_id: studentId, actor });
      return updated;
    });
  }

  async batchAction(user: AuthUser, schoolId: string, batchId: string, action: string, body: unknown) {
    if (!["review", "publish", "cancel"].includes(action)) throw new NotFoundException();
    await this.principal(user, schoolId);
    const data = revisionInput.parse(body);
    if (data.note.length < 3) throw new BadRequestException("Add a note for this action.");
    return this.db.transaction().execute(async (db) => {
      const batch = await db.selectFrom("grading_report_batches").selectAll().where("id", "=", batchId).where("school_id", "=", schoolId).forUpdate().executeTakeFirst();
      if (!batch) throw new NotFoundException("Report batch not found.");
      if (batch.revision !== data.expected_revision) throw new ConflictException("This report batch changed. Refresh before continuing.");
      const scheme = await db.selectFrom("grading_schemes").selectAll().where("id", "=", batch.scheme_id).executeTakeFirstOrThrow();
      let next = batch.status;
      const update: Record<string, unknown> = { revision: batch.revision + 1 };
      if (action === "review") {
        if (batch.status !== "draft") throw new ConflictException("Only a draft report batch can be reviewed.");
        const incomplete = Number((await sql<{ count: number }>`SELECT count(*)::int AS count FROM grading_report_students WHERE batch_id=${batchId}::uuid AND outcome='incomplete'`.execute(db)).rows[0]!.count);
        if (incomplete) throw new BadRequestException(`${incomplete} learner reports are incomplete. Publish the missing assessment results and generate a new batch.`);
        if (scheme.review_mode === "independent" && batch.generated_by === user.id) throw new ForbiddenException("An independent reviewer must be different from the person who generated the report batch.");
        next = "reviewed"; Object.assign(update, { reviewed_by: user.id, reviewed_at: new Date(), review_note: data.note });
      }
      if (action === "publish") {
        if (batch.status !== "reviewed") throw new ConflictException("Review the report batch before publication.");
        next = "published"; Object.assign(update, { published_by: user.id, published_at: new Date(), publication_note: data.note });
        const recipients = await sql<{ user_id: string; link: string }>`SELECT DISTINCT student.user_id,'/student/results'::text AS link FROM grading_report_students report JOIN students student ON student.id=report.student_id WHERE report.batch_id=${batchId}::uuid AND student.user_id IS NOT NULL
          UNION SELECT DISTINCT parent.user_id,'/parent/results'::text AS link FROM grading_report_students report JOIN guardian_relationships relationship ON relationship.student_id=report.student_id JOIN parents parent ON parent.id=relationship.guardian_id WHERE report.batch_id=${batchId}::uuid AND parent.user_id IS NOT NULL`.execute(db);
        for (const recipient of recipients.rows) await db.insertInto("notifications").values({ recipient_id: recipient.user_id, kind: "general", title: "A report card has been published", body: scheme.name, link: recipient.link, metadata: { report_batch_id: batchId, scheme_id: scheme.id }, dedupe_key: `report:${batchId}:${recipient.user_id}` }).onConflict((conflict) => conflict.doNothing()).execute();
      }
      if (action === "cancel") {
        if (!['draft', 'reviewed'].includes(batch.status)) throw new ConflictException("A published report batch cannot be cancelled.");
        next = "cancelled";
      }
      const updated = await db.updateTable("grading_report_batches").set({ ...update, status: next }).where("id", "=", batchId).returningAll().executeTakeFirstOrThrow();
      await this.audit(db, user, schoolId, batch.scheme_id, batchId, `report.${action}`, batch.status, next, { note: data.note });
      return updated;
    });
  }

  async familyReports(user: AuthUser, schoolId: string, studentId: string) {
    uuid.parse(schoolId); uuid.parse(studentId);
    const allowed = (await sql<{ ok: boolean }>`SELECT EXISTS(SELECT 1 FROM students student JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=student.school_id AND membership.is_active AND membership.role='student' WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid AND student.user_id=${user.id}::uuid)
      OR EXISTS(SELECT 1 FROM guardian_relationships relationship JOIN parents parent ON parent.id=relationship.guardian_id JOIN school_memberships membership ON membership.user_id=${user.id}::uuid AND membership.school_id=relationship.school_id AND membership.is_active AND membership.role='guardian' WHERE relationship.student_id=${studentId}::uuid AND relationship.school_id=${schoolId}::uuid AND parent.user_id=${user.id}::uuid) AS ok`.execute(this.db)).rows[0]?.ok;
    if (!allowed) throw new ForbiddenException("You cannot view this learner's report cards.");
    const student = (await sql`SELECT student.id,student.admission_number,person.first_name,person.last_name,'Class '||section.grade||section.section AS class_name FROM students student JOIN school_people person ON person.id=student.person_id LEFT JOIN enrollments enrollment ON enrollment.student_id=student.id AND enrollment.is_active LEFT JOIN class_sections section ON section.id=enrollment.class_section_id WHERE student.id=${studentId}::uuid AND student.school_id=${schoolId}::uuid ORDER BY enrollment.enrolled_on DESC LIMIT 1`.execute(this.db)).rows[0];
    if (!student) throw new NotFoundException();
    const reports = await sql`SELECT * FROM (SELECT DISTINCT ON(scheme.id) report.id AS report_student_id,batch.id AS batch_id,batch.sequence,batch.published_at,batch.correction_reason,
      scheme.id AS scheme_id,scheme.name AS scheme_name,term.name AS term_name,term.academic_year,report.outcome,report.overall_percentage,report.overall_grade,report.class_teacher_comment,report.principal_comment
      FROM grading_report_students report JOIN grading_report_batches batch ON batch.id=report.batch_id AND batch.status='published'
      JOIN grading_schemes scheme ON scheme.id=batch.scheme_id JOIN academic_terms term ON term.id=scheme.term_id
      WHERE report.school_id=${schoolId}::uuid AND report.student_id=${studentId}::uuid ORDER BY scheme.id,batch.sequence DESC) latest ORDER BY latest.published_at DESC`.execute(this.db);
    const reportIds = reports.rows.map((report) => String((report as { report_student_id: string }).report_student_id));
    const subjects = reportIds.length ? await sql`SELECT result.*,subject.name AS subject_name,subject.color,subject.icon,
      COALESCE((SELECT array_agg(DISTINCT source.assessment_id ORDER BY source.assessment_id) FROM grading_report_components component
        JOIN grading_report_assessment_sources source ON source.report_component_id=component.id
        WHERE component.report_subject_id=result.id),'{}'::uuid[]) AS assessment_ids
      FROM grading_report_subjects result JOIN subjects subject ON subject.id=result.subject_id
      WHERE result.report_student_id=ANY(${reportIds}::uuid[]) ORDER BY result.report_student_id,subject.name`.execute(this.db) : { rows: [] };
    return { student, reports: reports.rows.map((report) => ({ ...(report as Record<string, unknown>), subjects: subjects.rows.filter((subject) => String((subject as { report_student_id: string }).report_student_id) === String((report as { report_student_id: string }).report_student_id)) })) };
  }
}
