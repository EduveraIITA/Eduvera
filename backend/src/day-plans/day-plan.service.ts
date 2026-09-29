import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql } from "kysely";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import { SchoolEventService } from "../school/school-event.service.js";
import { SchoolService } from "../school/school.service.js";
import {
  actionSchema,
  date as dateSchema,
  responseSchema,
  saveSchema,
  startSchema,
  uuid,
  samePeriod,
  comparable,
  type Plan,
  type PlanDb,
  type PlanPeriod,
} from "./contracts.js";
import {
  activeTeachers,
  audit,
  authorize,
  dayContext,
  getPlan,
  insertPeriods,
  periods,
} from "./repository.js";
import {
  effectiveSchedule,
  lockSchedule,
  scheduleConflicts,
} from "./schedule.js";
import {
  planDetail,
  planOptions,
  teacherDay,
  teacherSummary,
} from "./day-plan.queries.js";
import { planEvent } from "./events.js";
const baselineHash = (rows: PlanPeriod[]) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        [...rows]
          .sort((a, b) => a.period_number - b.period_number)
          .map(comparable),
      ),
    )
    .digest("hex");

@Injectable()
export class DayPlanService {
  constructor(
    private readonly db: DatabaseService,
    private readonly events: SchoolEventService,
    private readonly school: SchoolService,
  ) {}
  options(user: AuthUser, schoolId: string, date: string) {
    return planOptions(
      this.db,
      user,
      uuid.parse(schoolId),
      dateSchema.parse(date),
    );
  }
  detail(user: AuthUser, id: string, schoolId: string) {
    return this.db
      .transaction()
      .setIsolationLevel("repeatable read")
      .execute((db) => planDetail(db, user, schoolId, id));
  }
  teacher(user: AuthUser, schoolId: string, date: string) {
    return teacherDay(
      this.db,
      user,
      uuid.parse(schoolId),
      dateSchema.parse(date),
    );
  }
  teacherSummary(user: AuthUser, schoolId: string, start: string, end: string) {
    const startDate = dateSchema.parse(start);
    const endDate = dateSchema.parse(end);
    const startMs = Date.parse(`${startDate}T00:00:00Z`);
    const endMs = Date.parse(`${endDate}T00:00:00Z`);
    const days = Math.round((endMs - startMs) / 86_400_000) + 1;
    if (days < 1)
      throw new BadRequestException("End date must follow start date.");
    if (days > 370)
      throw new BadRequestException(
        "Teacher summary ranges are limited to 370 days.",
      );
    return teacherSummary(
      this.db,
      user,
      uuid.parse(schoolId),
      startDate,
      endDate,
    );
  }
  private async command<T>(
    req: AuthenticatedRequest,
    input: { school_id: string; idempotency_key: string },
    identity: unknown,
    role: "staff" | "admin",
    run: (db: PlanDb) => Promise<T>,
  ): Promise<T> {
    const hash = createHash("sha256")
      .update(JSON.stringify(identity))
      .digest("hex");
    try {
      return await this.db.transaction().execute(async (db) => {
        await sql`SET LOCAL lock_timeout='5s'`.execute(db);
        await sql`SET LOCAL statement_timeout='20s'`.execute(db);
        await lockSchedule(db, input.school_id);
        await authorize(db, req.authUser, input.school_id, role, true);
        const previous = (
          await sql<{
            request_hash: string;
            result: T;
          }>`SELECT request_hash,result FROM day_plan_commands WHERE school_id=${input.school_id}::uuid AND actor_id=${req.authUser.id}::uuid AND command_key=${input.idempotency_key}::uuid`.execute(
            db,
          )
        ).rows[0];
        if (previous) {
          if (previous.request_hash !== hash)
            throw new ConflictException(
              "This retry key belongs to a different action.",
            );
          return previous.result;
        }
        const result = await run(db);
        await sql`INSERT INTO day_plan_commands(school_id,actor_id,command_key,request_hash,result) VALUES(${input.school_id}::uuid,${req.authUser.id}::uuid,${input.idempotency_key}::uuid,${hash},${JSON.stringify(result)}::jsonb)`.execute(
          db,
        );
        return result;
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        ["23505", "40001", "40P01", "55P03", "57014"].includes(
          String(error.code),
        )
      )
        throw new ConflictException(
          "The schedule changed or is busy. Reload the latest plan and retry.",
        );
      throw error;
    }
  }
  private ensureRevision(plan: Plan, revision: number) {
    if (plan.revision !== revision)
      throw new ConflictException(
        "This plan changed. Reload the latest revision before continuing.",
      );
  }
  private async editableDay(
    db: PlanDb,
    plan: Pick<Plan, "school_id" | "date">,
  ) {
    const context = await dayContext(db, plan.school_id, plan.date);
    if (plan.date < context.today)
      throw new BadRequestException("Past day plans are read-only.");
    return context;
  }
  private async guardStarted(db: PlanDb, plan: Plan, rows: PlanPeriod[]) {
    const context = await this.editableDay(db, plan);
    if (plan.date !== context.today) return;
    const current = (
      await effectiveSchedule(db, plan.school_id, plan.date)
    ).filter((p) => p.class_section_id === plan.class_section_id);
    for (const old of current) {
      if (old.starts_at.slice(0, 5) > context.local_time) continue;
      const next = rows.find((p) => p.period_number === old.period_number);
      if (!next || !samePeriod(old, next))
        throw new BadRequestException(
          "A period that has already started cannot be rewritten. Change an upcoming period instead.",
        );
    }
    for (const next of rows)
      if (
        next.starts_at.slice(0, 5) <= context.local_time &&
        !current.some((old) => samePeriod(old, next))
      )
        throw new BadRequestException(
          "New or changed periods must start in the future.",
        );
  }
  async start(req: AuthenticatedRequest, body: unknown) {
    const input = startSchema.strict().parse(body);
    return this.command(
      req,
      input,
      { action: "start", ...input },
      "admin",
      async (db) => {
        await this.editableDay(db, {
          school_id: input.school_id,
          date: input.date,
        });
        const section = (
          await sql<{
            term_id: string;
          }>`SELECT t.id AS term_id FROM class_sections c JOIN academic_terms t ON t.school_id=c.school_id AND t.academic_year=c.academic_year WHERE c.id=${input.class_section_id}::uuid AND c.school_id=${input.school_id}::uuid AND ${input.date}::date BETWEEN t.starts_on AND t.ends_on ORDER BY t.starts_on DESC LIMIT 1 FOR SHARE OF c,t`.execute(
            db,
          )
        ).rows[0];
        if (!section)
          throw new BadRequestException(
            "Choose a class with a term covering this date.",
          );
        const previous = (
          await sql<Plan>`SELECT * FROM day_plans WHERE school_id=${input.school_id}::uuid AND class_section_id=${input.class_section_id}::uuid AND date=${input.date}::date FOR UPDATE`.execute(
            db,
          )
        ).rows[0];
        if (previous?.draft_version)
          return { id: previous.id, revision: previous.revision };
        const baseline = (
          await effectiveSchedule(db, input.school_id, input.date)
        ).filter((p) => p.class_section_id === input.class_section_id);
        const plan =
          previous ??
          (
            await sql<Plan>`INSERT INTO day_plans(school_id,class_section_id,term_id,date,owner_id) VALUES(${input.school_id}::uuid,${input.class_section_id}::uuid,${section.term_id}::uuid,${input.date}::date,${req.authUser.id}::uuid) RETURNING *`.execute(
              db,
            )
          ).rows[0]!;
        const version = (
          await sql<{
            n: number;
          }>`SELECT COALESCE(max(version),0)+1 AS n FROM day_plan_versions WHERE plan_id=${plan.id}::uuid`.execute(
            db,
          )
        ).rows[0]!.n;
        const old = plan.published_version
          ? (
              await sql<{
                notice: string;
              }>`SELECT notice FROM day_plan_versions WHERE plan_id=${plan.id}::uuid AND version=${plan.published_version}`.execute(
                db,
              )
            ).rows[0]
          : null;
        await sql`INSERT INTO day_plan_versions(school_id,plan_id,version,state,notice,created_by,baseline_hash) VALUES(${plan.school_id}::uuid,${plan.id}::uuid,${version},'draft',${old?.notice ?? ""},${req.authUser.id}::uuid,${baselineHash(baseline)})`.execute(
          db,
        );
        await insertPeriods(db, plan, version, baseline);
        const revision = previous ? plan.revision + 1 : plan.revision;
        await sql`UPDATE day_plans SET draft_version=${version},revision=${revision},updated_at=now() WHERE id=${plan.id}::uuid`.execute(
          db,
        );
        await audit(db, req, plan, "draft_created", { version });
        await planEvent(db, this.events, plan, revision, "draft");
        return { id: plan.id, revision };
      },
    );
  }
  save(req: AuthenticatedRequest, id: string, body: unknown) {
    const input = saveSchema.parse(body);
    uuid.parse(id);
    return this.command(
      req,
      input,
      { action: "save", id, ...input },
      "admin",
      async (db) => {
        const plan = await getPlan(db, input.school_id, id, true);
        this.ensureRevision(plan, input.expected_revision);
        if (!plan.draft_version)
          throw new ConflictException(
            "Create a new draft before editing this plan.",
          );
        await this.guardStarted(db, plan, input.periods);
        await sql`DELETE FROM day_plan_periods WHERE plan_id=${id}::uuid AND version=${plan.draft_version}`.execute(
          db,
        );
        await insertPeriods(db, plan, plan.draft_version, input.periods);
        await sql`UPDATE day_plan_versions SET notice=${input.notice},reason=${input.reason} WHERE plan_id=${id}::uuid AND version=${plan.draft_version}`.execute(
          db,
        );
        await sql`UPDATE day_plans SET revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(
          db,
        );
        await audit(db, req, plan, "draft_saved", {
          version: plan.draft_version,
          revision: plan.revision + 1,
        });
        await planEvent(db, this.events, plan, plan.revision + 1, "draft");
        return { id, revision: plan.revision + 1 };
      },
    );
  }
  publish(req: AuthenticatedRequest, id: string, body: unknown) {
    const input = actionSchema.parse(body);
    uuid.parse(id);
    return this.command(
      req,
      input,
      { action: "publish", id, ...input },
      "admin",
      async (db) => {
        const plan = await getPlan(db, input.school_id, id, true);
        this.ensureRevision(plan, input.expected_revision);
        if (!plan.draft_version)
          throw new ConflictException("There is no draft to publish.");
        const rows = await periods(db, id, plan.draft_version);
        const context = await this.editableDay(db, plan);
        await this.guardStarted(db, plan, rows);
        if (
          context.is_instructional === false &&
          rows.some((p) => !p.cancelled)
        )
          throw new BadRequestException(
            "The school calendar marks this as a non-instructional day. Active periods cannot be published.",
          );
        const version = (
          await sql<{
            reason: string;
            baseline_hash: string | null;
          }>`SELECT reason,baseline_hash FROM day_plan_versions WHERE plan_id=${id}::uuid AND version=${plan.draft_version}`.execute(
            db,
          )
        ).rows[0]!;
        if (!version.reason.trim())
          throw new BadRequestException(
            "Add a reason for this published change.",
          );
        await activeTeachers(
          db,
          plan.school_id,
          rows.flatMap((p) => (p.teacher_user_id ? [p.teacher_user_id] : [])),
          true,
        );
        const conflicts = await scheduleConflicts(
          db,
          plan.school_id,
          plan.date,
          plan.class_section_id,
          rows,
        );
        if (conflicts.length)
          throw new BadRequestException({
            message: "Resolve scheduling conflicts before publishing.",
            conflicts,
          });
        const old = (
          await effectiveSchedule(db, plan.school_id, plan.date)
        ).filter((p) => p.class_section_id === plan.class_section_id);
        if (version.baseline_hash !== baselineHash(old))
          throw new ConflictException(
            "The underlying timetable changed after this draft was prepared. Discard the draft and prepare a fresh revision.",
          );
        const oldStored = plan.published_version
          ? await periods(db, id, plan.published_version)
          : [];
        for (const row of rows) {
          const previous = old.find(
              (p) => p.period_number === row.period_number,
            ),
            stored = oldStored.find(
              (p) => p.period_number === row.period_number,
            );
          const unchanged = previous && samePeriod(previous, row);
          const status =
            row.cancelled || row.slot_type === "break"
              ? "not_required"
              : !row.teacher_user_id
                ? "unassigned"
                : unchanged
                  ? (stored?.coverage_status ?? "not_required")
                  : "pending";
          await sql`UPDATE day_plan_periods SET coverage_status=${status},response_note=${unchanged ? (stored?.response_note ?? "") : ""},response_source=${unchanged ? (stored?.response_source ?? null) : null},responded_by=${unchanged ? (stored?.responded_by ?? null) : null}::uuid,responded_at=${unchanged ? (stored?.responded_at ?? null) : null},received_at=${unchanged ? (stored?.received_at ?? null) : null},response_revision=${unchanged ? (stored?.response_revision ?? 0) : 0} WHERE id=${row.id}::uuid`.execute(
            db,
          );
        }
        await sql`UPDATE day_plan_versions SET state='superseded' WHERE plan_id=${id}::uuid AND state='published'`.execute(
          db,
        );
        await sql`UPDATE day_plan_versions SET state='published',published_at=now() WHERE plan_id=${id}::uuid AND version=${plan.draft_version}`.execute(
          db,
        );
        await sql`UPDATE day_plans SET published_version=draft_version,draft_version=NULL,revision=revision+1,owner_id=${req.authUser.id}::uuid,updated_at=now() WHERE id=${id}::uuid`.execute(
          db,
        );
        const updated = {
          ...plan,
          published_version: plan.draft_version,
          owner_id: req.authUser.id,
        };
        const recorded = (
          await sql<{
            student_id: string;
          }>`SELECT e.student_id FROM enrollments e JOIN attendance_records ar ON ar.student_id=e.student_id AND ar.date=${plan.date}::date WHERE e.class_section_id=${plan.class_section_id}::uuid AND e.term_id=${plan.term_id}::uuid AND e.is_active AND e.enrolled_on<=${plan.date}::date`.execute(
            db,
          )
        ).rows.map((r) => r.student_id);
        await this.school.refreshSubjectAttendance(db, recorded);
        await audit(db, req, plan, "published", {
          version: plan.draft_version,
          reason: version.reason,
        });
        await planEvent(
          db,
          this.events,
          updated,
          plan.revision + 1,
          "published",
        );
        return { id, revision: plan.revision + 1, version: plan.draft_version };
      },
    );
  }
  discard(req: AuthenticatedRequest, id: string, body: unknown) {
    const input = actionSchema.parse(body);
    uuid.parse(id);
    return this.command(
      req,
      input,
      { action: "discard", id, ...input },
      "admin",
      async (db) => {
        const plan = await getPlan(db, input.school_id, id, true);
        this.ensureRevision(plan, input.expected_revision);
        if (!plan.draft_version)
          throw new ConflictException("There is no draft to discard.");
        await sql`UPDATE day_plan_versions SET state='discarded' WHERE plan_id=${id}::uuid AND version=${plan.draft_version}`.execute(
          db,
        );
        await sql`UPDATE day_plans SET draft_version=NULL,revision=revision+1,updated_at=now() WHERE id=${id}::uuid`.execute(
          db,
        );
        await audit(db, req, plan, "draft_discarded", {
          version: plan.draft_version,
        });
        await planEvent(db, this.events, plan, plan.revision + 1, "draft");
        return { id, revision: plan.revision + 1 };
      },
    );
  }
  respond(req: AuthenticatedRequest, id: string, body: unknown) {
    const input = responseSchema.parse(body);
    uuid.parse(id);
    const assisted = input.source !== "app";
    return this.command(
      req,
      input,
      { action: "respond", id, ...input },
      assisted ? "admin" : "staff",
      async (db) => {
        const reference = (
          await sql<{
            plan_id: string;
            version: number;
          }>`SELECT plan_id,version FROM day_plan_periods WHERE id=${id}::uuid AND school_id=${input.school_id}::uuid`.execute(
            db,
          )
        ).rows[0];
        if (!reference)
          throw new NotFoundException("Coverage assignment not found.");
        const plan = await getPlan(
          db,
          input.school_id,
          reference.plan_id,
          true,
        );
        if (plan.published_version !== reference.version)
          throw new ConflictException(
            "This assignment was superseded. Open the latest schedule.",
          );
        const row = (await periods(db, plan.id, reference.version)).find(
          (p) => p.id === id,
        )!;
        if (
          !row.teacher_user_id ||
          row.cancelled ||
          row.coverage_status === "not_required"
        )
          throw new ConflictException(
            "This period does not need a coverage response.",
          );
        if (!assisted && row.teacher_user_id !== req.authUser.id)
          throw new NotFoundException("This coverage assignment is not yours.");
        await activeTeachers(db, plan.school_id, [row.teacher_user_id], true);
        if (row.response_revision !== input.expected_revision)
          throw new ConflictException(
            "The coverage response changed. Reload before responding.",
          );
        const context = await dayContext(db, plan.school_id, plan.date);
        if (
          !assisted &&
          (plan.date < context.today ||
            (plan.date === context.today &&
              row.ends_at.slice(0, 5) <= context.local_time))
        )
          throw new ConflictException(
            "This assignment has ended. Ask the school office to record a historical response.",
          );
        const received = input.received_at
          ? new Date(input.received_at)
          : new Date();
        const published = (
          await sql<{
            published_at: Date;
          }>`SELECT published_at FROM day_plan_versions WHERE plan_id=${plan.id}::uuid AND version=${reference.version}`.execute(
            db,
          )
        ).rows[0]!.published_at;
        if (received.getTime() > Date.now() + 5000 || received < published)
          throw new BadRequestException(
            "The response time must be after publication and not in the future.",
          );
        await sql`UPDATE day_plan_periods SET coverage_status=${input.status},response_note=${input.note},response_source=${input.source},responded_by=${req.authUser.id}::uuid,responded_at=now(),received_at=${received},response_revision=response_revision+1 WHERE id=${id}::uuid`.execute(
          db,
        );
        await sql`UPDATE day_plans SET revision=revision+1,updated_at=now() WHERE id=${plan.id}::uuid`.execute(
          db,
        );
        await audit(db, req, plan, "coverage_responded", {
          period_id: id,
          version: reference.version,
          teacher_user_id: row.teacher_user_id,
          status: input.status,
          source: input.source,
          received_at: received.toISOString(),
          note: input.note,
        });
        await planEvent(
          db,
          this.events,
          plan,
          plan.revision + 1,
          "coverage",
          row.teacher_user_id,
        );
        return {
          id,
          status: input.status,
          response_revision: row.response_revision + 1,
        };
      },
    );
  }
}
