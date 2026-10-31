import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ConflictException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { institutionSchoolPermission } from "../roles/authorization.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { executionNow, executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
import { activityOccurrenceId } from "../schedule-planning/activity-occurrence.engine.js";
import { campusDateRangeInput, cancelCampusDateInput, correctCampusDateInput, publishCampusDateInput, type CampusDateDto } from "./campus-dates.contracts.js";
import { CampusDatesModel } from "./campus-dates.model.js";
import type { CampusDateTable } from "./campus-dates.tables.js";
type Tx = Transaction<Database>;
type Row = Omit<CampusDateTable, "provenance" | "created_at" | "updated_at"> & { provenance: CampusDateDto["provenance"]; created_at: Date; updated_at: Date };
function dto(row: Row): CampusDateDto { return { id: row.id, school_id: row.school_id, title: row.title, description: row.description, starts_on: row.starts_on, ends_on: row.ends_on,
  category_label: row.category_label, academic_term_id: row.academic_term_id, provenance: row.provenance, state: row.state, revision: row.revision,
  cancellation_reason: row.cancellation_reason, updated_at: new Date(row.updated_at).toISOString() }; }
@Injectable()
export class CampusDatesService {
  constructor(private readonly db: DatabaseService, private readonly model: CampusDatesModel,
    @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identities: HumanAgentIdentityPort) {}
  private async member(tx: Tx, user: AuthUser, school: string, lock = false) {
    z.uuid().parse(school); const world = executionEnvironmentStorage.getStore();
    if (!user.is_active || user.active_school_id !== school || world?.institution_id && world.institution_id !== school)
      throw new ForbiddenException("Choose this institution and its current world.");
    const member = (await sql<{ id: string }>`SELECT membership.id FROM school_memberships membership JOIN users account ON account.id=membership.user_id
      WHERE membership.school_id=${school}::uuid AND membership.user_id=${user.id}::uuid AND membership.is_active AND account.is_active
      LIMIT 1 ${lock ? sql`FOR SHARE OF membership,account` : sql``}`.execute(tx)).rows[0];
    if (!member) throw new ForbiddenException("Current institution membership is required.");
  }
  private async manages(tx: Tx, user: AuthUser, school: string) {
    try { await institutionSchoolPermission(tx, user, school, "calendar.manage"); return true; }
    catch (error) { if (error instanceof ForbiddenException) return false; throw error; }
  }
  async list(user: AuthUser, school: string, query: unknown) {
    const input = campusDateRangeInput.parse(query), pageSize = 100;
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async tx => {
      await this.member(tx, user, school);
      const base = tx.selectFrom("campus_dates").where("school_id", "=", school).where("starts_on", "<=", input.until).where("ends_on", ">=", input.from);
      const count = await base.select(eb => eb.fn.countAll<string>().as("count")).executeTakeFirstOrThrow(), total = Number(count.count);
      const items = await base.selectAll().orderBy("starts_on").orderBy("id").limit(pageSize).offset((input.page - 1) * pageSize).execute();
      return { items: items.map(dto), page: input.page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)),
        from: input.from, until: input.until, can_manage: await this.manages(tx, user, school) };
    });
  }
  async detail(user: AuthUser, school: string, id: string) {
    z.uuid().parse(id);
    return this.db.transaction().execute(async tx => { await this.member(tx, user, school); const row = await tx.selectFrom("campus_dates").selectAll().where("school_id", "=", school).where("id", "=", id).executeTakeFirst();
      if (!row) throw new NotFoundException("Campus date not found."); return { item: dto(row), can_manage: await this.manages(tx, user, school) }; });
  }
  async publish(user: AuthUser, school: string, body: unknown) { const input = publishCampusDateInput.parse(body); return this.change(user, school, "published", activityOccurrenceId(school, "campus_date", user.id, input.idempotency_key), input); }
  async correct(user: AuthUser, school: string, id: string, body: unknown) { return this.change(user, school, "corrected", z.uuid().parse(id), correctCampusDateInput.parse(body)); }
  async cancel(user: AuthUser, school: string, id: string, body: unknown) { return this.change(user, school, "cancelled", z.uuid().parse(id), cancelCampusDateInput.parse(body)); }
  private async change(user: AuthUser, school: string, action: "published" | "corrected" | "cancelled", id: string,
    input: z.infer<typeof publishCampusDateInput> | z.infer<typeof correctCampusDateInput> | z.infer<typeof cancelCampusDateInput>) {
    return this.db.transaction().execute(async tx => {
      await this.member(tx, user, school, true);
      const authority = await institutionSchoolPermission(tx, user, school, "calendar.manage", true);
      const actor = await this.identities.resolveAccountEndpoint(tx, { school_id: school, user_id: user.id, at: executionNow().toISOString() });
      if (!actor.acting) throw new ForbiddenException("Current linked campus-person access is required to publish dates.");
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`campus-date:${school}:${user.id}:${input.idempotency_key}`},0))`.execute(tx);
      const current = await tx.selectFrom("campus_dates").selectAll().where("school_id", "=", school).where("id", "=", id).forUpdate().executeTakeFirst();
      if (!current && action !== "published") throw new NotFoundException("Campus date not found.");
      const command = await this.model.prepare(tx, user, school, id, current?.revision ?? 0, action, input, { sources: authority.sources });
      if (command.replay) return command.result;
      if (current?.state === "cancelled") throw new ConflictException("This date was cancelled. Publish a reviewed replacement instead.");
      const at = executionNow().toISOString(), reason = "reason" in input ? input.reason : "Published informational campus date";
      let saved: Row;
      if (action === "cancelled") saved = await tx.updateTable("campus_dates").set({ state: "cancelled", cancellation_reason: reason, revision: current!.revision + 1, updated_by: user.id, updated_at: at }).where("school_id", "=", school).where("id", "=", id).returningAll().executeTakeFirstOrThrow();
      else {
        if (!("title" in input)) throw new BadRequestException("Campus date details are required.");
        if (input.academic_term_id && !await tx.selectFrom("academic_terms").select("id").where("school_id", "=", school).where("id", "=", input.academic_term_id).executeTakeFirst())
          throw new BadRequestException("Choose an academic period in this institution.");
        const values = { title: input.title, description: input.description, starts_on: input.starts_on, ends_on: input.ends_on, category_label: input.category_label,
          academic_term_id: input.academic_term_id === undefined ? current?.academic_term_id ?? null : input.academic_term_id,
          provenance: input.provenance === undefined ? current?.provenance ?? null : input.provenance, updated_by: user.id, updated_at: at };
        saved = current ? await tx.updateTable("campus_dates").set({ ...values, revision: current.revision + 1 }).where("school_id", "=", school).where("id", "=", id).returningAll().executeTakeFirstOrThrow()
          : await tx.insertInto("campus_dates").values({ ...values, id, school_id: school, state: "published", revision: 1, cancellation_reason: null, created_by: user.id, created_at: at }).returningAll().executeTakeFirstOrThrow();
      }
      const item = dto(saved);
      await tx.insertInto("campus_date_revisions").values({ school_id: school, date_id: id, revision: item.revision, action, command_id: command.prepared.command_id,
        actor_person_id: actor.person_id, actor_user_id: user.id, reason, snapshot: item, recorded_at: at }).execute();
      await tx.insertInto("audit_events").values({ action: `campus_date.${action}`, actor_id: user.id, school_id: school, target_type: "campus_date", target_id: id,
        request_id: input.idempotency_key, ip_hash: null, metadata: { revision: item.revision, command_id: command.prepared.command_id } }).execute();
      await this.model.finish(tx, user, item, action, command.prepared);
      return item;
    });
  }
}
