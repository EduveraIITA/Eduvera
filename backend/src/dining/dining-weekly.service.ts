import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { sql, type Selectable } from "kysely";
import { z } from "zod";
import { DatabaseService } from "../database/database.service.js";
import type { AuthUser } from "../common/request.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import {
  PLAN_OCCURRENCE_PORT,
  type PlanOccurrencePort,
  type PlanOccurrenceProjection,
} from "../campus-model-core/plan-occurrence.port.js";
import { retainOperatingDestination } from "../institution-onboarding/operating-resume.js";
import { timezoneTransitionDates } from "../schedule-planning/activity-occurrence.engine.js";
import type { DiningService } from "./dining.service.js";
import type { DiningSessionTable } from "./dining.types.js";
import {
  diningPlanInput,
  diningPlanActionInput,
  diningPlanListInput,
  diningRangeInput,
  diningHistoryInput,
  diningPlanDateActionInput,
  diningPlanHref,
  diningDateHref,
  diningHref,
  type DiningAvailabilityItem,
  type DiningAvailabilityPage,
} from "./dining.contracts.js";
import {
  addDiningDays,
  diningDateId,
  expandDiningDates,
  resolveDiningWallTime,
  validateDiningRange,
  type WeeklyPlan,
  type DiningTx,
  type ExpandedDiningDate,
  normalizeWeeklyPlan,
  diningDateValue,
} from "./dining-weekly.resolver.js";
type Session = Selectable<DiningSessionTable>;
@Injectable()
export class DiningWeeklyService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(PLAN_OCCURRENCE_PORT) private readonly temporal: PlanOccurrencePort,
  ) {}
  private async row(tx: DiningTx, school: string, id: string, lock = false) {
    const row = await tx
      .selectFrom("dining_weekly_plans")
      .selectAll()
      .where("school_id", "=", school)
      .where("id", "=", id)
      .$if(lock, (q) => q.forUpdate())
      .executeTakeFirst();
    if (!row) throw new NotFoundException("Weekly plan not found.");
    return normalizeWeeklyPlan(row);
  }
  private async days(tx: DiningTx, plan: WeeklyPlan) {
    return tx
      .selectFrom("dining_weekly_days")
      .selectAll()
      .where("school_id", "=", plan.school_id)
      .where("plan_id", "=", plan.id)
      .orderBy("weekday")
      .execute();
  }
  private async today(tx: DiningTx, zone: string) {
    return (
      await sql<{
        date: string;
      }>`SELECT (${executionNow()}::timestamptz AT TIME ZONE ${zone})::date::text AS date`.execute(
        tx,
      )
    ).rows[0]!.date;
  }
  private obsolete(
    source: string,
    command: string,
    expected: number,
    current: number,
  ) {
    throw new ConflictException({
      code: "dining_obsolete",
      message: "This source changed. Review the current date or plan.",
      fields: {
        dining_obsolete: {
          confirmation: "permanently_inapplicable",
          receipt_state: "absent",
          source_id: source,
          command_id: command,
          expected_revision: expected,
          current_revision: current,
          reason: "stream_advanced",
        },
      },
    });
  }
  private superseded(
    command: string,
    expected: WeeklyPlan,
    current: WeeklyPlan,
    expectedRevision: number,
  ) {
    throw new ConflictException({
      code: "dining_obsolete",
      message:
        "A different published version now governs this date. Review that exact date.",
      fields: {
        dining_obsolete: {
          confirmation: "permanently_inapplicable",
          receipt_state: "absent",
          source_id: expected.id,
          command_id: command,
          expected_revision: expectedRevision,
          current_revision: current.revision,
          expected_plan_version_id: expected.id,
          current_plan_version_id: current.id,
          reason: "plan_superseded",
        },
      },
    });
  }
  private async snapshot(tx: DiningTx, row: WeeklyPlan) {
    return (
      await sql<{
        snapshot: unknown;
      }>`SELECT dining_weekly_snapshot(${row.school_id}::uuid,${row.id}::uuid) AS snapshot`.execute(
        tx,
      )
    ).rows[0]!.snapshot;
  }
  private async evidence(
    tx: DiningTx,
    user: AuthUser,
    person: string,
    row: WeeklyPlan,
    command: string,
    id: string,
    action: string,
    note: string,
    exception?: { date: string; id: string },
  ) {
    await tx
      .insertInto("dining_weekly_receipts")
      .values({
        id,
        school_id: row.school_id,
        plan_id: row.id,
        revision: row.revision,
        command_id: command,
        action,
        actor_person_id: person,
        actor_user_id: user.id,
        note,
        snapshot: await this.snapshot(tx, row),
        recorded_at: row.updated_at,
        exception_date: exception?.date ?? null,
        date_session_id: exception?.id ?? null,
      })
      .execute();
  }
  private async readable(
    d: DiningService,
    tx: DiningTx,
    user: AuthUser,
    row: WeeklyPlan,
  ) {
    const actor = await d.access.campus(tx, user, row.school_id);
    if (
      !row.published_at &&
      actor.person_id !== row.coordinator_person_id &&
      !(
        (await d.access.manages(tx, user, row.school_id)) &&
        !(await d.recipient(tx, row.school_id, row.coordinator_person_id))
      )
    )
      throw new ForbiddenException(
        "This draft belongs to its named coordinator.",
      );
    return actor;
  }
  private async dto(
    d: DiningService,
    tx: DiningTx,
    user: AuthUser,
    row: WeeklyPlan,
    historyPage = 1,
  ) {
    row = normalizeWeeklyPlan(row);
    const actor = await this.readable(d, tx, user, row),
      days = await this.days(tx, row),
      service = await d.serviceRow(tx, row.school_id, row.service_id),
      refs = await d.refs(
        tx,
        row.school_id,
        [
          row.coordinator_person_id,
          ...days.map((day) => day.operator_person_id),
        ],
        days.map((day) => day.space_id),
      );
    if (!row.published_at && actor.person_id !== row.coordinator_person_id)
      return {
        id: row.id,
        series_id: row.series_id,
        revision: row.revision,
        state: row.state,
        recovery_only: true as const,
        allowed_actions: ["recover"],
      };
    const family = await tx
      .selectFrom("dining_weekly_plans")
      .select(["id", "state", "version_number"])
      .where("school_id", "=", row.school_id)
      .where("series_id", "=", row.series_id)
      .orderBy("version_number", "desc")
      .execute();
    const history =
      actor.person_id === row.coordinator_person_id
        ? await tx
            .selectFrom("dining_weekly_receipts")
            .selectAll()
            .where("school_id", "=", row.school_id)
            .where("plan_id", "=", row.id)
            .orderBy("revision", "desc")
            .limit(11)
            .offset((historyPage - 1) * 10)
            .execute()
        : [];
    const latest = family.find((p) => p.state !== "draft"),
      draft = family.find((p) => p.state === "draft"),
      can = actor.person_id === row.coordinator_person_id;
    const parent = row.replaces_plan_id
      ? await this.row(tx, row.school_id, row.replaces_plan_id)
      : null;
    return {
      ...row,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      published_at: row.published_at?.toISOString() ?? null,
      source: d.source(row),
      service: { id: service.id, label: service.name },
      coordinator: refs.person(row.coordinator_person_id),
      days: days.map((day) => ({
        ...day,
        place: refs.space(day.space_id),
        operator: refs.person(day.operator_person_id),
      })),
      allowed_actions: can
        ? row.state === "draft"
          ? ["save", "publish", "recover"]
          : latest?.id === row.id
            ? [
                ...(!draft ? ["revise"] : []),
                ...(row.state === "published" ? ["stop"] : []),
                "recover",
              ]
            : ["recover"]
        : (await d.access.manages(tx, user, row.school_id)) &&
            !(await d.recipient(tx, row.school_id, row.coordinator_person_id))
          ? ["recover"]
          : [],
      history: await d.history(tx, row.school_id, history.slice(0, 10)),
      history_pagination: {
        page: historyPage,
        page_size: 10,
        has_more: history.length > 10,
      },
      draft_id: draft?.id ?? null,
      current_published_id: latest?.id ?? null,
      current_parent_revision: parent?.revision ?? null,
      parent_changed: Boolean(
        parent && parent.revision !== row.replaces_revision,
      ),
    };
  }
  async savePlan(
    d: DiningService,
    user: AuthUser,
    school: string,
    raw: unknown,
  ) {
    const body = diningPlanInput.parse(raw),
      id = body.id ?? body.command_id;
    return this.db.transaction().execute(async (tx) => {
      await d.lock(tx, school);
      const actor = await d.access.campus(tx, user, school),
        old = await tx
          .selectFrom("dining_weekly_plans")
          .selectAll()
          .where("school_id", "=", school)
          .where("id", "=", id)
          .forUpdate()
          .executeTakeFirst(),
        service = await d.serviceRow(tx, school, body.service_id, true),
        manager = await d.access.manages(tx, user, school);
      if (
        old
          ? actor.person_id !== old.coordinator_person_id
          : actor.person_id !== service.coordinator_person_id && !manager
      )
        throw new ForbiddenException(
          "Only the named service coordinator can plan its menus.",
        );
      const source = old ?? {
          id,
          school_id: school,
          revision: 0,
          updated_at: executionNow(),
        },
        capability = manager && !old ? "dining.manage" : "dining.coordinate";
      const command = await d.model.prepare(
        tx,
        user,
        actor,
        source,
        "plan",
        "save",
        body,
        capability,
        {
          service_id: service.id,
          service_revision: service.revision,
          coordinator_person_id:
            old?.coordinator_person_id ?? service.coordinator_person_id,
        },
      );
      if (command.replay)
        return {
          ...command.result,
          kind: "plan" as const,
          series_id: old?.series_id ?? id,
        };
      if (old && old.state !== "draft")
        throw new BadRequestException(
          "Revise future weeks instead of editing a publication.",
        );
      if (
        !service.active ||
        (service.menu_mode === "reference" &&
          service.operations_mode === "reference")
      )
        throw new BadRequestException("This service is not operated here.");
      if (!old && service.revision !== body.service_expected_revision)
        this.obsolete(
          service.id,
          body.command_id,
          body.service_expected_revision,
          service.revision,
        );
      if (
        old &&
        (old.service_id !== service.id ||
          old.service_revision !== body.service_expected_revision)
      )
        throw new BadRequestException(
          "A plan keeps its original service version.",
        );
      for (const day of body.days) {
        await d.requirePerson(tx, school, day.operator_person_id);
        await d.place(tx, school, day.space_id);
        const duration =
          Date.parse(`2000-01-0${1 + day.end_day_offset}T${day.ends_at}:00Z`) -
          Date.parse(`2000-01-01T${day.starts_at}:00Z`);
        if (duration <= 0 || duration > 86400000)
          throw new BadRequestException(
            "Choose a serving window of up to 24 hours.",
          );
        if (service.menu_mode === "reference" && day.menu_text)
          throw new BadRequestException(
            "This menu belongs to its external source.",
          );
      }
      const at = executionNow();
      const values = {
        label: body.label,
        timezone: body.timezone,
        starts_on: body.starts_on,
        ends_on: body.ends_on,
        revision: (old?.revision ?? 0) + 1,
        updated_at: at,
      };
      const row = old
        ? await tx
            .updateTable("dining_weekly_plans")
            .set(values)
            .where("school_id", "=", school)
            .where("id", "=", id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await tx
            .insertInto("dining_weekly_plans")
            .values({
              ...values,
              id,
              school_id: school,
              series_id: id,
              service_id: service.id,
              service_revision: service.revision,
              version_number: 1,
              coordinator_person_id: service.coordinator_person_id,
              menu_mode: service.menu_mode,
              operations_mode: service.operations_mode,
              source_label: service.source_label,
              source_url: service.source_url,
              source_reference: service.source_reference,
              source_observed_at: service.source_observed_at,
              state: "draft",
              replaces_plan_id: null,
              replaces_revision: null,
              stop_from: null,
              published_at: null,
              created_by_user_id: user.id,
              created_at: at,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
      if (old)
        await tx
          .deleteFrom("dining_weekly_days")
          .where("school_id", "=", school)
          .where("plan_id", "=", id)
          .execute();
      await tx
        .insertInto("dining_weekly_days")
        .values(
          body.days.map((day) => ({ ...day, school_id: school, plan_id: id })),
        )
        .execute();
      await this.evidence(
        tx,
        user,
        actor.person_id,
        row,
        command.prepared.command_id,
        body.command_id,
        "saved",
        body.note,
      );
      await d.model.finish(
        tx,
        user,
        row,
        "plan",
        "saved",
        command.prepared,
        capability,
        null,
        [user.id],
      );
      return {
        id,
        series_id: row.series_id,
        kind: "plan" as const,
        revision: row.revision,
      };
    });
  }
  async plans(d: DiningService, user: AuthUser, school: string, raw: unknown) {
    const input = diningPlanListInput.parse(raw);
    return this.db.transaction().execute(async (tx) => {
      const actor = await d.access.campus(tx, user, school),
        manager = await d.access.manages(tx, user, school);
      const rows = (
        await sql<WeeklyPlan>`SELECT * FROM(SELECT DISTINCT ON(series_id) * FROM dining_weekly_plans WHERE school_id=${school}::uuid AND service_id=${input.service_id}::uuid AND(published_at IS NOT NULL OR coordinator_person_id=${actor.person_id}::uuid OR ${manager} AND NOT dining_person_available(school_id,coordinator_person_id)) ORDER BY series_id,version_number DESC) family ORDER BY created_at DESC,id`.execute(
          tx,
        )
      ).rows;
      const items = await Promise.all(
        rows
          .slice((input.page - 1) * 20, input.page * 20)
          .map((row) => this.dto(d, tx, user, row)),
      );
      return {
        items,
        total: rows.length,
        total_pages: Math.ceil(rows.length / 20),
        page: input.page,
        page_size: 20,
      };
    });
  }
  async plan(
    d: DiningService,
    user: AuthUser,
    school: string,
    id: string,
    raw: unknown = {},
  ) {
    const q = diningHistoryInput.parse(raw);
    return this.db
      .transaction()
      .execute(async (tx) =>
        this.dto(d, tx, user, await this.row(tx, school, id), q.history_page),
      );
  }
  async recoverPlan(
    d: DiningService,
    user: AuthUser,
    school: string,
    id: string,
    raw: unknown,
  ) {
    const body = diningPlanActionInput.parse(raw);
    if (!body.coordinator_person_id || body.note.length < 3)
      throw new BadRequestException(
        "Choose a responsible person and explain this handover.",
      );
    return this.db.transaction().execute(async (tx) => {
      await d.lock(tx, school);
      const actor = await d.access.campus(tx, user, school),
        old = await this.row(tx, school, id, true),
        own = actor.person_id === old.coordinator_person_id,
        manage = await d.access.manages(tx, user, school);
      if (await d.model.retained(tx, user, school, body.command_id)) {
        const accepted = await d.model.prepare(
          tx,
          user,
          actor,
          old,
          "plan",
          "recover",
          body,
          own ? "dining.coordinate" : "dining.manage",
          { plan_id: id },
        );
        if (accepted.replay)
          return {
            ...accepted.result,
            kind: "plan" as const,
            series_id: old.series_id,
          };
      }
      if (
        !own &&
        !(manage && !(await d.recipient(tx, school, old.coordinator_person_id)))
      )
        throw new ForbiddenException(
          "Only the exact coordinator, or an authorized orphan-recovery manager, may transfer this plan.",
        );
      const cap = own ? "dining.coordinate" : "dining.manage",
        command = await d.model.prepare(
          tx,
          user,
          actor,
          old,
          "plan",
          "recover",
          body,
          cap,
          {
            plan_id: id,
            previous_coordinator_person_id: old.coordinator_person_id,
            orphan_recovery: !own,
          },
        );
      if (command.replay)
        return {
          ...command.result,
          kind: "plan" as const,
          series_id: old.series_id,
        };
      await d.requirePerson(tx, school, body.coordinator_person_id!);
      if (body.coordinator_person_id === old.coordinator_person_id)
        throw new BadRequestException(
          "Choose the person taking responsibility.",
        );
      const row = await tx
        .updateTable("dining_weekly_plans")
        .set({
          coordinator_person_id: body.coordinator_person_id!,
          revision: old.revision + 1,
          updated_at: executionNow(),
        })
        .where("school_id", "=", school)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await this.evidence(
        tx,
        user,
        actor.person_id,
        row,
        command.prepared.command_id,
        body.command_id,
        "recovered",
        body.note,
      );
      const transferred =
        !row.published_at && actor.person_id !== row.coordinator_person_id;
      await d.model.finish(
        tx,
        user,
        { ...row, command_metadata: { access_transferred: transferred } },
        "plan",
        "recovered",
        command.prepared,
        cap,
        null,
        [user.id],
      );
      return {
        id,
        series_id: row.series_id,
        revision: row.revision,
        kind: "plan" as const,
        access_transferred: transferred,
      };
    });
  }
  private async validatePublication(
    d: DiningService,
    tx: DiningTx,
    row: WeeklyPlan,
  ) {
    const days = await this.days(tx, row);
    if (!days.length)
      throw new BadRequestException("Choose at least one weekday.");
    await d.requirePerson(tx, row.school_id, row.coordinator_person_id);
    for (const day of days) {
      await d.requirePerson(tx, row.school_id, day.operator_person_id);
      await d.place(tx, row.school_id, day.space_id);
      if (row.menu_mode === "native" && !day.menu_text.trim())
        throw new BadRequestException(
          "Add each selected day's menu before publishing.",
        );
    }
    const from = row.starts_on,
      near = await expandDiningDates(
        tx,
        row.school_id,
        from,
        addDiningDays(from, 34),
        { plan: row },
      );
    const warnings = near.flatMap((date) =>
      date.warning ? [date.warning] : [],
    );
    for (const date of timezoneTransitionDates(row.timezone, from))
      for (const offset of [0, 1]) {
        const local = addDiningDays(date, offset);
        if (local < row.starts_on || (row.ends_on && local > row.ends_on))
          continue;
        const weekday = new Date(`${local}T12:00:00Z`).getUTCDay() || 7,
          day = days.find((d) => d.weekday === weekday);
        if (day) {
          const resolved = resolveDiningWallTime(row, day, local);
          if (resolved.warning) warnings.push(resolved.warning);
        }
      }
    if (warnings.length)
      throw new BadRequestException({
        code: "dining_time_resolution",
        message: "Review unresolved clock-change dates before publishing.",
        warnings,
      });
  }
  async publishPlan(
    d: DiningService,
    user: AuthUser,
    school: string,
    id: string,
    raw: unknown,
  ) {
    const body = diningPlanActionInput.parse(raw);
    return this.db.transaction().execute(async (tx) => {
      await d.lock(tx, school);
      const actor = await d.access.campus(tx, user, school),
        old = await this.row(tx, school, id, true);
      if (actor.person_id !== old.coordinator_person_id)
        throw new ForbiddenException(
          "Only this plan's coordinator can publish it.",
        );
      const command = await d.model.prepare(
        tx,
        user,
        actor,
        old,
        "plan",
        "publish",
        body,
        "dining.coordinate",
        {
          plan_id: id,
          coordinator_person_id: old.coordinator_person_id,
          ...(old.replaces_plan_id
            ? {
                reviewed_parent_id: old.replaces_plan_id,
                reviewed_parent_revision:
                  body.expected_parent_revision ?? old.replaces_revision,
              }
            : {}),
        },
      );
      if (command.replay)
        return {
          ...command.result,
          kind: "plan" as const,
          series_id: old.series_id,
        };
      if (old.state !== "draft")
        throw new BadRequestException("This version is already published.");
      if (old.replaces_plan_id) {
        const parent = await this.row(tx, school, old.replaces_plan_id);
        if (
          parent.revision !==
          (body.expected_parent_revision ?? old.replaces_revision)
        )
          this.obsolete(
            parent.id,
            body.command_id,
            body.expected_parent_revision ?? old.replaces_revision!,
            parent.revision,
          );
        if (old.starts_on <= (await this.today(tx, old.timezone)))
          throw new BadRequestException(
            "A replacement begins on a future date.",
          );
      }
      await this.validatePublication(d, tx, old);
      const at = executionNow(),
        row = await tx
          .updateTable("dining_weekly_plans")
          .set({
            revision: old.revision + 1,
            state: "published",
            published_at: at,
            updated_at: at,
          })
          .where("school_id", "=", school)
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow();
      await this.evidence(
        tx,
        user,
        actor.person_id,
        row,
        command.prepared.command_id,
        body.command_id,
        "published",
        body.note,
      );
      const event = await d.model.finish(
        tx,
        user,
        row,
        "plan",
        "published",
        command.prepared,
        "dining.coordinate",
        null,
        [user.id],
      );
      await this.project(d, tx, user, row, "published", event.event_id);
      if (row.menu_mode === "native")
        await retainOperatingDestination(
          tx,
          user,
          school,
          "dining",
          diningPlanHref(id),
          { onlyPending: true, source: "accepted_dining_publication" },
        );
      return {
        id,
        series_id: row.series_id,
        kind: "plan" as const,
        revision: row.revision,
      };
    });
  }
  async revisePlan(
    d: DiningService,
    user: AuthUser,
    school: string,
    id: string,
    raw: unknown,
  ) {
    const body = diningPlanActionInput.parse(raw);
    if (!body.starts_on || body.note.length < 3)
      throw new BadRequestException(
        "Choose a future first date and give a short reason.",
      );
    return this.db.transaction().execute(async (tx) => {
      await d.lock(tx, school);
      const actor = await d.access.campus(tx, user, school),
        parent = await this.row(tx, school, id, true);
      if (actor.person_id !== parent.coordinator_person_id)
        throw new ForbiddenException(
          "Only this plan's coordinator can revise it.",
        );
      const existing = await tx
        .selectFrom("dining_weekly_plans")
        .selectAll()
        .where("school_id", "=", school)
        .where("id", "=", body.command_id)
        .executeTakeFirst();
      const payload = {
        ...body,
        expected_revision: 0,
        expected_parent_id: id,
        expected_parent_revision: body.expected_revision,
      };
      const command = await d.model.prepare(
        tx,
        user,
        actor,
        existing ?? {
          id: body.command_id,
          school_id: school,
          revision: 0,
          updated_at: executionNow(),
        },
        "plan",
        "revise",
        payload,
        "dining.coordinate",
        {
          plan_id: id,
          revision: parent.revision,
          coordinator_person_id: parent.coordinator_person_id,
        },
      );
      if (command.replay)
        return {
          ...command.result,
          kind: "plan" as const,
          series_id: parent.series_id,
        };
      if (parent.revision !== body.expected_revision)
        this.obsolete(
          id,
          body.command_id,
          body.expected_revision,
          parent.revision,
        );
      const latest = await tx
        .selectFrom("dining_weekly_plans")
        .select(["id", "version_number"])
        .where("school_id", "=", school)
        .where("series_id", "=", parent.series_id)
        .orderBy("version_number", "desc")
        .executeTakeFirstOrThrow();
      if (latest.id !== parent.id || !parent.published_at)
        throw new ConflictException(
          "Open the latest published version before changing future weeks.",
        );
      if (
        body.starts_on! <= (await this.today(tx, parent.timezone)) ||
        body.starts_on! <= parent.starts_on
      )
        throw new BadRequestException(
          "Choose a future date after this version's first date.",
        );
      const at = executionNow(),
        row = await tx
          .insertInto("dining_weekly_plans")
          .values({
            ...parent,
            id: body.command_id,
            version_number: parent.version_number + 1,
            revision: 1,
            starts_on: body.starts_on!,
            ends_on:
              parent.ends_on && parent.ends_on < body.starts_on!
                ? null
                : parent.ends_on,
            state: "draft",
            published_at: null,
            replaces_plan_id: parent.id,
            replaces_revision: parent.revision,
            stop_from: null,
            projection_receipt: {},
            created_by_user_id: user.id,
            created_at: at,
            updated_at: at,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      await tx
        .insertInto("dining_weekly_days")
        .values(
          (await this.days(tx, parent)).map((day) => ({
            ...day,
            plan_id: row.id,
          })),
        )
        .execute();
      await this.evidence(
        tx,
        user,
        actor.person_id,
        row,
        command.prepared.command_id,
        body.command_id,
        "revised",
        body.note,
      );
      await d.model.finish(
        tx,
        user,
        row,
        "plan",
        "revised",
        command.prepared,
        "dining.coordinate",
        null,
        [user.id],
      );
      return {
        id: row.id,
        series_id: row.series_id,
        kind: "plan" as const,
        revision: row.revision,
      };
    });
  }
  async stopPlan(
    d: DiningService,
    user: AuthUser,
    school: string,
    id: string,
    raw: unknown,
  ) {
    const body = diningPlanActionInput.parse(raw);
    if (!body.stop_from || body.note.length < 3)
      throw new BadRequestException(
        "Choose the stop date and give a short reason.",
      );
    return this.db.transaction().execute(async (tx) => {
      await d.lock(tx, school);
      const actor = await d.access.campus(tx, user, school),
        old = await this.row(tx, school, id, true);
      if (actor.person_id !== old.coordinator_person_id)
        throw new ForbiddenException(
          "Only the named coordinator can stop this plan.",
        );
      const command = await d.model.prepare(
        tx,
        user,
        actor,
        old,
        "plan",
        "stop",
        body,
        "dining.coordinate",
        { plan_id: id, coordinator_person_id: old.coordinator_person_id },
      );
      if (command.replay)
        return {
          ...command.result,
          kind: "plan" as const,
          series_id: old.series_id,
        };
      if (
        old.state !== "published" ||
        body.stop_from! < (await this.today(tx, old.timezone))
      )
        throw new BadRequestException(
          "Stop the current publication from today or a later date.",
        );
      const at = executionNow(),
        row = await tx
          .updateTable("dining_weekly_plans")
          .set({
            state: "stopped",
            stop_from: body.stop_from!,
            revision: old.revision + 1,
            updated_at: at,
          })
          .where("school_id", "=", school)
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow();
      await this.evidence(
        tx,
        user,
        actor.person_id,
        row,
        command.prepared.command_id,
        body.command_id,
        "stopped",
        body.note,
      );
      const event = await d.model.finish(
        tx,
        user,
        row,
        "plan",
        "stopped",
        command.prepared,
        "dining.coordinate",
        null,
        [user.id],
      );
      await this.project(d, tx, user, row, "stopped", event.event_id);
      return {
        id,
        series_id: row.series_id,
        kind: "plan" as const,
        revision: row.revision,
      };
    });
  }
  private async dateDto(
    d: DiningService,
    tx: DiningTx,
    user: AuthUser,
    date: ExpandedDiningDate,
    person: string,
    cancelled = false,
  ) {
    const { plan, day } = date,
      refs = await d.refs(
        tx,
        plan.school_id,
        [plan.coordinator_person_id, day.operator_person_id],
        [day.space_id],
      ),
      service = await d.serviceRow(tx, plan.school_id, plan.service_id);
    const coordinator = person === plan.coordinator_person_id,
      operator =
        person === day.operator_person_id && plan.operations_mode === "native";
    return {
      origin: "plan_date" as const,
      id: diningDateId(plan.school_id, plan.series_id, date.date),
      series_id: plan.series_id,
      plan_version_id: plan.id,
      plan_revision: plan.revision,
      local_date: date.date,
      service: { id: service.id, label: service.name },
      label: plan.label,
      menu_mode: plan.menu_mode,
      operations_mode: plan.operations_mode,
      source: d.source(plan),
      menu_text: day.menu_text,
      starts_at: date.starts_at,
      ends_at: date.ends_at,
      timezone: plan.timezone,
      place: refs.space(day.space_id),
      location_path: day.space_id
        ? ((await d.place(tx, plan.school_id, day.space_id, false))?.path ?? [])
        : [],
      coordinator: refs.person(plan.coordinator_person_id),
      operator: refs.person(day.operator_person_id),
      allowed_actions: [
        ...(coordinator
          ? ["publish_changes", ...(!cancelled ? ["cancel"] : [])]
          : []),
        ...(operator && !date.warning && !cancelled ? ["open"] : []),
      ],
      availability_only: true as const,
      venue_reserved: false as const,
      session: null,
      needs_time_resolution: !cancelled && Boolean(date.warning),
      cancelled_for_date: cancelled,
      state: cancelled ? "cancelled" : "planned",
      changed_for_date: cancelled,
      wall_times: {
        starts_at: day.starts_at,
        ends_at: day.ends_at,
        end_day_offset: day.end_day_offset,
      },
      day,
    };
  }
  async occurrences(
    d: DiningService,
    user: AuthUser,
    school: string,
    id: string,
    raw: unknown,
    preview = false,
  ) {
    const q = diningRangeInput.parse(raw);
    validateDiningRange(q.from, q.until);
    return this.db.transaction().execute(async (tx) => {
      const plan = await this.row(tx, school, id),
        actor = await this.readable(d, tx, user, plan);
      if (preview && plan.state !== "draft")
        throw new BadRequestException(
          "Preview belongs to an unpublished draft.",
        );
      const dates = await expandDiningDates(
        tx,
        school,
        q.from,
        q.until,
        preview ? { plan } : { series: plan.series_id },
      );
      const savedRows = preview
        ? []
        : await tx
            .selectFrom("dining_sessions")
            .selectAll()
            .where("school_id", "=", school)
            .where("weekly_series_id", "=", plan.series_id)
            .where("weekly_date", ">=", q.from)
            .where("weekly_date", "<=", q.until)
            .execute();
      const savedByDate = new Map(
        savedRows.map((row) => [diningDateValue(row.weekly_date)!, row]),
      );
      const cancellations = preview
        ? new Set<string>()
        : new Set(
            (
              await sql<{
                date: string;
              }>`SELECT receipt.exception_date::text AS date FROM dining_weekly_receipts receipt JOIN dining_weekly_plans p ON p.school_id=receipt.school_id AND p.id=receipt.plan_id WHERE receipt.school_id=${school}::uuid AND p.series_id=${plan.series_id}::uuid AND receipt.exception_date BETWEEN ${q.from}::date AND ${q.until}::date`.execute(
                tx,
              )
            ).rows.map((row) => row.date),
          );
      const byDate = new Map(dates.map((date) => [date.date, date]));
      const allDates = [
        ...new Set([...byDate.keys(), ...savedByDate.keys()]),
      ].sort();
      const warnings = dates.flatMap((date) =>
        date.warning &&
        !cancellations.has(date.date) &&
        !savedByDate.has(date.date)
          ? [date.warning]
          : [],
      );
      const items = [];
      for (const localDate of allDates.slice((q.page - 1) * 20, q.page * 20)) {
        const saved = savedByDate.get(localDate),
          date = byDate.get(localDate);
        items.push(
          saved && !preview
            ? {
                origin: "session" as const,
                session: await d.sessionDto(
                  tx,
                  saved,
                  actor.person_id,
                  await d.access.manages(tx, user, school),
                ),
              }
            : await this.dateDto(
                d,
                tx,
                user,
                date!,
                actor.person_id,
                cancellations.has(localDate),
              ),
        );
      }
      return {
        items,
        warnings,
        issues: warnings,
        page: q.page,
        page_size: 20,
        total: allDates.length,
        total_pages: Math.ceil(allDates.length / 20),
        from: q.from,
        until: q.until,
        timezone: plan.timezone,
      };
    });
  }
  async planDate(
    d: DiningService,
    user: AuthUser,
    school: string,
    series: string,
    date: string,
  ) {
    z.iso.date().parse(date);
    return this.db.transaction().execute(async (tx) => {
      const actor = await d.access.campus(tx, user, school),
        saved = await tx
          .selectFrom("dining_sessions")
          .selectAll()
          .where("school_id", "=", school)
          .where("weekly_series_id", "=", series)
          .where("weekly_date", "=", date)
          .executeTakeFirst();
      if (saved)
        return {
          origin: "session" as const,
          session: await d.sessionDto(
            tx,
            saved,
            actor.person_id,
            await d.access.manages(tx, user, school),
          ),
        };
      const expanded = (
        await expandDiningDates(tx, school, date, date, { series })
      )[0];
      if (!expanded)
        throw new NotFoundException(
          "No published service is planned for this date.",
        );
      return this.dateDto(
        d,
        tx,
        user,
        expanded,
        actor.person_id,
        await this.cancelled(tx, school, series, date),
      );
    });
  }
  private async cancelled(
    tx: DiningTx,
    school: string,
    series: string,
    date: string,
  ) {
    return Boolean(
      (
        await sql<{
          id: string;
        }>`SELECT receipt.id FROM dining_weekly_receipts receipt JOIN dining_weekly_plans plan ON plan.school_id=receipt.school_id AND plan.id=receipt.plan_id WHERE receipt.school_id=${school}::uuid AND plan.series_id=${series}::uuid AND receipt.exception_date=${date}::date LIMIT 1`.execute(
          tx,
        )
      ).rows[0],
    );
  }
  async actPlanDate(
    d: DiningService,
    user: AuthUser,
    school: string,
    series: string,
    date: string,
    raw: unknown,
  ) {
    z.iso.date().parse(date);
    const body = diningPlanDateActionInput.parse(raw),
      id = diningDateId(school, series, date);
    return this.db.transaction().execute(async (tx) => {
      await d.lock(tx, school);
      const actor = await d.access.campus(tx, user, school),
        saved = await tx
          .selectFrom("dining_sessions")
          .selectAll()
          .where("school_id", "=", school)
          .where("id", "=", id)
          .executeTakeFirst(),
        plan = await this.row(tx, school, body.expected_plan_version_id, true);
      const day = (await this.days(tx, plan)).find(
        (day) =>
          day.weekday === (new Date(`${date}T12:00:00Z`).getUTCDay() || 7),
      );
      if (plan.series_id !== series || !day)
        throw new BadRequestException(
          "This date does not belong to the reviewed plan.",
        );
      const capability =
        body.action === "open" ? "dining.operate" : "dining.coordinate";
      if (
        body.action !== "publish_changes" &&
        [body.menu_text, body.starts_at, body.ends_at, body.space_id].some(
          (value) => value !== undefined,
        )
      )
        throw new BadRequestException(
          "Use Change this date to edit its published menu, hours or place.",
        );
      if (
        body.action === "open"
          ? actor.person_id !== day.operator_person_id ||
            plan.operations_mode !== "native"
          : actor.person_id !== plan.coordinator_person_id
      )
        throw new ForbiddenException(
          "Only the exact person responsible for this action may record it.",
        );
      const unresolved = resolveDiningWallTime(plan, day, date);
      const retained = await d.model.retained(
        tx,
        user,
        school,
        body.command_id,
      );
      if (
        !saved &&
        body.action === "cancel" &&
        (unresolved.warning || retained?.safe_context.source_kind === "plan")
      ) {
        const command = await d.model.prepare(
          tx,
          user,
          actor,
          plan,
          "plan",
          "cancel_date",
          {
            ...body,
            expected_revision: body.expected_plan_revision,
            local_date: date,
          },
          "dining.coordinate",
          {
            plan_id: plan.id,
            coordinator_person_id: plan.coordinator_person_id,
            local_date: date,
          },
        );
        if (command.replay) return command.result;
        const current = (
          await expandDiningDates(tx, school, date, date, { series })
        )[0];
        if (!current || current.plan.id !== plan.id)
          this.obsolete(
            plan.id,
            body.command_id,
            body.expected_plan_revision,
            current?.plan.revision ?? plan.revision,
          );
        if (body.note.length < 3)
          throw new BadRequestException(
            "Give a reason for cancelling this date.",
          );
        if (await this.cancelled(tx, school, series, date))
          throw new BadRequestException("This date is already cancelled.");
        const row = await tx
          .updateTable("dining_weekly_plans")
          .set({ revision: plan.revision + 1, updated_at: executionNow() })
          .where("school_id", "=", school)
          .where("id", "=", plan.id)
          .returningAll()
          .executeTakeFirstOrThrow();
        await this.evidence(
          tx,
          user,
          actor.person_id,
          row,
          command.prepared.command_id,
          body.command_id,
          "date_cancelled",
          body.note,
          { date, id },
        );
        await d.model.finish(
          tx,
          user,
          row,
          "plan",
          "date_cancelled",
          command.prepared,
          "dining.coordinate",
          null,
          [user.id],
        );
        return {
          id: row.id,
          series_id: series,
          kind: "plan" as const,
          revision: row.revision,
        };
      }
      const payload = { ...body, expected_revision: 0 };
      const command = await d.model.prepare(
        tx,
        user,
        actor,
        saved ?? {
          id,
          school_id: school,
          revision: 0,
          updated_at: executionNow(),
        },
        "session",
        "create_from_plan",
        payload,
        capability,
        {
          plan_id: plan.id,
          plan_revision: plan.revision,
          series_id: series,
          local_date: date,
          coordinator_person_id: plan.coordinator_person_id,
          operator_person_id: day.operator_person_id,
        },
      );
      if (command.replay) return command.result;
      if (saved)
        this.obsolete(
          plan.id,
          body.command_id,
          body.expected_plan_revision,
          plan.revision,
        );
      const current = (
        await expandDiningDates(tx, school, date, date, { series })
      )[0];
      if (
        !current ||
        current.plan.id !== plan.id ||
        plan.revision !== body.expected_plan_revision
      ) {
        if (current && current.plan.id !== plan.id)
          this.superseded(
            body.command_id,
            plan,
            current.plan,
            body.expected_plan_revision,
          );
        this.obsolete(
          plan.id,
          body.command_id,
          body.expected_plan_revision,
          current?.plan.revision ?? plan.revision,
        );
      }
      const resolved = resolveDiningWallTime(plan, day, date);
      if (
        body.action === "open" &&
        (await this.cancelled(tx, school, series, date))
      )
        throw new BadRequestException(
          "This date was cancelled. Ask its coordinator to publish an explicit dated replacement.",
        );
      if (body.action === "open" && resolved.warning)
        throw new BadRequestException(
          "Resolve this date's clock-change hours before opening.",
        );
      if (
        ["publish_changes", "cancel"].includes(body.action) &&
        body.note.length < 3
      )
        throw new BadRequestException(
          "Give a short reason for this date's change.",
        );
      if (
        (!resolved.starts_at && !body.starts_at) ||
        (!resolved.ends_at && !body.ends_at)
      )
        throw new BadRequestException(
          "Choose explicit valid hours for this unresolved date.",
        );
      const window = await d.window(
        tx,
        school,
        body.starts_at ?? resolved.starts_at!,
        body.ends_at ?? resolved.ends_at!,
      );
      const local = (
        await sql<{
          date: string;
        }>`SELECT (${window.starts_at}::timestamptz AT TIME ZONE ${plan.timezone})::date::text AS date`.execute(
          tx,
        )
      ).rows[0]!.date;
      if (local !== date)
        throw new BadRequestException(
          "The changed hours must start on this plan date.",
        );
      if (
        body.action === "open" &&
        (+executionNow() < +window.starts_at ||
          +executionNow() >= +window.ends_at) &&
        body.note.length < 3
      )
        throw new BadRequestException(
          "Give a reason for opening outside the planned hours.",
        );
      const space = body.space_id === undefined ? day.space_id : body.space_id;
      await d.place(tx, school, space);
      await d.requirePerson(tx, school, plan.coordinator_person_id);
      const operator = await d.requirePerson(
        tx,
        school,
        day.operator_person_id,
      );
      if (plan.menu_mode === "reference" && body.menu_text)
        throw new BadRequestException(
          "This menu belongs to its external source.",
        );
      const at = executionNow(),
        row = await tx
          .insertInto("dining_sessions")
          .values({
            id,
            school_id: school,
            service_id: plan.service_id,
            service_revision: plan.service_revision,
            label: plan.label,
            coordinator_person_id: plan.coordinator_person_id,
            operator_person_id: day.operator_person_id,
            space_id: space,
            menu_mode: plan.menu_mode,
            operations_mode: plan.operations_mode,
            source_label: plan.source_label,
            source_url: plan.source_url,
            source_reference: plan.source_reference,
            source_observed_at: plan.source_observed_at,
            menu_text: body.menu_text ?? day.menu_text,
            ...window,
            state:
              body.action === "open"
                ? "open"
                : body.action === "cancel"
                  ? "cancelled"
                  : "published",
            published_at: at,
            revision: 1,
            count_total: 0,
            current_count_receipt_id: null,
            created_by_user_id: user.id,
            created_at: at,
            updated_at: at,
            weekly_plan_id: plan.id,
            weekly_series_id: series,
            weekly_date: date,
            weekly_exception: body.action !== "open",
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      await d.sessionReceipt(
        tx,
        user,
        actor.person_id,
        row,
        body.command_id,
        command.prepared.command_id,
        "created",
        body.note,
      );
      await d.model.finish(
        tx,
        user,
        row,
        "session",
        "created",
        command.prepared,
        capability,
        plan.operations_mode === "native" && row.state !== "cancelled"
          ? operator
          : null,
        [user.id, operator.user_id],
      );
      await this.projectSession(d, tx, user, row, true);
      return { id, kind: "session" as const, revision: 1 };
    });
  }
  private async collect(
    d: DiningService,
    tx: DiningTx,
    user: AuthUser,
    school: string,
    from: string,
    until: string,
    owned = false,
  ) {
    const actor = await d.access.campus(tx, user, school),
      schoolRow = await tx
        .selectFrom("schools")
        .select("timezone")
        .where("id", "=", school)
        .executeTakeFirstOrThrow();
    const zone = schoolRow.timezone,
      expanded = await expandDiningDates(
        tx,
        school,
        addDiningDays(from, -1),
        until,
        owned ? { ownedPerson: actor.person_id } : {},
      );
    const sessions = (
      await sql<Session>`SELECT * FROM dining_sessions WHERE school_id=${school}::uuid AND published_at IS NOT NULL AND starts_at<((${until}::date+1)::timestamp AT TIME ZONE ${zone}) AND ends_at>(${from}::date::timestamp AT TIME ZONE ${zone}) ${owned ? sql`AND (coordinator_person_id=${actor.person_id}::uuid OR operator_person_id=${actor.person_id}::uuid)` : sql``}`.execute(
        tx,
      )
    ).rows;
    // Suppress base dates even if the session was reassigned away from this owner.
    const overrides = await tx
      .selectFrom("dining_sessions")
      .select(["weekly_series_id", "weekly_date"])
      .where("school_id", "=", school)
      .where("weekly_date", ">=", addDiningDays(from, -1))
      .where("weekly_date", "<=", until)
      .where("weekly_series_id", "is not", null)
      .execute();
    const keys = new Set(
      overrides.map(
        (row) => `${row.weekly_series_id}:${diningDateValue(row.weekly_date)}`,
      ),
    );
    const cancellations = (
        await sql<{
          series_id: string;
          exception_date: string;
        }>`SELECT DISTINCT plan.series_id,receipt.exception_date::text FROM dining_weekly_receipts receipt JOIN dining_weekly_plans plan ON plan.school_id=receipt.school_id AND plan.id=receipt.plan_id WHERE receipt.school_id=${school}::uuid AND receipt.exception_date BETWEEN ${addDiningDays(from, -1)}::date AND ${until}::date`.execute(
          tx,
        )
      ).rows,
      cancelledKeys = new Set(
        cancellations.map((row) => `${row.series_id}:${row.exception_date}`),
      );
    const bounds = (
      await sql<{
        start: Date;
        end: Date;
      }>`SELECT (${from}::date::timestamp AT TIME ZONE ${zone}) AS start,((${until}::date+1)::timestamp AT TIME ZONE ${zone}) AS end`.execute(
        tx,
      )
    ).rows[0]!;
    const dates = expanded.filter(
      (row) =>
        !keys.has(`${row.plan.series_id}:${row.date}`) &&
        (row.warning
          ? row.date >= from
          : Date.parse(row.starts_at!) < +bounds.end &&
            Date.parse(row.ends_at!) > +bounds.start),
    );
    const refs = await d.refs(
        tx,
        school,
        [],
        [
          ...dates.map((date) => date.day.space_id),
          ...sessions.map((session) => session.space_id),
        ],
      ),
      serviceIds = [
        ...new Set([
          ...dates.map((date) => date.plan.service_id),
          ...sessions.map((s) => s.service_id),
        ]),
      ],
      services = serviceIds.length
        ? await tx
            .selectFrom("dining_services")
            .select(["id", "name"])
            .where("school_id", "=", school)
            .where("id", "in", serviceIds)
            .execute()
        : [],
      names = new Map(services.map((s) => [s.id, s.name]));
    const items: DiningAvailabilityItem[] = dates
      .filter(
        (date) =>
          !date.warning &&
          !cancelledKeys.has(`${date.plan.series_id}:${date.date}`),
      )
      .map(({ plan, day, date, starts_at, ends_at }) => ({
        id: diningDateId(school, plan.series_id, date),
        service_id: plan.service_id,
        service_name: names.get(plan.service_id) ?? "Dining",
        source_kind: "plan_date",
        source_id: plan.id,
        source_revision: plan.revision,
        session_id: null,
        plan_id: plan.series_id,
        local_date: date,
        label: plan.label,
        menu_text: day.menu_text,
        starts_at: starts_at!,
        ends_at: ends_at!,
        timezone: plan.timezone,
        space_id: day.space_id,
        space_label: refs.space(day.space_id)?.label ?? null,
        state: "planned",
        changed_for_date: false,
        updated_at: plan.updated_at.toISOString(),
        href: diningDateHref(plan.series_id, date),
        availability_only: true,
        venue_reserved: false,
      }));
    for (const session of sessions) {
      const local = (
        await sql<{
          date: string;
        }>`SELECT (${session.starts_at}::timestamptz AT TIME ZONE ${zone})::date::text AS date`.execute(
          tx,
        )
      ).rows[0]!.date;
      items.push({
        id: session.id,
        service_id: session.service_id,
        service_name: names.get(session.service_id) ?? "Dining",
        source_kind: "session",
        source_id: session.id,
        source_revision: session.revision,
        session_id: session.id,
        plan_id: session.weekly_series_id,
        local_date: diningDateValue(session.weekly_date) ?? local,
        label: session.label,
        menu_text: session.menu_text,
        starts_at: session.starts_at.toISOString(),
        ends_at: session.ends_at.toISOString(),
        timezone: zone,
        space_id: session.space_id,
        space_label: refs.space(session.space_id)?.label ?? null,
        state: session.state as DiningAvailabilityItem["state"],
        changed_for_date: session.weekly_exception,
        updated_at: session.updated_at.toISOString(),
        href: diningHref(session.id),
        availability_only: true,
        venue_reserved: false,
      });
    }
    items.sort(
      (a, b) =>
        a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id),
    );
    return {
      items,
      warnings: dates.flatMap((row) =>
        cancelledKeys.has(`${row.plan.series_id}:${row.date}`)
          ? [
              {
                plan_id: row.plan.series_id,
                plan_version_id: row.plan.id,
                local_date: row.date,
                weekday: row.day.weekday,
                reason: "cancelled_for_date" as const,
                href: diningDateHref(row.plan.series_id, row.date),
              },
            ]
          : row.warning
            ? [row.warning]
            : [],
      ),
      timezone: zone,
    };
  }
  async availability(
    d: DiningService,
    user: AuthUser,
    school: string,
    raw: unknown,
  ): Promise<DiningAvailabilityPage> {
    const q = diningRangeInput.parse(raw);
    validateDiningRange(q.from, q.until);
    return this.db.transaction().execute(async (tx) => {
      const result = await this.collect(d, tx, user, school, q.from, q.until);
      return {
        ...result,
        items: result.items.slice((q.page - 1) * 20, q.page * 20),
        total: result.items.length,
        total_pages: Math.ceil(result.items.length / 20),
        page: q.page,
        page_size: 20,
        from: q.from,
        until: q.until,
      };
    });
  }
  async ownedAvailability(
    d: DiningService,
    user: AuthUser,
    school: string,
    raw: unknown,
  ) {
    const q = diningRangeInput.parse(raw);
    validateDiningRange(q.from, q.until);
    try {
      return await this.db.transaction().execute(async (tx) => {
        const result = await this.collect(
          d,
          tx,
          user,
          school,
          q.from,
          q.until,
          true,
        );
        return { items: result.items, warnings: result.warnings };
      });
    } catch (error) {
      if (error instanceof ForbiddenException)
        return { items: [], warnings: [] };
      throw error;
    }
  }
  private async temporalOccurrence(
    d: DiningService,
    tx: DiningTx,
    plan: WeeklyPlan,
    date: ExpandedDiningDate,
    state: "expected" | "cancelled",
  ): Promise<PlanOccurrenceProjection["occurrences"][number]> {
    const space = date.day.space_id
        ? await d.place(tx, plan.school_id, date.day.space_id, false)
        : null,
      context = space
        ? {
            kind: "space",
            domain: "campus_topology",
            domain_id: space.id,
            label: space.name,
            lifecycle_state:
              space.status === "active"
                ? ("active" as const)
                : ("inactive" as const),
            source_revision: space.revision,
            metadata: { space_kind: space.kind },
          }
        : null;
    return {
      occurrence_key: `dining:${plan.series_id}:${date.date}`,
      occurrence: {
        kind: "dining_date",
        domain: "dining",
        domain_id: `weekly:${plan.series_id}:${date.date}`,
        label: "Dining availability",
        lifecycle_state: "active" as const,
        source_revision: plan.revision,
        metadata: {},
      },
      local_date: date.date,
      starts_at: date.starts_at!,
      ends_at: date.ends_at!,
      time_zone: plan.timezone,
      claim_kind: "availability" as const,
      context,
      resources: context ? [context] : [],
      participants: [],
      state,
    };
  }
  private async project(
    d: DiningService,
    tx: DiningTx,
    user: AuthUser,
    row: WeeklyPlan,
    action: "published" | "stopped",
    causationEvent: string | null = null,
  ) {
    row = normalizeWeeklyPlan(row);
    const retained = row.projection_receipt as {
        from?: string;
        until?: string;
        event_id?: string;
        publication_event_id?: string;
        publication_revision?: number;
      } | null,
      today = await this.today(tx, row.timezone),
      from =
        action === "stopped"
          ? (retained?.from ?? row.starts_on)
          : row.starts_on > today
            ? row.starts_on
            : today,
      until =
        action === "stopped"
          ? (retained?.until ?? addDiningDays(from, 34))
          : addDiningDays(from, 34);
    const projectionPlan =
      action === "stopped" ? { ...row, stop_from: null } : row;
    const dates = await expandDiningDates(tx, row.school_id, from, until, {
        plan: projectionPlan,
      }),
      saved = await tx
        .selectFrom("dining_sessions")
        .select(["weekly_date"])
        .where("school_id", "=", row.school_id)
        .where("weekly_series_id", "=", row.series_id)
        .where("weekly_date", ">=", from)
        .where("weekly_date", "<=", until)
        .execute(),
      exceptions = new Set(saved.map((s) => diningDateValue(s.weekly_date)));
    const occurrences: PlanOccurrenceProjection["occurrences"] = [];
    for (const date of dates) {
      if (
        date.warning ||
        exceptions.has(date.date) ||
        (action === "stopped" && date.date < row.stop_from!)
      )
        continue;
      occurrences.push(
        await this.temporalOccurrence(
          d,
          tx,
          row,
          date,
          action === "stopped" ? "cancelled" : "expected",
        ),
      );
    }
    const previous = row.replaces_plan_id
      ? await this.row(tx, row.school_id, row.replaces_plan_id)
      : null;
    const priorProjection = previous?.projection_receipt as
      | {
          from?: string;
          until?: string;
          publication_revision?: number;
          projection_revision?: number;
        }
      | undefined;
    if (
      action === "published" &&
      previous &&
      priorProjection?.from &&
      priorProjection.until
    ) {
      const existingKeys = new Set(
        occurrences.map((occurrence) => occurrence.occurrence_key),
      );
      for (const oldDate of await expandDiningDates(
        tx,
        row.school_id,
        priorProjection.from,
        priorProjection.until,
        { plan: { ...previous, stop_from: null } },
      )) {
        if (
          oldDate.date < row.starts_on ||
          oldDate.warning ||
          exceptions.has(oldDate.date) ||
          existingKeys.has(`dining:${row.series_id}:${oldDate.date}`)
        )
          continue;
        occurrences.push(
          await this.temporalOccurrence(d, tx, row, oldDate, "cancelled"),
        );
      }
    }
    const groups = new Map<number, PlanOccurrenceProjection["occurrences"]>();
    for (const occurrence of occurrences) {
      const revision =
        action === "published" && previous
          ? ((previous.stop_from && occurrence.local_date >= previous.stop_from
              ? priorProjection?.projection_revision
              : priorProjection?.publication_revision) ??
            row.replaces_revision!)
          : 0;
      const group = groups.get(revision) ?? [];
      group.push(occurrence);
      groups.set(revision, group);
    }
    if (!groups.size)
      groups.set(
        action === "published" && previous
          ? (priorProjection?.publication_revision ?? row.replaces_revision!)
          : 0,
        [],
      );
    let publicationEvent: string | null = null;
    for (const [previousRevision, group] of groups) {
      const starts = group.map((item) => Date.parse(item.starts_at)),
        ends = group.map((item) => Date.parse(item.ends_at));
      const receipt = await this.temporal.recordPlanOccurrences(tx, {
        school_id: row.school_id,
        actor_user_id: user.id,
        plan: {
          kind: "dining_plan",
          domain: "dining",
          domain_id: row.id,
          label: "Dining availability",
          lifecycle_state: "active",
          source_revision: row.revision,
          metadata: {},
        },
        source_revision: row.revision,
        event_type: `dining.weekly.${action}`,
        occurred_at: row.updated_at.toISOString(),
        correlation_id: row.id,
        causation_event_id: causationEvent,
        horizon: {
          from: starts.length
            ? new Date(Math.min(...starts)).toISOString()
            : `${addDiningDays(from, -1)}T00:00:00.000Z`,
          until: ends.length
            ? new Date(Math.max(...ends) + 1).toISOString()
            : `${addDiningDays(until, 2)}T00:00:00.000Z`,
        },
        ...(row.replaces_plan_id && action === "published"
          ? {
              supersedes_plan: {
                domain: "dining",
                domain_id: row.replaces_plan_id,
                source_revision: previousRevision,
              },
            }
          : {}),
        occurrences: group,
      });
      publicationEvent ??= receipt.event_id;
    }
    await tx
      .updateTable("dining_weekly_plans")
      .set({
        projection_receipt: {
          event_id: publicationEvent,
          projection_revision: row.revision,
          from,
          until,
          publication_event_id:
            action === "published"
              ? publicationEvent
              : retained?.publication_event_id,
          publication_revision:
            action === "published"
              ? row.revision
              : retained?.publication_revision,
        },
      })
      .where("school_id", "=", row.school_id)
      .where("id", "=", row.id)
      .execute();
  }
  async projectSession(
    d: DiningService,
    tx: DiningTx,
    user: AuthUser,
    row: Session,
    initial = false,
  ) {
    row = { ...row, weekly_date: diningDateValue(row.weekly_date) };
    if (!row.weekly_plan_id || !row.weekly_date) return;
    const plan = await this.row(tx, row.school_id, row.weekly_plan_id),
      day = (await this.days(tx, plan)).find(
        (day) =>
          day.weekday ===
          (new Date(`${row.weekly_date}T12:00:00Z`).getUTCDay() || 7),
      )!;
    const date = {
      plan,
      day: { ...day, space_id: row.space_id },
      date: row.weekly_date,
      starts_at: row.starts_at.toISOString(),
      ends_at: row.ends_at.toISOString(),
      warning: null,
    };
    const occurrence = await this.temporalOccurrence(
      d,
      tx,
      plan,
      date,
      row.state === "cancelled" ? "cancelled" : "expected",
    );
    occurrence.occurrence.source_revision = row.revision;
    occurrence.occurrence.kind = "dining_session";
    occurrence.occurrence.domain_id = row.id;
    const current = await d.sessionRow(tx, row.school_id, row.id);
    await this.temporal.recordPlanOccurrences(tx, {
      school_id: row.school_id,
      actor_user_id: user.id,
      plan: {
        kind: "dining_session",
        domain: "dining",
        domain_id: row.id,
        label: "Dining availability",
        lifecycle_state: "active",
        source_revision: row.revision,
        metadata: {},
      },
      source_revision: row.revision,
      event_type: "dining.date.published",
      occurred_at: row.updated_at.toISOString(),
      correlation_id: row.id,
      causation_event_id:
        (current.coordination_receipt as { event_id?: string })?.event_id ??
        null,
      horizon: {
        from: row.starts_at.toISOString(),
        until: new Date(+row.ends_at + 1).toISOString(),
      },
      ...(initial
        ? {
            supersedes_plan: {
              domain: "dining",
              domain_id: plan.id,
              source_revision:
                (plan.projection_receipt as { publication_revision?: number })
                  ?.publication_revision ?? plan.revision,
            },
          }
        : {}),
      occurrences: [occurrence],
    });
  }
}
