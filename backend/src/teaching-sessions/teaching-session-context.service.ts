import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import { executionEnvironmentStorage, executionNow } from "../campus-model-core/execution-time.runtime.js";
import { HUMAN_AGENT_IDENTITY_PORT, type HumanAgentIdentityPort } from "../campus-model-core/human-agent-identity.port.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { sessionDate, sessionHash, sessionUuid, teachingSessionHref, teachingSessionId } from "./teaching-session.contracts.js";

export type SessionDb = DatabaseService | Transaction<Database>;
export interface TeachingSource {
  id: string; school_id: string; logical_key: string; source_kind: "academic" | "activity"; date: string; title: string;
  group_label: string; starts_at: string; ends_at: string; timezone: string; place_label: string;
  class_section_id: string | null; term_id: string | null; subject_id: string | null; period_number: number | null;
  occurrence_id: string | null; scheduled_teacher_id: string | null; original_teacher_id: string | null;
  teacher_name: string | null; original_teacher_name: string | null; lead_person_id: string | null;
  is_cover: boolean; state: "expected" | "cancelled"; source_evidence: Record<string, unknown>; source_fingerprint: string;
}
export interface TeachingAccess { source: TeachingSource; person_id: string; can_manage: boolean; can_read_preparation: boolean;
  participant: boolean; grants: Array<{ source_id: string; revision: number; context_kind: string; subject_id: string | null }> }
const instant = (value: Date | string) => new Date(value).toISOString();

@Injectable()
export class TeachingSessionContextService {
  constructor(private readonly db: DatabaseService, @Inject(HUMAN_AGENT_IDENTITY_PORT) private readonly identity: HumanAgentIdentityPort,
    private readonly planning: ActivityPlanningService) {}

  async account(db: SessionDb, user: AuthUser) {
    if (!user.is_active || !user.active_school_id) throw new ForbiddenException("Choose an active campus account.");
    const school = await db.selectFrom("schools").innerJoin("school_memberships as membership", "membership.school_id", "schools.id")
      .innerJoin("users as account", "account.id", "membership.user_id").select(["schools.id", "schools.timezone"])
      .where("schools.id", "=", user.active_school_id).where("membership.user_id", "=", user.id).where("membership.is_active", "=", true)
      .where("account.is_active", "=", true).executeTakeFirst();
    if (!school) throw new ForbiddenException("Your campus access is no longer active.");
    const selected = executionEnvironmentStorage.getStore();
    if (selected && selected.institution_id !== school.id) throw new ForbiddenException("The selected world does not match this campus.");
    const actor = await this.identity.resolveAccountEndpoint(db as Transaction<Database>, { school_id: school.id, user_id: user.id, at: executionNow().toISOString() });
    if (!actor.acting) throw new ForbiddenException("Your campus person/account link is unavailable.");
    return { ...school, actor, today: new Intl.DateTimeFormat("en-CA", { timeZone: school.timezone }).format(executionNow()) };
  }

  async sources(db: SessionDb, user: AuthUser, dateValue: string) {
    const date = sessionDate.parse(dateValue), school = await this.account(db, user);
    const rows = (await sql<{
      id: string; occurrence_key: string; class_section_id: string; term_id: string; subject_id: string | null; period_number: number;
      title: string; group_label: string; starts_at: Date; ends_at: Date; room: string; teacher_user_id: string | null;
      original_teacher_id: string | null; teacher_name: string | null; original_teacher_name: string | null; cancelled: boolean;
      source_kind: string; source_record_id: string; source_revision: number; source_version: number | null; coverage_status: string;
      coverage_record_id: string | null; space_id: string | null;
    }>`SELECT effective.id,effective.occurrence_key,effective.class_section_id,effective.term_id,effective.subject_id,effective.period_number,
      effective.title,concat('Class ',section.grade,section.section) AS group_label,
      ((${date}::date+effective.starts_at) AT TIME ZONE school.timezone) AS starts_at,
      ((${date}::date+effective.ends_at) AT TIME ZONE school.timezone) AS ends_at,
      COALESCE(space.name,NULLIF(effective.room,''),'') AS room,effective.teacher_user_id,
      COALESCE(retained.original_teacher_id,effective.original_teacher_user_id,planned.teacher_user_id) AS original_teacher_id,
      NULLIF(concat_ws(' ',teacher.first_name,teacher.last_name),'') AS teacher_name,
      NULLIF(concat_ws(' ',original_teacher.first_name,original_teacher.last_name),'') AS original_teacher_name,
      effective.cancelled,effective.source_kind,effective.source_record_id,effective.source_revision,effective.source_version,
      effective.coverage_status,effective.coverage_record_id,effective.space_id
      FROM effective_school_schedule_v4(${school.id}::uuid,${date}::date) effective
      JOIN schools school ON school.id=${school.id}::uuid JOIN class_sections section ON section.id=effective.class_section_id AND section.school_id=school.id
      LEFT JOIN planned_school_schedule_v2(${school.id}::uuid,${date}::date) planned ON planned.occurrence_key=effective.occurrence_key
      LEFT JOIN teaching_sessions retained ON retained.school_id=school.id AND retained.source_kind='academic'
        AND retained.logical_key=effective.occurrence_key AND retained.session_date=${date}::date
      LEFT JOIN users teacher ON teacher.id=effective.teacher_user_id
      LEFT JOIN users original_teacher ON original_teacher.id=COALESCE(retained.original_teacher_id,effective.original_teacher_user_id,planned.teacher_user_id)
      LEFT JOIN campus_spaces space ON space.id=effective.space_id AND space.school_id=school.id
      WHERE effective.slot_type='class'
      ORDER BY effective.starts_at,effective.class_section_id,effective.period_number`.execute(db)).rows;
    const sources: TeachingSource[] = rows.map(row => {
      const evidence = { source_kind: row.source_kind, source_record_id: row.source_record_id, source_revision: row.source_revision,
        source_version: row.source_version, schedule_id: row.id, occurrence_key: row.occurrence_key, class_section_id: row.class_section_id,
        term_id: row.term_id, subject_id: row.subject_id, teacher_user_id: row.teacher_user_id, original_teacher_id: row.original_teacher_id,
        coverage_status: row.coverage_status, coverage_record_id: row.coverage_record_id, space_id: row.space_id,
        starts_at: instant(row.starts_at), ends_at: instant(row.ends_at), room: row.room, cancelled: row.cancelled };
      return { id: teachingSessionId(school.id,"academic",row.occurrence_key,date), school_id: school.id, logical_key: row.occurrence_key,
        source_kind: "academic", date, title: row.title, group_label: row.group_label, starts_at: instant(row.starts_at), ends_at: instant(row.ends_at),
        timezone: school.timezone, place_label: row.room, class_section_id: row.class_section_id, term_id: row.term_id, subject_id: row.subject_id,
        period_number: row.period_number, occurrence_id: null, scheduled_teacher_id: row.teacher_user_id, original_teacher_id: row.original_teacher_id,
        teacher_name: row.teacher_name, original_teacher_name: row.original_teacher_name, lead_person_id: null,
        is_cover: row.coverage_status === "accepted" && row.teacher_user_id !== row.original_teacher_id,
        state: row.cancelled ? "cancelled" : "expected", source_evidence: evidence, source_fingerprint: sessionHash(evidence) };
    });
    // Scheduling remains the sole occurrence materializer. Historical activity
    // versions retain their own IDs and are never moved to replacement plans.
    const native = await this.planning.ensureOccurrences(school.id, date, date, db === this.db ? undefined : db);
    for (const occurrence of native.filter(item => item.source === "activity" && item.purpose === "teaching" && item.local_date === date)) {
      const lead = occurrence.participants.find(item => item.participation_role === "lead");
      const evidence = { occurrence_id: occurrence.id, plan_version_id: occurrence.plan_version_id, source_ref: occurrence.source_ref,
        class_section_id: occurrence.context_ref,term_id:occurrence.term_id,subject_id:occurrence.subject_id,
        source_revision: occurrence.source_revision, revision: occurrence.revision, starts_at: occurrence.starts_at, ends_at: occurrence.ends_at,
        state: occurrence.state, space_id: occurrence.space_id, lead_person_id: lead?.person_id ?? null,
        roster: occurrence.participants.map(person => ({ person_id: person.person_id, source_ref: person.source_ref, source_revision: person.source_revision })) };
      sources.push({ id: teachingSessionId(school.id,"activity",occurrence.id,date), school_id: school.id, logical_key: occurrence.id,
        source_kind: "activity", date, title: occurrence.title, group_label: "Teaching activity", starts_at: occurrence.starts_at, ends_at: occurrence.ends_at,
        timezone: occurrence.timezone, place_label: occurrence.space_label || occurrence.location_label || "", class_section_id: occurrence.context_ref,
        term_id: occurrence.term_id, subject_id: occurrence.subject_id, period_number: occurrence.period_number, occurrence_id: occurrence.id,
        scheduled_teacher_id: occurrence.scheduled_teacher_id, original_teacher_id: occurrence.scheduled_teacher_id,
        teacher_name: lead?.label ?? null, original_teacher_name: lead?.label ?? null, lead_person_id: lead?.person_id ?? null,
        is_cover: false, state: occurrence.state, source_evidence: evidence, source_fingerprint: sessionHash(evidence) });
    }
    return { school, sources: sources.sort((a,b) => a.starts_at.localeCompare(b.starts_at) || a.id.localeCompare(b.id)) };
  }

  async access(db: SessionDb, user: AuthUser, source: TeachingSource, writing = false): Promise<TeachingAccess> {
    const school = await this.account(db,user);
    if (school.id !== source.school_id) throw new ForbiddenException("This session belongs to another campus.");
    const grants = (await sql<{ source_id: string; revision: number; context_kind: string; subject_id: string | null }>`SELECT binding.source_id,binding.revision,binding.context_kind,binding.subject_id
      FROM staff_role_bindings binding JOIN staff_profiles profile ON profile.school_id=binding.school_id AND profile.user_id=binding.user_id
        AND profile.status='active' AND profile.person_id=${school.actor.person_id}::uuid
      WHERE binding.school_id=${school.id}::uuid AND binding.user_id=${user.id}::uuid
        AND binding.status='active' AND binding.role_active AND 'learning.sessions.manage'=ANY(binding.permissions)
        AND binding.starts_on<=${school.today}::date AND(binding.ends_on IS NULL OR binding.ends_on>=${school.today}::date)
        AND ((binding.context_kind='institution' AND binding.scope_id=${school.id}::uuid)
          OR (binding.context_kind='class' AND binding.scope_id=${source.class_section_id}::uuid
            AND(binding.subject_id IS NULL OR binding.subject_id=${source.subject_id}::uuid)))
      ORDER BY binding.source_id`.execute(db)).rows;
    const scheduled = source.source_kind === "activity" ? source.lead_person_id === school.actor.person_id
      : source.scheduled_teacher_id === user.id && ["accepted","not_required"].includes(String(source.source_evidence.coverage_status));
    const original = source.source_kind === "academic" && source.original_teacher_id === user.id
      && (["accepted","not_required"].includes(String(source.source_evidence.coverage_status)) || source.original_teacher_id !== source.scheduled_teacher_id);
    const instructor = grants.length > 0 && (scheduled || original);
    const participant = source.source_kind === "activity"
      ? Boolean((await sql`SELECT 1 FROM schedule_activity_occurrence_people WHERE school_id=${school.id}::uuid AND occurrence_id=${source.occurrence_id}::uuid
          AND person_id=${school.actor.person_id}::uuid AND (participation_role='participant' OR attendance_expected) LIMIT 1`.execute(db)).rows[0])
      : Boolean((await sql`SELECT 1 FROM enrollments enrollment JOIN students student ON student.id=enrollment.student_id AND student.school_id=${school.id}::uuid
          WHERE enrollment.class_section_id=${source.class_section_id}::uuid AND enrollment.term_id=${source.term_id}::uuid
            AND student.person_id=${school.actor.person_id}::uuid AND enrollment.is_active
            AND enrollment.enrolled_on<=${source.date}::date AND(enrollment.inactive_from IS NULL OR enrollment.inactive_from>${source.date}::date)
            AND enrollment.enrolled_on<=${school.today}::date AND(enrollment.inactive_from IS NULL OR enrollment.inactive_from>${school.today}::date) LIMIT 1`.execute(db)).rows[0]);
    if (!instructor && !participant) throw new ForbiddenException("This teaching session is outside your current responsibility or participation.");
    if (writing && !(grants.length > 0 && scheduled)) throw new ForbiddenException("Current teaching responsibility and the explicit lesson permission are both required.");
    return { source, person_id: school.actor.person_id, can_manage: grants.length > 0 && scheduled && source.state === "expected",
      can_read_preparation: instructor, participant, grants };
  }

  async resolve(db: SessionDb, user: AuthUser, idValue: string, date: string, writing = false) {
    const id = sessionUuid.parse(idValue), all = await this.sources(db,user,date), source = all.sources.find(item => item.id === id);
    if (!source) throw new NotFoundException("This dated teaching session is no longer available. Open the current timetable.");
    return this.access(db,user,source,writing);
  }

  resolveForTransaction(db: Transaction<Database>, user: AuthUser, id: string, date: string, writing = false) {
    return this.resolve(db,user,id,date,writing);
  }

  private async selected(user: AuthUser, date: string, selector: { occurrence_id?: string; class_section_id?: string; period_number?: string }) {
    const native = Boolean(selector.occurrence_id), academic = Boolean(selector.class_section_id || selector.period_number);
    if (native === academic || academic && (!selector.class_section_id || !selector.period_number)) throw new BadRequestException("Choose one exact session source.");
    if (native) sessionUuid.parse(selector.occurrence_id); else sessionUuid.parse(selector.class_section_id);
    const period = Number(selector.period_number);
    if (academic && (!Number.isInteger(period) || period < 1 || period > 24)) throw new BadRequestException("Choose the exact scheduled period.");
    const all = await this.sources(this.db,user,date), source = all.sources.find(item => native ? item.occurrence_id === selector.occurrence_id
      : item.source_kind === "academic" && item.class_section_id === selector.class_section_id && item.period_number === period);
    if (!source) throw new NotFoundException("The selected teaching session is unavailable.");
    await this.access(this.db,user,source); return source;
  }

  async open(user: AuthUser, date: string, selector: { occurrence_id?: string; class_section_id?: string; period_number?: string }) {
    const source = await this.selected(user, date, selector);
    return { id: source.id, date: source.date, href: teachingSessionHref(source.id,source.date) };
  }

  /** Navigation may retain cancelled history; an upcoming destination may not. */
  async openExpected(user: AuthUser, date: string, selector: { occurrence_id?: string; class_section_id?: string; period_number?: string }) {
    const source = await this.selected(user, date, selector);
    if (source.state !== "expected") throw new NotFoundException("This session is no longer scheduled. Open the current timetable.");
    const record = source.source_evidence.source_record_id ?? source.source_evidence.plan_version_id;
    const revision = source.source_evidence.source_revision;
    if (typeof record !== "string" || !record || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
      throw new NotFoundException("This scheduled source is unavailable. Open the current timetable.");
    }
    return { id: source.id, date: source.date, href: teachingSessionHref(source.id,source.date),
      space_id: typeof source.source_evidence.space_id === "string" ? source.source_evidence.space_id : null,
      place_label: source.place_label || null, starts_at: source.starts_at, ends_at: source.ends_at,
      source_record_id: record, source_revision: revision };
  }
}
