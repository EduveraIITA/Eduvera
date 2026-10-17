import {
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  Optional,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
  ServiceUnavailableException,
} from "@nestjs/common";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { Client as PgClient } from "pg";
import { sql, type Kysely, type Transaction } from "kysely";
import type { AuthenticatedRequest, AuthUser } from "../common/request.js";
import { config } from "../config.js";
import { DatabaseService } from "../database/database.service.js";
import { postgresClientConnectionConfig } from "../database/connection-policy.js";
import type { Database } from "../database/types.js";
import { CAMPUS_MODEL_CORE_PORT, type CampusModelCorePort } from "../campus-model-core/campus-model-core.port.js";
import { COORDINATION_RUNTIME_PORT, type CoordinationRuntimePort } from "../campus-model-core/coordination-runtime.port.js";

type Db = Kysely<Database> | Transaction<Database>;

const BROKER_CHANNEL = "omnischool_school_events_v1";
const SSE_CURSOR_VERSION = "v2";
const HEARTBEAT_MS = 20_000;
const CLEANUP_MS = 60_000;
const OVERDUE_REGISTER_CHECK_MS = 60_000;
const MAX_EVENT_ATTEMPTS = 10;

interface EventEnvelope {
  id: string;
  sequence: number | string;
  school_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  audience_user_ids: string[];
  payload: unknown;
  created_at: Date | string;
}

interface ReplayRow {
  replay_floor: string;
  published_max: string;
  id: string | null;
  sequence: string | number | null;
  school_id: string | null;
  event_type: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  audience_user_ids: string[] | null;
  payload: unknown;
  created_at: Date | string | null;
}

interface BrokerDrainRow {
  published_max: string;
  id: string | null;
  sequence: string | number | null;
  school_id: string | null;
  event_type: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  audience_user_ids: string[] | null;
  payload: unknown;
  created_at: Date | string | null;
}

interface StreamClient {
  id: string;
  userId: string;
  sessionHash: string;
  reply: FastifyReply;
  lastSequence: number | null;
  replaying: boolean;
  replayOverflow: boolean;
  pendingEvents: Map<number, EventEnvelope>;
  closed: boolean;
}

export interface AttendanceEventRecord {
  id?: string;
  student_id: string;
  status: "present" | "absent" | "late" | "excused" | "half_day";
  remarks?: string;
  previous_status?: "present" | "absent" | "late" | "excused" | "half_day" | null;
  revision?: number;
}

interface AttendanceEventInput {
  schoolId: string;
  classSectionId: string;
  termId: string;
  date: string;
  sessionId?: string;
  requestId: string;
  records: AttendanceEventRecord[];
  suppressNotifications?: boolean;
}

export interface AttendanceEventReceipt {
  studentEventIds: Map<string, string>;
  classEventId: string | null;
}

interface RegisterEventInput {
  schoolId: string;
  classSectionId: string;
  termId: string;
  date: string;
  sessionId?: string;
  requestId: string;
  state: "submitted" | "locked" | "draft" | "unlocked";
  revision: number;
  actorId: string;
  action?: string;
}

interface UserEventInput {
  schoolId: string;
  eventType: "gate.visitor.updated" | "leave.updated" | "notification.created" | "timetable.updated" | "calendar.updated" | "coordination.updated" | "people.updated" | "day_plan.updated" | "campus_event.updated" | "diary.updated" | "departure.updated" | "transport.updated" | "notice.updated" | "chat.updated" | "teacher_feedback.updated" | "governance.policy.rejected" | "assessment.updated" | "academic_report.updated";
  aggregateType: string;
  aggregateId: string;
  audienceUserIds: string[];
  payload: Record<string, unknown>;
  idempotencyKey: string;
  notificationUserIds?: string[];
  notificationPayload?: Record<string, unknown> | null;
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return {}; }
}

@Injectable()
export class SchoolEventService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(SchoolEventService.name);
  private readonly workerId = `${hostname()}:${process.pid}:${randomUUID()}`;
  private readonly clients = new Map<string, StreamClient>();
  private broker: PgClient | undefined;
  private workerTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private overdueRegisterTimer?: ReturnType<typeof setInterval>;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempt = 0;
  private brokerDrainPromise: Promise<void> | undefined;
  private brokerDrainRequested = false;
  private brokerWatermark = 0;
  private brokerReady = false;
  private shuttingDown = false;
  private publishing = false;
  private lastPublishSucceededAt: Date | null = null;
  private lastPublishFailedAt: Date | null = null;
  private cachedOutboxMetrics: {
    expiresAt: number;
    pendingEvents: number;
    deadLetteredEvents: number;
    oldestPendingSeconds: number;
  } | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Optional() @Inject(CAMPUS_MODEL_CORE_PORT) private readonly campusModelCore?: CampusModelCorePort,
    @Optional() @Inject(COORDINATION_RUNTIME_PORT) private readonly coordinationRuntime?: CoordinationRuntimePort,
  ) {}

  onApplicationBootstrap(): void {
    void this.connectBroker();
    this.workerTimer = setInterval(() => { void this.publishPending(); }, config().EVENT_WORKER_INTERVAL_MS);
    this.workerTimer.unref();
    this.heartbeatTimer = setInterval(() => { void this.heartbeatAndValidateSessions(); }, HEARTBEAT_MS);
    this.heartbeatTimer.unref();
    this.cleanupTimer = setInterval(() => { void this.cleanupExpiredEvents(); }, CLEANUP_MS);
    this.cleanupTimer.unref();
    this.overdueRegisterTimer = setInterval(() => {
      void this.enqueueOverdueRegisters();
      void this.finalizeDueAttendanceRegisters();
    }, OVERDUE_REGISTER_CHECK_MS);
    this.overdueRegisterTimer.unref();
    void this.enqueueOverdueRegisters();
    void this.finalizeDueAttendanceRegisters();
    void this.cleanupExpiredEvents();
    void this.publishPending();
  }

  async beforeApplicationShutdown(): Promise<void> {
    // End long-lived SSE responses before Fastify waits for HTTP connections.
    // onApplicationShutdown is too late and deadlocks with an open stream.
    this.shuttingDown = true;
    this.brokerReady = false;
    if (this.workerTimer) clearInterval(this.workerTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.overdueRegisterTimer) clearInterval(this.overdueRegisterTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const client of this.clients.values()) this.closeClient(client);
    this.clients.clear();
    if (this.broker) {
      this.broker.removeAllListeners();
      await this.broker.end().catch(() => undefined);
    }
  }

  isReady(): boolean {
    return this.brokerReady;
  }

  async operationalStatus(): Promise<{
    broker_ready: boolean;
    connected_clients: number;
    pending_events: number;
    dead_lettered_events: number;
    oldest_pending_seconds: number;
    last_publish_succeeded_at: string | null;
    last_publish_failed_at: string | null;
  }> {
    if (!this.cachedOutboxMetrics || this.cachedOutboxMetrics.expiresAt <= Date.now()) {
      const result = await sql<{
        pending_events: string;
        dead_lettered_events: string;
        oldest_pending_seconds: string | null;
      }>`
        SELECT
          (SELECT count(*)::text FROM event_outbox
            WHERE published_at IS NULL AND dead_lettered_at IS NULL) AS pending_events,
          (SELECT count(*)::text FROM event_outbox
            WHERE dead_lettered_at IS NOT NULL) AS dead_lettered_events,
          (SELECT EXTRACT(epoch FROM (now() - created_at))::text
            FROM event_outbox
            WHERE published_at IS NULL AND dead_lettered_at IS NULL
            ORDER BY created_at LIMIT 1) AS oldest_pending_seconds
      `.execute(this.db);
      const row = result.rows[0];
      this.cachedOutboxMetrics = {
        expiresAt: Date.now() + 5_000,
        pendingEvents: Number(row?.pending_events ?? 0),
        deadLetteredEvents: Number(row?.dead_lettered_events ?? 0),
        oldestPendingSeconds: Math.max(0, Number(row?.oldest_pending_seconds ?? 0)),
      };
    }
    const outbox = this.cachedOutboxMetrics;
    return {
      broker_ready: this.brokerReady,
      connected_clients: this.clients.size,
      pending_events: outbox.pendingEvents,
      dead_lettered_events: outbox.deadLetteredEvents,
      oldest_pending_seconds: outbox.oldestPendingSeconds,
      last_publish_succeeded_at: this.lastPublishSucceededAt?.toISOString() ?? null,
      last_publish_failed_at: this.lastPublishFailedAt?.toISOString() ?? null,
    };
  }

  async prometheusMetrics(): Promise<string> {
    const status = await this.operationalStatus();
    const timestamp = (value: string | null) => value ? Date.parse(value) / 1_000 : 0;
    return [
      "# HELP omnischool_event_broker_ready Whether the PostgreSQL event listener is connected.",
      "# TYPE omnischool_event_broker_ready gauge",
      `omnischool_event_broker_ready ${status.broker_ready ? 1 : 0}`,
      "# HELP omnischool_sse_connections Current live SSE connections on this instance.",
      "# TYPE omnischool_sse_connections gauge",
      `omnischool_sse_connections ${status.connected_clients}`,
      "# HELP omnischool_outbox_pending_events Durable events awaiting publication.",
      "# TYPE omnischool_outbox_pending_events gauge",
      `omnischool_outbox_pending_events ${status.pending_events}`,
      "# HELP omnischool_outbox_dead_lettered_events Events requiring operator intervention.",
      "# TYPE omnischool_outbox_dead_lettered_events gauge",
      `omnischool_outbox_dead_lettered_events ${status.dead_lettered_events}`,
      "# HELP omnischool_outbox_oldest_pending_seconds Age of the oldest deliverable event.",
      "# TYPE omnischool_outbox_oldest_pending_seconds gauge",
      `omnischool_outbox_oldest_pending_seconds ${status.oldest_pending_seconds}`,
      "# HELP omnischool_outbox_last_publish_success_unixtime Last successful publish time.",
      "# TYPE omnischool_outbox_last_publish_success_unixtime gauge",
      `omnischool_outbox_last_publish_success_unixtime ${timestamp(status.last_publish_succeeded_at)}`,
      "# HELP omnischool_outbox_last_publish_failure_unixtime Last failed publish time.",
      "# TYPE omnischool_outbox_last_publish_failure_unixtime gauge",
      `omnischool_outbox_last_publish_failure_unixtime ${timestamp(status.last_publish_failed_at)}`,
      "",
    ].join("\n");
  }

  async enqueueAttendanceUpdates(db: Db, input: AttendanceEventInput): Promise<AttendanceEventReceipt> {
    if (!input.records.length) return { studentEventIds: new Map(), classEventId: null };
    const studentIds = [...new Set(input.records.map((record) => record.student_id))];
    const recipients = await sql<{
      student_id: string;
      student_user_id: string | null;
      student_name: string;
      guardian_user_ids: string[];
      staff_user_ids: string[];
    }>`
      SELECT st.id AS student_id,
        CASE WHEN u.is_active AND EXISTS (
          SELECT 1 FROM school_memberships own_membership
          WHERE own_membership.user_id=st.user_id
            AND own_membership.school_id=st.school_id
            AND own_membership.role='student' AND own_membership.is_active
        ) THEN st.user_id END AS student_user_id,
        trim(concat_ws(' ', person.first_name, person.last_name)) AS student_name,
        COALESCE((SELECT array_agg(DISTINCT p.user_id)
          FROM guardian_relationships gr JOIN parents p ON p.id=gr.guardian_id
          JOIN users gu ON gu.id=p.user_id AND gu.is_active
          JOIN school_memberships gm ON gm.user_id=p.user_id AND gm.school_id=st.school_id
            AND gm.role='guardian' AND gm.is_active
          WHERE gr.student_id=st.id), ARRAY[]::uuid[]) AS guardian_user_ids,
        COALESCE((SELECT array_agg(DISTINCT sm.user_id)
          FROM school_memberships sm JOIN users su ON su.id=sm.user_id AND su.is_active
          WHERE sm.school_id=st.school_id AND sm.is_active AND (sm.role='admin' OR
            (sm.role='staff' AND (EXISTS (SELECT 1 FROM timetable_slots ts
              WHERE ts.class_section_id=${input.classSectionId}::uuid AND ts.teacher_user_id=sm.user_id)
              OR EXISTS (SELECT 1 FROM effective_school_schedule(${input.schoolId}::uuid,${input.date}::date) p
                WHERE p.class_section_id=${input.classSectionId}::uuid AND p.term_id=${input.termId}::uuid
                  AND p.teacher_user_id=sm.user_id AND NOT p.cancelled AND p.coverage_status='accepted'))))), ARRAY[]::uuid[]) AS staff_user_ids
      FROM students st JOIN school_people person ON person.id=st.person_id LEFT JOIN users u ON u.id=st.user_id
      WHERE st.school_id=${input.schoolId}::uuid AND st.id = ANY(${studentIds}::uuid[])
    `.execute(db);
    const recipientRows = recipients.rows;
    const byStudent = new Map(recipientRows.map((row) => [row.student_id, row]));
    if (byStudent.size !== studentIds.length) {
      throw new Error("Attendance event audience contains an inactive or cross-school student.");
    }

    const rows = input.records.map((record) => {
      const recipient = byStudent.get(record.student_id)!;
      const audience = [...new Set([
        ...(recipient.student_user_id ? [recipient.student_user_id] : []),
        ...recipient.guardian_user_ids,
        ...recipient.staff_user_ids,
      ])];
      const hadPrevious = record.previous_status !== undefined && record.previous_status !== null;
      const changed = hadPrevious && record.previous_status !== record.status;
      const material = !input.suppressNotifications && (record.status !== "present" || changed);
      return {
        school_id: input.schoolId,
        event_type: "attendance.updated",
        aggregate_type: "student",
        aggregate_id: record.student_id,
        audience_user_ids: audience,
        payload: {
          student_id: record.student_id,
          class_section_id: input.classSectionId,
          term_id: input.termId,
          date: input.date,
          ...(input.sessionId ? { session_id: input.sessionId } : {}),
          status: record.status,
          previous_status: record.previous_status ?? null,
          revision: record.revision ?? null,
          refresh: ["student.home", "student.attendance", "student.eligibility", "parent.home", "parent.attendance", "teacher.attendance", "teacher.home", "principal.home", "principal.attendance", "principal.attendance-history", "attendance-model", "attendance-continuity", "campus-view", "notifications", "attention"],
        },
        idempotency_key: `attendance:${input.requestId}:${input.date}:${record.student_id}${input.sessionId ? `:${input.sessionId}` : ""}`,
        notification_user_ids: material
          ? [...(recipient.student_user_id ? [recipient.student_user_id] : []), ...recipient.guardian_user_ids]
          : [],
        notification_payload: (material ? {
          title: changed ? "Attendance corrected" : "Attendance recorded",
          body: `${recipient.student_name}'s attendance for ${input.date} is ${record.status.replace("_", " ")}.`,
          student_id: record.student_id,
          student_link: "/student/attendance",
          parent_link: record.id
            ? `/parent/attendance?student_id=${record.student_id}&date=${input.date}&attendance_record_id=${record.id}&attendance_revision=${record.revision ?? 1}`
            : `/parent/attendance?student_id=${record.student_id}`,
          status: record.status,
          previous_status: record.previous_status ?? null,
          ...(record.id ? {
            attention_eligible: true,
            attention_portal: "parent",
            attention_module: "attendance",
            attention_source_kind: "attendance_outcome",
            attention_source_id: record.id,
            attention_source_revision: record.revision ?? 1,
            attention_topic_key: `attendance:${record.student_id}:${input.date}`,
            attention_student_id: record.student_id,
          } : {}),
        } : null) as any,
      };
    });
    const classAudience = await sql<{ user_id: string }>`
      SELECT DISTINCT audience.user_id FROM (
        SELECT st.user_id
        FROM enrollments e
        JOIN students st ON st.id=e.student_id AND st.school_id=${input.schoolId}::uuid
        JOIN users u ON u.id=st.user_id AND u.is_active
        JOIN school_memberships m ON m.user_id=st.user_id AND m.school_id=st.school_id
          AND m.role='student' AND m.is_active
        WHERE e.class_section_id=${input.classSectionId}::uuid AND e.is_active
        UNION
        SELECT p.user_id
        FROM enrollments e
        JOIN students st ON st.id=e.student_id AND st.school_id=${input.schoolId}::uuid
        JOIN guardian_relationships gr ON gr.student_id=st.id
        JOIN parents p ON p.id=gr.guardian_id
        JOIN users u ON u.id=p.user_id AND u.is_active
        JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=st.school_id
          AND m.role='guardian' AND m.is_active
        WHERE e.class_section_id=${input.classSectionId}::uuid AND e.is_active
      ) audience
    `.execute(db);
    const eventRows = [
      ...rows,
      {
        school_id: input.schoolId,
        event_type: "attendance.updated",
        aggregate_type: "class_section",
        aggregate_id: input.classSectionId,
        audience_user_ids: classAudience.rows.map((row) => row.user_id),
        payload: {
          class_section_id: input.classSectionId,
          term_id: input.termId,
          date: input.date,
          ...(input.sessionId ? { session_id: input.sessionId } : {}),
          reason: "class_ranking_changed",
          refresh: ["student.attendance", "parent.attendance", "attendance-model", "attendance-continuity", "campus-view"],
        },
        idempotency_key: `attendance-ranking:${input.requestId}:${input.date}:${input.classSectionId}${input.sessionId ? `:${input.sessionId}` : ""}`,
        notification_user_ids: [],
        notification_payload: null,
      },
    ];
    const eventKeys = eventRows.map((row) => row.idempotency_key);
    const inserted = await db.insertInto("event_outbox").values(eventRows)
      .onConflict((conflict) => conflict.column("idempotency_key").doNothing())
      .returning(["id", "aggregate_type", "aggregate_id", "idempotency_key"])
      .execute();
    const retained = inserted.length === eventRows.length
      ? inserted
      : await db.selectFrom("event_outbox")
        .select(["id", "aggregate_type", "aggregate_id", "idempotency_key"])
        .where("school_id", "=", input.schoolId)
        .where("idempotency_key", "in", eventKeys)
        .execute();
    const studentEventIds = new Map(retained
      .filter((event) => event.aggregate_type === "student")
      .map((event) => [event.aggregate_id, event.id]));
    const classEventId = retained.find((event) => event.aggregate_type === "class_section")?.id ?? null;
    return { studentEventIds, classEventId };
  }

  async enqueueRegisterEvent(db: Db, input: RegisterEventInput): Promise<string> {
    const audience = await sql<{ user_id: string }>`
      SELECT DISTINCT m.user_id FROM school_memberships m
      JOIN users u ON u.id=m.user_id AND u.is_active
      WHERE m.school_id=${input.schoolId}::uuid AND m.is_active
        AND (m.role='admin' OR (m.role='staff' AND (EXISTS (
          SELECT 1 FROM timetable_slots ts WHERE ts.class_section_id=${input.classSectionId}::uuid
            AND ts.term_id=${input.termId}::uuid AND ts.teacher_user_id=m.user_id
        ) OR EXISTS (SELECT 1 FROM effective_school_schedule(${input.schoolId}::uuid,${input.date}::date) p
          WHERE p.class_section_id=${input.classSectionId}::uuid AND p.term_id=${input.termId}::uuid
            AND p.teacher_user_id=m.user_id AND NOT p.cancelled AND p.coverage_status='accepted'))))
    `.execute(db);
    const idempotencyKey = `attendance-register:${input.requestId}:${input.state}:${input.revision}${input.sessionId ? `:${input.sessionId}` : ""}`;
    const inserted = await db.insertInto("event_outbox").values({
      school_id: input.schoolId,
      event_type: `attendance.register.${input.state}`,
      aggregate_type: input.sessionId ? "attendance_session" : "class_section",
      aggregate_id: input.sessionId ?? input.classSectionId,
      audience_user_ids: audience.rows.map((row) => row.user_id),
      payload: {
        class_section_id: input.classSectionId,
        term_id: input.termId,
        date: input.date,
        ...(input.sessionId ? { session_id: input.sessionId } : {}),
        state: input.state === "unlocked" ? "submitted" : input.state,
        action: input.action ?? input.state,
        revision: input.revision,
        actor_id: input.actorId,
        refresh: ["teacher.attendance", "teacher.home", "principal.home", "principal.attendance", "principal.attendance-history", "attendance-model", "attendance-continuity", "campus-view", "attention"],
      },
      idempotency_key: idempotencyKey,
    }).onConflict((conflict) => conflict.column("idempotency_key").doNothing())
      .returning("id").executeTakeFirst();
    if (inserted) return inserted.id;
    const retained = await db.selectFrom("event_outbox").select("id")
      .where("school_id", "=", input.schoolId)
      .where("idempotency_key", "=", idempotencyKey)
      .executeTakeFirst();
    if (!retained) throw new Error("Attendance register event could not be retained.");
    return retained.id;
  }

  async enqueueUserEvent(db: Db, input: UserEventInput): Promise<void> {
    await db.insertInto("event_outbox").values({
      school_id: input.schoolId, event_type: input.eventType,
      aggregate_type: input.aggregateType, aggregate_id: input.aggregateId,
      audience_user_ids: [...new Set(input.audienceUserIds)], payload: input.payload,
      idempotency_key: input.idempotencyKey,
      notification_user_ids: [...new Set(input.notificationUserIds ?? [])],
      notification_payload: (input.notificationPayload ?? null) as any,
    }).onConflict((conflict) => conflict.column("idempotency_key").doNothing()).execute();
  }

  async enqueueTimetableUpdate(db: Db, input: {
    schoolId: string; classSectionId: string; slotId: string;
    requestId: string; action: "created" | "updated" | "deleted";
  }): Promise<void> {
    const audience = await sql<{ user_id: string }>`
      SELECT DISTINCT audience.user_id FROM (
        SELECT st.user_id
        FROM enrollments e JOIN students st ON st.id=e.student_id
        JOIN users u ON u.id=st.user_id AND u.is_active
        JOIN school_memberships m ON m.user_id=st.user_id AND m.school_id=st.school_id
          AND m.role='student' AND m.is_active
        WHERE e.class_section_id=${input.classSectionId}::uuid AND e.is_active
        UNION
        SELECT p.user_id
        FROM enrollments e JOIN guardian_relationships gr ON gr.student_id=e.student_id
        JOIN parents p ON p.id=gr.guardian_id JOIN users u ON u.id=p.user_id AND u.is_active
        JOIN school_memberships m ON m.user_id=p.user_id AND m.school_id=${input.schoolId}::uuid
          AND m.role='guardian' AND m.is_active
        WHERE e.class_section_id=${input.classSectionId}::uuid AND e.is_active
        UNION
        SELECT m.user_id FROM school_memberships m JOIN users u ON u.id=m.user_id AND u.is_active
        WHERE m.school_id=${input.schoolId}::uuid AND m.role IN ('staff','admin') AND m.is_active
      ) audience
    `.execute(db);
    await this.enqueueUserEvent(db, {
      schoolId: input.schoolId, eventType: "timetable.updated",
      aggregateType: "timetable_slot", aggregateId: input.slotId,
      audienceUserIds: audience.rows.map((row) => row.user_id),
      payload: {
        action: input.action, class_section_id: input.classSectionId, slot_id: input.slotId,
        refresh: ["day-plans", "student.home", "student.timetable", "parent.home", "parent.timetable", "teacher.home", "principal.timetable", "principal.home", "notifications", "attention", "calendar"],
      },
      idempotencyKey: `timetable:${input.requestId}:${input.classSectionId}:${input.slotId}:${input.action}`,
    });
  }

  private async enqueueOverdueRegisters(): Promise<void> {
    try {
      await sql`
        WITH scan_claim AS MATERIALIZED (
          UPDATE event_maintenance_leases lease
          SET last_claimed_at=clock_timestamp()
          WHERE lease.task_name='attendance_register_overdue_scan'
            AND (lease.last_claimed_at IS NULL
              OR lease.last_claimed_at <= clock_timestamp() - interval '30 seconds')
          RETURNING lease.task_name
        ), due AS MATERIALIZED (
          SELECT school.id AS school_id, section.id AS class_section_id,
            term.id AS term_id, section.grade, section.section,
            (now() AT TIME ZONE school.timezone)::date AS school_date
          FROM schools school
          CROSS JOIN scan_claim
          JOIN academic_terms term ON term.school_id=school.id AND term.is_active
            AND (now() AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
          JOIN class_sections section ON section.school_id=school.id
            AND section.academic_year=term.academic_year
          LEFT JOIN institution_operating_rules rule ON rule.school_id=school.id
          WHERE (now() AT TIME ZONE school.timezone) >=
              date_trunc('day',now() AT TIME ZONE school.timezone)+school.attendance_submission_cutoff
                +(COALESCE(rule.attendance_overdue_reminder_minutes,15)||' minutes')::interval
            AND COALESCE(rule.attendance_academic_mode,'scheduled_session')='daily_class'
            AND COALESCE((
              SELECT calendar.is_instructional
              FROM school_calendar_days calendar
              WHERE calendar.school_id=school.id
                AND calendar.date=(now() AT TIME ZONE school.timezone)::date
            ), true)
            AND EXISTS (
              SELECT 1 FROM effective_school_schedule(
                school.id,
                (now() AT TIME ZONE school.timezone)::date
              ) slot
              WHERE slot.class_section_id=section.id AND slot.term_id=term.id
                AND slot.slot_type IN ('class','activity') AND NOT slot.cancelled
            )
            AND NOT EXISTS (
              SELECT 1 FROM attendance_registers register
              WHERE register.class_section_id=section.id AND register.term_id=term.id
                AND register.date=(now() AT TIME ZONE school.timezone)::date
                AND register.state IN ('submitted','locked')
            )
        ), prepared AS MATERIALIZED (
          SELECT due.*,
            ARRAY(
              SELECT membership.user_id
              FROM school_memberships membership
              JOIN users account ON account.id=membership.user_id AND account.is_active
              WHERE membership.school_id=due.school_id AND membership.is_active
                AND membership.role='staff'
                AND (
                  staff_has_class_permission(
                    due.school_id,membership.user_id,'attendance.record',
                    due.class_section_id,due.school_date
                  )
                  OR (
                    NOT EXISTS (
                      SELECT 1 FROM school_memberships owner_membership
                      JOIN users owner_account ON owner_account.id=owner_membership.user_id
                        AND owner_account.is_active
                      WHERE owner_membership.school_id=due.school_id
                        AND owner_membership.role='staff' AND owner_membership.is_active
                        AND staff_has_class_permission(
                          due.school_id,owner_membership.user_id,'attendance.record',
                          due.class_section_id,due.school_date
                        )
                    )
                    AND EXISTS (
                      SELECT 1 FROM effective_school_schedule(due.school_id,due.school_date) slot
                      WHERE slot.class_section_id=due.class_section_id
                        AND slot.term_id=due.term_id
                        AND slot.teacher_user_id=membership.user_id
                        AND slot.slot_type IN ('class','activity')
                        AND NOT slot.cancelled
                        AND slot.coverage_status IN ('not_required','accepted')
                    )
                  )
                )
              ORDER BY membership.user_id
            ) AS audience
          FROM due
        )
        INSERT INTO event_outbox (
          school_id, event_type, aggregate_type, aggregate_id,
          audience_user_ids, payload, idempotency_key,
          notification_user_ids, notification_payload
        )
        SELECT prepared.school_id, 'attendance.register.overdue', 'class_section',
          prepared.class_section_id, prepared.audience,
          jsonb_build_object(
            'class_section_id', prepared.class_section_id,
            'term_id', prepared.term_id,
            'date', prepared.school_date,
            'state', 'overdue',
            'owner_scope', 'effective_teacher',
            'owner_user_id', prepared.audience[1],
            'operating_rule_revision', COALESCE((SELECT revision FROM institution_operating_rules WHERE school_id=prepared.school_id),0),
            'refresh', jsonb_build_array(
              'teacher.home', 'teacher.attendance', 'principal.home',
              'principal.attendance', 'notifications', 'attention'
            )
          ),
          concat('attendance-register-overdue:', prepared.school_id, ':', prepared.class_section_id, ':', prepared.school_date),
          prepared.audience,
          jsonb_build_object(
            'title', 'Attendance register reminder',
            'body', concat('Class ', prepared.grade, prepared.section, ' attendance has not been submitted.'),
            'staff_link', concat('/teacher/attendance?class_section_id=', prepared.class_section_id, '&date=', prepared.school_date),
            'admin_link', concat('/principal/attendance?class_section_id=', prepared.class_section_id, '&date=', prepared.school_date),
            'class_section_id', prepared.class_section_id,
            'date', prepared.school_date
          )
        FROM prepared
        WHERE cardinality(prepared.audience) = 1
        ON CONFLICT (idempotency_key) DO NOTHING
      `.execute(this.db);
      await sql`
        WITH active_schools AS MATERIALIZED (
          SELECT school.id AS school_id,school.timezone,
            (now() AT TIME ZONE school.timezone)::date AS school_date,
            COALESCE(rule.attendance_session_close_after_minutes,30)::int AS close_after_minutes,
            COALESCE(rule.attendance_overdue_reminder_minutes,15)::int AS reminder_minutes,
            COALESCE(rule.revision,0)::int AS rule_revision
          FROM schools school
          JOIN academic_terms term ON term.school_id=school.id AND term.is_active
            AND (now() AT TIME ZONE school.timezone)::date BETWEEN term.starts_on AND term.ends_on
          LEFT JOIN institution_operating_rules rule ON rule.school_id=school.id
          WHERE COALESCE(rule.attendance_academic_mode,'scheduled_session')='scheduled_session'
            AND COALESCE((SELECT calendar.is_instructional FROM school_calendar_days calendar
              WHERE calendar.school_id=school.id
                AND calendar.date=(now() AT TIME ZONE school.timezone)::date),true)
        ), materialized AS (
          INSERT INTO attendance_session_registers(
            school_id,class_section_id,term_id,subject_id,schedule_slot_id,session_date,
            period_number,starts_at,ends_at,title,room,scheduled_teacher_id
          )
          SELECT scope.school_id,slot.class_section_id,slot.term_id,slot.subject_id,slot.id,scope.school_date,
            slot.period_number,slot.starts_at,slot.ends_at,COALESCE(NULLIF(subject.name,''),NULLIF(slot.title,''),'Scheduled session'),
            slot.room,slot.teacher_user_id
          FROM active_schools scope
          CROSS JOIN LATERAL effective_school_schedule(scope.school_id,scope.school_date) slot
          JOIN subjects subject ON subject.id=slot.subject_id AND subject.school_id=scope.school_id
          WHERE slot.slot_type='class' AND slot.subject_id IS NOT NULL AND NOT slot.cancelled
          ON CONFLICT(school_id,session_date,schedule_slot_id) DO NOTHING
          RETURNING id
        ), due AS MATERIALIZED (
          SELECT register.id,register.school_id,register.class_section_id,register.term_id,
            register.subject_id,register.session_date,register.period_number,register.ends_at,
            register.scheduled_teacher_id,scope.rule_revision,section.grade,section.section,subject.name AS subject_name
          FROM active_schools scope
          JOIN attendance_session_registers register ON register.school_id=scope.school_id
            AND register.session_date=scope.school_date
          JOIN class_sections section ON section.id=register.class_section_id
          JOIN subjects subject ON subject.id=register.subject_id
          JOIN school_memberships membership ON membership.school_id=register.school_id
            AND membership.user_id=register.scheduled_teacher_id AND membership.role='staff' AND membership.is_active
          JOIN users account ON account.id=membership.user_id AND account.is_active
          WHERE register.state='draft' AND register.scheduled_teacher_id IS NOT NULL
            AND now() >= ((register.session_date+register.ends_at) AT TIME ZONE scope.timezone
              +((scope.close_after_minutes+scope.reminder_minutes)||' minutes')::interval)
        )
        INSERT INTO event_outbox(
          school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key,
          notification_user_ids,notification_payload
        )
        SELECT due.school_id,'attendance.session.overdue','attendance_session',due.id,
          ARRAY[due.scheduled_teacher_id],jsonb_build_object(
            'session_id',due.id,'class_section_id',due.class_section_id,'term_id',due.term_id,
            'subject_id',due.subject_id,'date',due.session_date,'period_number',due.period_number,
            'state','overdue','owner_user_id',due.scheduled_teacher_id,
            'operating_rule_revision',due.rule_revision,
            'refresh',jsonb_build_array('teacher.home','teacher.attendance','notifications','attention')
          ),concat('attendance-session-overdue:',due.id),ARRAY[due.scheduled_teacher_id],
          jsonb_build_object(
            'title','Subject attendance reminder',
            'body',concat(due.subject_name,' · Class ',due.grade,due.section,' has not been submitted.'),
            'staff_link',concat('/teacher/attendance?date=',due.session_date,'&session_id=',due.id),
            'session_id',due.id,'class_section_id',due.class_section_id,'date',due.session_date
          )
        FROM due
        ON CONFLICT(idempotency_key) DO NOTHING
      `.execute(this.db);
      await this.coordinateOverdueRegisters();
    } catch (error) {
      this.logger.warn(`Overdue attendance register scan failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async coordinateOverdueRegisters(batchSize = 100): Promise<number> {
    const coordinationRuntime = this.coordinationRuntime;
    if (!coordinationRuntime) return 0;
    return this.db.transaction().execute(async (db) => {
      const work = await sql<{
        outbox_id: string;
        school_id: string;
        event_type: "attendance.register.overdue" | "attendance.session.overdue";
        aggregate_id: string;
        owner_user_id: string;
        rule_revision: number;
        approved_by: string;
        occurred_at: Date | string;
        payload: Record<string, unknown>;
        class_label: string;
        subject_label: string | null;
      }>`SELECT outbox.id AS outbox_id,outbox.school_id,outbox.event_type,
          outbox.aggregate_id::text AS aggregate_id,outbox.audience_user_ids[1] AS owner_user_id,
          rule.revision::int AS rule_revision,rule.updated_by AS approved_by,
          outbox.created_at AS occurred_at,outbox.payload,
          concat('Class ',section.grade,section.section) AS class_label,
          CASE WHEN outbox.event_type='attendance.session.overdue' THEN subject.name ELSE NULL END AS subject_label
        FROM event_outbox outbox
        JOIN institution_operating_rules rule ON rule.school_id=outbox.school_id AND rule.updated_by IS NOT NULL
        JOIN class_sections section ON section.id=(outbox.payload->>'class_section_id')::uuid
          AND section.school_id=outbox.school_id
        LEFT JOIN subjects subject ON subject.id=(outbox.payload->>'subject_id')::uuid
          AND subject.school_id=outbox.school_id
        WHERE outbox.event_type IN ('attendance.register.overdue','attendance.session.overdue')
          AND cardinality(outbox.audience_user_ids)=1
          AND NOT EXISTS(SELECT 1 FROM campus_model_events event
            WHERE event.school_id=outbox.school_id AND event.source_outbox_event_id=outbox.id)
        ORDER BY outbox.created_at,outbox.id
        LIMIT ${Math.max(1, Math.min(500, Math.trunc(batchSize)))}
        FOR UPDATE OF outbox SKIP LOCKED`.execute(db);
      for (const item of work.rows) {
        const occurredAt = new Date(item.occurred_at).toISOString();
        const date = typeof item.payload.date === "string" ? item.payload.date : occurredAt.slice(0, 10);
        const sessionId = typeof item.payload.session_id === "string" ? item.payload.session_id : null;
        const classSectionId = typeof item.payload.class_section_id === "string"
          ? item.payload.class_section_id
          : null;
        if (!classSectionId) throw new Error("An overdue attendance event is missing its class context.");
        const subject = item.subject_label ? `${item.subject_label} · ${item.class_label}` : `${item.class_label} daily attendance`;
        await coordinationRuntime.publishAcceptedEvent(db, {
          school_id: item.school_id,
          source_outbox_event_id: item.outbox_id,
          event_kind: "domain_event",
          event_type: item.event_type,
          subject: {
            kind: "attendance_register",
            domain: "attendance",
            domain_id: sessionId ?? `${item.aggregate_id}:${date}`,
            label: subject,
            lifecycle_state: "active",
            source_revision: Math.max(1, item.rule_revision),
            metadata: { class_section_id: classSectionId, session_id: sessionId, date },
          },
          context: null,
          actor_user_id: item.approved_by,
          occurred_at: occurredAt,
          effective_from: occurredAt,
          effective_until: null,
          source_domain: "attendance",
          source_record_id: item.aggregate_id,
          source_revision: Math.max(1, item.rule_revision),
          correlation_id: randomUUID(),
          causation_event_id: null,
          idempotency_key: `attendance-completion:${item.outbox_id}`,
          payload: {
            workflow: "attendance_completion",
            class_section_id: classSectionId,
            session_id: sessionId,
            date,
            operating_rule_revision: item.rule_revision,
          },
          message: {
            subject: "Attendance register needs completion",
            summary: `${subject} has not been submitted after its configured deadline.`,
            payload: {
              workflow: "attendance_completion",
              class_section_id: classSectionId,
              session_id: sessionId,
              date,
              operating_rule_revision: item.rule_revision,
              action_path: `/teacher/attendance?date=${encodeURIComponent(date)}${sessionId ? `&session_id=${encodeURIComponent(sessionId)}` : `&class_section_id=${encodeURIComponent(classSectionId)}`}`,
            },
          },
          selector_input: {
            selector_key: "attendance_register_owner",
            recipient_agents: [{ agent_kind: "human", user_id: item.owner_user_id }],
            scope: null,
          },
        });
      }
      const satisfied = await sql<{
        message_id: string;
        school_id: string;
        register_state: "submitted" | "locked";
      }>`SELECT message.id AS message_id,message.school_id,
          CASE
            WHEN message.payload->>'session_id' IS NOT NULL THEN session_register.state
            ELSE daily_register.state
          END AS register_state
        FROM campus_model_operational_messages message
        LEFT JOIN attendance_session_registers session_register
          ON session_register.school_id=message.school_id
          AND session_register.id=(message.payload->>'session_id')::uuid
        LEFT JOIN attendance_registers daily_register
          ON daily_register.school_id=message.school_id
          AND daily_register.class_section_id=(message.payload->>'class_section_id')::uuid
          AND daily_register.date=(message.payload->>'date')::date
        WHERE message.state IN ('queued','delivered','acknowledged')
          AND message.payload->>'workflow'='attendance_completion'
          AND (
            (message.payload->>'session_id' IS NOT NULL
              AND session_register.state IN ('submitted','locked'))
            OR
            (message.payload->>'session_id' IS NULL
              AND daily_register.state IN ('submitted','locked'))
          )
        ORDER BY message.queued_at,message.id
        FOR UPDATE OF message SKIP LOCKED`.execute(db);
      const occurredAt = new Date().toISOString();
      for (const item of satisfied.rows) {
        await coordinationRuntime.recordMessageOutcome(db, {
          school_id: item.school_id,
          message_id: item.message_id,
          state: "cancelled",
          actor: null,
          source_outbox_event_id: null,
          code: "attendance_register_completed",
          explanation: `The authoritative attendance register is ${item.register_state}; the completion task is no longer actionable.`,
          response: null,
          occurred_at: occurredAt,
          idempotency_key: `attendance-completion-satisfied:${item.message_id}:${item.register_state}`,
        });
      }
      return work.rows.length + satisfied.rows.length;
    });
  }

  private async finalizeDueAttendanceRegisters(batchSize = 100): Promise<number> {
    const limit = Math.max(1, Math.min(500, Math.trunc(batchSize)));
    try {
      return await this.db.transaction().execute(async (db) => {
        const claim = await sql<{ task_name: string }>`
          UPDATE event_maintenance_leases lease
          SET last_claimed_at=clock_timestamp()
          WHERE lease.task_name='attendance_register_auto_finalize'
            AND (lease.last_claimed_at IS NULL
              OR lease.last_claimed_at <= clock_timestamp() - interval '30 seconds')
          RETURNING lease.task_name
        `.execute(db);
        if (!claim.rows.length) return 0;
        const due = await sql<{
          id: string; school_id: string; class_section_id: string; term_id: string;
          date: string; revision: number; submitted_by: string;
          auto_finalize_at: Date; finalization_policy_revision: number | null;
        }>`
          SELECT register.id,register.school_id,register.class_section_id,register.term_id,
            register.date::text,register.revision,register.submitted_by,
            register.auto_finalize_at,register.finalization_policy_revision
          FROM attendance_registers register
          WHERE register.state='submitted'
            AND register.submitted_by IS NOT NULL
            AND register.auto_finalize_at IS NOT NULL
            AND register.auto_finalize_at<=clock_timestamp()
          ORDER BY register.auto_finalize_at,register.id
          FOR UPDATE OF register SKIP LOCKED
          LIMIT ${limit}
        `.execute(db);
        for (const register of due.rows) {
          const revision = Number(register.revision) + 1;
          const finalizedAt = new Date();
          const requestId = randomUUID();
          await db.updateTable("attendance_registers").set({
            state: "locked", revision, locked_by: register.submitted_by,
            locked_at: finalizedAt, auto_finalize_at: null,
            finalization_source: "automatic", updated_at: finalizedAt,
          }).where("id", "=", register.id).where("state", "=", "submitted").execute();
          await db.insertInto("audit_events").values({
            action: "attendance.register.finalized_automatically",
            actor_id: register.submitted_by, school_id: register.school_id,
            target_type: "attendance_register", target_id: register.id,
            request_id: requestId, ip_hash: null,
            metadata: {
              class_section_id: register.class_section_id, date: register.date,
              revision, scheduled_at: register.auto_finalize_at,
              finalization_policy_revision: register.finalization_policy_revision,
              automated: true,
            },
          }).execute();
          const registerEventId = await this.enqueueRegisterEvent(db, {
            schoolId: register.school_id, classSectionId: register.class_section_id,
            termId: register.term_id, date: register.date, requestId,
            state: "locked", revision, actorId: register.submitted_by,
          });
          if (this.campusModelCore) await this.campusModelCore.recordAcceptedChange(db, {
            school_id: register.school_id,
            actor_user_id: register.submitted_by,
            command_type: "attendance.register.finalize_automatically",
            target: { domain: "attendance", domain_id: register.id },
            idempotency_key: `attendance-register-auto-finalize:${register.id}:${revision}`,
            correlation_id: requestId,
            causation_id: null,
            expected_revision: Number(register.revision),
            authority_evidence: [
              `attendance_register:${register.id}`,
              `institution_operating_rules:${register.finalization_policy_revision ?? 0}`,
            ],
            operating_rule_version_ref: `institution_operating_rules:${register.finalization_policy_revision ?? 0}`,
            source_domain: "attendance",
            safe_context: {
              class_section_id: register.class_section_id,
              term_id: register.term_id,
              date: register.date,
              automation_executor: "attendance_register_auto_finalize",
            },
            entities: [{
              kind: "attendance_register",
              domain: "attendance",
              domain_id: register.id,
              label: `Daily attendance · ${register.date}`,
              lifecycle_state: "active",
              source_revision: revision,
              metadata: { class_section_id: register.class_section_id, term_id: register.term_id, date: register.date },
            }],
            relationships: [],
            outcome: {
              code: "finalized_automatically",
              explanation: "The submitted attendance register became final under the institution's snapshotted Operating rule.",
              resulting_revision: revision,
              metadata: {
                scheduled_at: new Date(register.auto_finalize_at).toISOString(),
                finalization_policy_revision: register.finalization_policy_revision,
                automation_executor: "attendance_register_auto_finalize",
              },
            },
            domain_event_id: registerEventId,
          });
        }
        const sessionLimit = Math.max(0, limit - due.rows.length);
        const dueSessions = sessionLimit ? await sql<{
          id: string; school_id: string; class_section_id: string; term_id: string; subject_id: string;
          session_date: string; period_number: number; revision: number; submitted_by: string;
          auto_finalize_at: Date; finalization_policy_revision: number | null;
        }>`
          SELECT register.id,register.school_id,register.class_section_id,register.term_id,register.subject_id,
            register.session_date::text,register.period_number,register.revision,register.submitted_by,
            register.auto_finalize_at,register.finalization_policy_revision
          FROM attendance_session_registers register
          WHERE register.state='submitted'
            AND register.submitted_by IS NOT NULL
            AND register.auto_finalize_at IS NOT NULL
            AND register.auto_finalize_at<=clock_timestamp()
          ORDER BY register.auto_finalize_at,register.id
          FOR UPDATE OF register SKIP LOCKED
          LIMIT ${sessionLimit}
        `.execute(db) : { rows: [] };
        for (const register of dueSessions.rows) {
          const revision = Number(register.revision) + 1;
          const finalizedAt = new Date();
          const requestId = randomUUID();
          await sql`UPDATE attendance_session_registers SET state='locked',revision=${revision},
            locked_by=${register.submitted_by}::uuid,locked_at=${finalizedAt},auto_finalize_at=NULL,
            finalization_source='automatic',updated_at=${finalizedAt}
            WHERE id=${register.id}::uuid AND state='submitted'`.execute(db);
          await sql`INSERT INTO attendance_session_audits(school_id,session_id,actor_id,action,metadata)
            VALUES(${register.school_id}::uuid,${register.id}::uuid,${register.submitted_by}::uuid,'register.finalized_automatically',
              ${JSON.stringify({ class_section_id: register.class_section_id, subject_id: register.subject_id, session_date: register.session_date, period_number: register.period_number, revision, scheduled_at: register.auto_finalize_at, finalization_policy_revision: register.finalization_policy_revision, request_id: requestId })}::jsonb)`.execute(db);
          await db.insertInto("audit_events").values({
            action: "attendance.session.finalized_automatically",
            actor_id: register.submitted_by, school_id: register.school_id,
            target_type: "attendance_session_register", target_id: register.id,
            request_id: requestId, ip_hash: null,
            metadata: {
              class_section_id: register.class_section_id, subject_id: register.subject_id,
              date: register.session_date, period_number: register.period_number,
              revision, scheduled_at: register.auto_finalize_at,
              finalization_policy_revision: register.finalization_policy_revision,
              automated: true,
            },
          }).execute();
          const registerEventId = await this.enqueueRegisterEvent(db, {
            schoolId: register.school_id,
            classSectionId: register.class_section_id,
            termId: register.term_id,
            date: register.session_date,
            sessionId: register.id,
            requestId,
            state: "locked",
            revision,
            actorId: register.submitted_by,
            action: "finalized_automatically",
          });
          if (this.campusModelCore) await this.campusModelCore.recordAcceptedChange(db, {
            school_id: register.school_id,
            actor_user_id: register.submitted_by,
            command_type: "attendance.session.finalize_automatically",
            target: { domain: "attendance", domain_id: register.id },
            idempotency_key: `attendance-session-auto-finalize:${register.id}:${revision}`,
            correlation_id: requestId,
            causation_id: null,
            expected_revision: Number(register.revision),
            authority_evidence: [
              `attendance_session_register:${register.id}`,
              `institution_operating_rules:${register.finalization_policy_revision ?? 0}`,
            ],
            operating_rule_version_ref: `institution_operating_rules:${register.finalization_policy_revision ?? 0}`,
            source_domain: "attendance",
            safe_context: {
              class_section_id: register.class_section_id,
              term_id: register.term_id,
              subject_id: register.subject_id,
              date: register.session_date,
              period_number: register.period_number,
              automation_executor: "attendance_register_auto_finalize",
            },
            entities: [{
              kind: "attendance_register",
              domain: "attendance",
              domain_id: register.id,
              label: `Subject attendance · ${register.session_date} · Period ${register.period_number}`,
              lifecycle_state: "active",
              source_revision: revision,
              metadata: {
                class_section_id: register.class_section_id,
                term_id: register.term_id,
                subject_id: register.subject_id,
                session_date: register.session_date,
                period_number: register.period_number,
              },
            }],
            relationships: [],
            outcome: {
              code: "finalized_automatically",
              explanation: "The submitted subject attendance register became final under the institution's snapshotted Operating rule.",
              resulting_revision: revision,
              metadata: {
                scheduled_at: new Date(register.auto_finalize_at).toISOString(),
                finalization_policy_revision: register.finalization_policy_revision,
                automation_executor: "attendance_register_auto_finalize",
              },
            },
            domain_event_id: registerEventId,
          });
        }
        return due.rows.length + dueSessions.rows.length;
      });
    } catch (error) {
      this.logger.warn(`Attendance register auto-finalization failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }

  async openStream(user: AuthUser, reply: FastifyReply, request: AuthenticatedRequest): Promise<void> {
    if (!this.brokerReady) throw new ServiceUnavailableException("Live updates are temporarily unavailable. Retry shortly.");
    if (this.clients.size >= config().SSE_MAX_CONNECTIONS) throw new ServiceUnavailableException("Live update capacity has been reached.");
    const sessionCount = [...this.clients.values()].filter((client) => client.sessionHash === request.sessionHash && !client.closed).length;
    if (sessionCount >= config().SSE_MAX_CONNECTIONS_PER_SESSION) throw new HttpException("Too many live update connections are open for this session.", HttpStatus.TOO_MANY_REQUESTS);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Content-Encoding": "identity",
    });
    reply.raw.write("retry: 3000\n\n");

    const header = request.headers["last-event-id"];
    const rawLastId = Array.isArray(header) ? header[0] : header;
    // Cursor IDs are explicitly versioned. Numeric IDs came from the legacy
    // insert-order cursor and cannot safely be interpreted as commit order.
    const cursorMatch = rawLastId?.match(new RegExp(`^${SSE_CURSOR_VERSION}-(\\d+)$`));
    const parsedLastId = cursorMatch?.[1] ? Number(cursorMatch[1]) : null;
    const lastId = parsedLastId !== null && Number.isSafeInteger(parsedLastId) ? parsedLastId : null;
    const client: StreamClient = {
      id: randomUUID(), userId: user.id, sessionHash: request.sessionHash,
      reply, lastSequence: lastId, replaying: true, replayOverflow: false,
      pendingEvents: new Map(), closed: false,
    };
    this.clients.set(client.id, client);
    const close = () => this.closeClient(client);
    request.raw.once("close", close);
    reply.raw.once("error", close);

    try {
      if (lastId === null) {
        await this.requestFullSync(client, "initial_connection");
      } else {
        await this.replay(client, lastId);
      }
      this.send(client, "stream.ready", { connected_at: new Date().toISOString() });
    } catch (error) {
      this.logger.error("Unable to initialize SSE replay", error instanceof Error ? error.stack : String(error));
      try {
        await this.requestFullSync(client, "replay_unavailable");
      } catch {
        this.closeClient(client);
      }
    } finally {
      await this.finishReplay(client);
    }
  }

  private async replay(client: StreamClient, afterSequence: number): Promise<void> {
    if (client.closed) return;
    const limit = config().EVENT_REPLAY_LIMIT;
    // Bounds and rows must share one PostgreSQL statement snapshot. Otherwise
    // retention cleanup can advance the floor and delete rows between two
    // SELECTs, producing a partial replay without a required full refresh.
    const result = await sql<ReplayRow>`
      WITH bounds AS MATERIALIZED (
        SELECT GREATEST(
            cursor.replay_floor,
            COALESCE((
              SELECT expired.delivery_sequence
              FROM event_outbox expired
              WHERE expired.published_at IS NOT NULL
                AND expired.delivery_sequence IS NOT NULL
                AND expired.expires_at <= now()
              ORDER BY expired.delivery_sequence DESC
              LIMIT 1
            ), 0)
          )::text AS replay_floor,
          cursor.last_sequence::text AS published_max
        FROM event_delivery_cursor cursor
        WHERE cursor.singleton
      ), replay_events AS MATERIALIZED (
        SELECT event.id, event.delivery_sequence AS sequence, event.school_id,
          event.event_type, event.aggregate_type, event.aggregate_id,
          event.audience_user_ids, event.payload, event.created_at
        FROM event_outbox event CROSS JOIN bounds
        WHERE ${afterSequence} >= bounds.replay_floor::bigint
          AND ${afterSequence} <= bounds.published_max::bigint
          AND event.delivery_sequence > ${afterSequence}
          AND event.published_at IS NOT NULL
          AND event.expires_at > now()
          AND event.audience_user_ids @> ARRAY[${client.userId}::uuid]
          AND event_user_is_authorized(event.school_id, event.event_type, event.payload, ${client.userId}::uuid)
        ORDER BY event.delivery_sequence
        LIMIT ${limit + 1}
      )
      SELECT bounds.replay_floor, bounds.published_max,
        event.id, event.sequence, event.school_id, event.event_type,
        event.aggregate_type, event.aggregate_id, event.audience_user_ids,
        event.payload, event.created_at
      FROM bounds LEFT JOIN replay_events event ON true
      ORDER BY event.sequence NULLS LAST
    `.execute(this.db);
    const replayFloor = Number(result.rows[0]?.replay_floor ?? 0);
    const publishedMax = Number(result.rows[0]?.published_max ?? 0);
    const cursorOutsideHistory = afterSequence > publishedMax
      || afterSequence < replayFloor;
    if (cursorOutsideHistory) {
      await this.requestFullSync(client, "replay_window_expired");
      return;
    }
    const events: EventEnvelope[] = result.rows.flatMap((row) => (
      row.id && row.sequence !== null && row.school_id && row.event_type
        && row.aggregate_type && row.aggregate_id && row.created_at
        ? [{
            id: row.id,
            sequence: row.sequence,
            school_id: row.school_id,
            event_type: row.event_type,
            aggregate_type: row.aggregate_type,
            aggregate_id: row.aggregate_id,
            audience_user_ids: row.audience_user_ids ?? [],
            payload: row.payload,
            created_at: row.created_at,
          }]
        : []
    ));
    if (events.length > limit) {
      await this.requestFullSync(client, "replay_limit_exceeded");
      return;
    }
    for (const event of events) this.dispatchToClient(client, event);
  }

  private async connectBroker(): Promise<void> {
    if (this.shuttingDown) return;
    const settings = config();
    const eventConnectionString = settings.EVENT_DATABASE_URL ?? settings.DATABASE_URL;
    const connection = postgresClientConnectionConfig(eventConnectionString, {
      name: settings.EVENT_DATABASE_URL ? "EVENT_DATABASE_URL" : "DATABASE_URL",
      purpose: "events",
      requireRemoteTls: settings.DEPLOYMENT_ENVIRONMENT === "stage" || settings.DEPLOYMENT_ENVIRONMENT === "production",
    });
    const client = new PgClient({
      ...connection,
      application_name: `omnischool_event_broker_${process.pid}`,
      keepAlive: true,
      connectionTimeoutMillis: config().EVENT_BROKER_CONNECT_TIMEOUT_MS,
    });
    client.on("notification", (message) => {
      if (message.channel !== BROKER_CHANNEL || !message.payload) return;
      this.receiveBrokerNotification(message.payload);
    });
    client.on("error", (error) => {
      this.handleBrokerDisconnect(client, error);
    });
    client.on("end", () => {
      this.handleBrokerDisconnect(client);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${BROKER_CHANNEL}`);
      if (this.shuttingDown) {
        client.removeAllListeners();
        await client.end();
        return;
      }
      this.broker = client;
      // Establish the instance cursor while new streams are still rejected.
      // Existing clients replay from their own cursors below, so notifications
      // committed between LISTEN and this snapshot cannot create a gap.
      this.brokerWatermark = await this.readCurrentWatermark();
      if (this.shuttingDown) return;
      this.brokerReady = true;
      this.reconnectAttempt = 0;
      this.logger.log("PostgreSQL event broker connected");
      await this.recoverConnectedClients();
    } catch (error) {
      client.removeAllListeners();
      await client.end().catch(() => undefined);
      if (this.broker === client) this.broker = undefined;
      this.brokerReady = false;
      this.logger.error("Unable to connect PostgreSQL event broker", error instanceof Error ? error.message : String(error));
      this.scheduleReconnect();
    }
  }

  private handleBrokerDisconnect(client: PgClient, error?: Error): void {
    if (error) this.logger.error(`Event broker error: ${error.message}`);
    // A delayed end/error from an older connection must not mark its healthy
    // replacement unavailable.
    if (this.broker !== client) return;
    client.removeAllListeners("notification");
    this.broker = undefined;
    this.brokerReady = false;
    if (!this.shuttingDown) this.scheduleReconnect();
    if (error) {
      // Idle-client errors do not guarantee that application code releases
      // the socket. End it explicitly; a later `end` event is ignored because
      // this client is no longer the active broker.
      try {
        void client.end()
          .catch((endError: unknown) => {
            this.logger.warn(`Unable to close failed event broker: ${endError instanceof Error ? endError.message : String(endError)}`);
          })
          .finally(() => client.removeAllListeners());
      } catch (endError) {
        client.removeAllListeners();
        this.logger.warn(`Unable to close failed event broker: ${endError instanceof Error ? endError.message : String(endError)}`);
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.shuttingDown) return;
    const base = Math.min(30_000, 500 * (2 ** this.reconnectAttempt++));
    const wait = base + Math.floor(Math.random() * 500);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectBroker();
    }, wait);
    this.reconnectTimer.unref();
  }

  private receiveBrokerNotification(payload: string): void {
    let decoded: { id?: string };
    try { decoded = JSON.parse(payload) as { id?: string }; } catch { return; }
    if (!decoded.id) return;
    if (!this.brokerReady) return;
    this.queueBrokerDrain();
  }

  private queueBrokerDrain(): void {
    this.brokerDrainRequested = true;
    if (this.brokerDrainPromise || this.shuttingDown) return;
    const work = Promise.resolve()
      .then(async () => {
        while (this.brokerDrainRequested && !this.shuttingDown) {
          this.brokerDrainRequested = false;
          await this.drainPublishedEvents();
        }
      })
      .catch(async (error: unknown) => {
        this.logger.error("Event broker notification handling failed", error instanceof Error ? error.stack : String(error));
        // Never let a later notification advance a browser beyond an event
        // whose lookup failed. Repair every connected cursor (or force a full
        // cache sync) before another coalesced drain begins.
        await this.recoverConnectedClients();
      })
      .finally(() => {
        this.brokerDrainPromise = undefined;
        if (this.brokerDrainRequested && !this.shuttingDown) this.queueBrokerDrain();
      });
    this.brokerDrainPromise = work;
  }

  private async drainPublishedEvents(): Promise<void> {
    const limit = Math.max(1, config().EVENT_BATCH_SIZE);
    for (;;) {
      // NOTIFY is only a wake-up. Draining the committed cursor range in
      // delivery order remains correct while a previous-release worker is
      // still publishing a batch and notifying it in legacy sequence order.
      const result = await sql<BrokerDrainRow>`
        WITH bounds AS MATERIALIZED (
          SELECT last_sequence::text AS published_max
          FROM event_delivery_cursor
          WHERE singleton
        ), batch AS MATERIALIZED (
          SELECT event.id, event.delivery_sequence AS sequence, event.school_id,
            event.event_type, event.aggregate_type, event.aggregate_id,
            event.payload, event.created_at,
            ARRAY(
              SELECT candidate.user_id
              FROM unnest(event.audience_user_ids) candidate(user_id)
              WHERE event_user_is_authorized(
                event.school_id, event.event_type, event.payload, candidate.user_id
              )
            ) AS audience_user_ids
          FROM event_outbox event CROSS JOIN bounds
          WHERE event.published_at IS NOT NULL
            AND event.delivery_sequence IS NOT NULL
            AND event.delivery_sequence > ${this.brokerWatermark}
            AND event.delivery_sequence <= bounds.published_max::bigint
          ORDER BY event.delivery_sequence
          LIMIT ${limit}
        )
        SELECT bounds.published_max, event.id, event.sequence, event.school_id,
          event.event_type, event.aggregate_type, event.aggregate_id,
          event.audience_user_ids, event.payload, event.created_at
        FROM bounds LEFT JOIN batch event ON true
        ORDER BY event.sequence NULLS LAST
      `.execute(this.db);
      const publishedMax = Number(result.rows[0]?.published_max ?? this.brokerWatermark);
      if (!Number.isSafeInteger(publishedMax) || publishedMax < this.brokerWatermark) {
        throw new Error("Invalid event delivery watermark");
      }
      const events: EventEnvelope[] = result.rows.flatMap((row) => (
        row.id && row.sequence !== null && row.school_id && row.event_type
          && row.aggregate_type && row.aggregate_id && row.created_at
          ? [{
              id: row.id,
              sequence: row.sequence,
              school_id: row.school_id,
              event_type: row.event_type,
              aggregate_type: row.aggregate_type,
              aggregate_id: row.aggregate_id,
              audience_user_ids: row.audience_user_ids ?? [],
              payload: row.payload,
              created_at: row.created_at,
            }]
          : []
      ));
      if (!events.length) {
        // Rows may already have expired and been retained only in the cursor.
        this.brokerWatermark = publishedMax;
        return;
      }
      for (const event of events) {
        const sequence = Number(event.sequence);
        if (!Number.isSafeInteger(sequence) || sequence <= this.brokerWatermark) {
          throw new Error("Invalid event delivery sequence");
        }
        this.dispatch(event);
        this.brokerWatermark = sequence;
      }
      if (this.brokerWatermark >= publishedMax) return;
    }
  }

  private async publishPending(): Promise<void> {
    if (this.publishing || !this.brokerReady) return;
    this.publishing = true;
    try {
      const eventIds = await this.claimPendingEvents(config().EVENT_BATCH_SIZE);
      if (!eventIds.length) return;
      try {
        const published = await this.publishClaimedEvents(eventIds);
        if (published > 0) this.lastPublishSucceededAt = new Date();
      } catch (batchError) {
        this.lastPublishFailedAt = new Date();
        this.logger.error("Event outbox batch publishing failed; isolating claimed rows", batchError instanceof Error ? batchError.stack : String(batchError));
        for (const eventId of eventIds) {
          try {
            const published = await this.publishClaimedEvents([eventId]);
            if (published > 0) this.lastPublishSucceededAt = new Date();
          } catch (eventError) {
            await this.recordPublishFailure(eventId, eventError);
          }
        }
      }
    } catch (error) {
      this.lastPublishFailedAt = new Date();
      this.logger.error("Event outbox claim failed", error instanceof Error ? error.stack : String(error));
    } finally {
      this.publishing = false;
    }
  }

  private async claimPendingEvents(limit: number): Promise<string[]> {
    const result = await sql<{ id: string }>`
      WITH candidates AS MATERIALIZED (
        SELECT id
        FROM event_outbox
        WHERE published_at IS NULL
          AND dead_lettered_at IS NULL
          AND available_at <= now()
          AND (claim_expires_at IS NULL OR claim_expires_at <= now())
        ORDER BY available_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE event_outbox event
      SET published_by=${this.workerId},
        claim_expires_at=clock_timestamp() + interval '30 seconds'
      FROM candidates
      WHERE event.id=candidates.id
      RETURNING event.id
    `.execute(this.db);
    return result.rows.map((row) => row.id);
  }

  private async publishClaimedEvents(eventIds: string[]): Promise<number> {
    if (!eventIds.length) return 0;
    const result = await sql<EventEnvelope>`
        WITH candidates AS MATERIALIZED (
          SELECT id, created_at
          FROM event_outbox
          WHERE id=ANY(${eventIds}::uuid[])
            AND published_at IS NULL
            AND dead_lettered_at IS NULL
            AND published_by=${this.workerId}
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
        ), reservation AS MATERIALIZED (
          UPDATE event_delivery_cursor cursor
          SET last_sequence=cursor.last_sequence + (SELECT count(*) FROM candidates)
          WHERE cursor.singleton
          RETURNING cursor.last_sequence
        ), numbered AS MATERIALIZED (
          SELECT candidate.id,
            reservation.last_sequence - count(*) OVER ()
              + row_number() OVER (ORDER BY candidate.created_at, candidate.id) AS delivery_sequence
          FROM candidates candidate CROSS JOIN reservation
        ), claimed AS (
          UPDATE event_outbox e
          SET published_at=clock_timestamp(), attempts=e.attempts+1,
            last_attempt_at=clock_timestamp(), last_error=NULL, claim_expires_at=NULL,
            delivery_sequence=numbered.delivery_sequence
          FROM numbered WHERE e.id=numbered.id
          RETURNING e.*
        ), inserted_notifications AS (
          INSERT INTO notifications (
            recipient_id, kind, title, body, link, metadata, dedupe_key,
            attention_eligible, attention_school_id, attention_student_id,
            attention_class_section_id, attention_portal, attention_module,
            attention_source_kind, attention_source_id,
            attention_source_revision, attention_topic_key
          )
          SELECT recipients.recipient_id,
            CASE WHEN c.notification_payload->>'kind' IN ('attendance','leave','diary','general')
              THEN c.notification_payload->>'kind' ELSE 'general' END,
            COALESCE(c.notification_payload->>'title', 'Attendance updated'),
            COALESCE(c.notification_payload->>'body', 'A school attendance record changed.'),
            CASE u.role
              WHEN 'parent' THEN COALESCE(c.notification_payload->>'parent_link', c.notification_payload->>'link', '/parent/attendance')
              WHEN 'student' THEN COALESCE(c.notification_payload->>'student_link', c.notification_payload->>'link', '/student/attendance')
              WHEN 'staff' THEN COALESCE(c.notification_payload->>'staff_link', c.notification_payload->>'link', '/teacher/attendance')
              WHEN 'admin' THEN COALESCE(c.notification_payload->>'admin_link', c.notification_payload->>'link', '/principal/attendance')
              ELSE COALESCE(c.notification_payload->>'link', '/')
            END,
            COALESCE(c.notification_payload, '{}'::jsonb),
            'event:' || c.id::text,
            attention_contract.eligible,
            CASE WHEN attention_contract.eligible THEN c.school_id END,
            CASE WHEN attention_contract.eligible
              AND COALESCE(c.notification_payload->>'attention_student_id','')<>''
              THEN (c.notification_payload->>'attention_student_id')::uuid END,
            CASE WHEN attention_contract.eligible
              AND COALESCE(c.notification_payload->>'attention_class_section_id','')<>''
              THEN (c.notification_payload->>'attention_class_section_id')::uuid END,
            CASE WHEN attention_contract.eligible THEN role_context.portal END,
            CASE WHEN attention_contract.eligible THEN c.notification_payload->>'attention_module' END,
            CASE WHEN attention_contract.eligible THEN c.notification_payload->>'attention_source_kind' END,
            CASE WHEN attention_contract.eligible THEN (c.notification_payload->>'attention_source_id')::uuid END,
            CASE WHEN attention_contract.eligible THEN (c.notification_payload->>'attention_source_revision')::integer END,
            CASE WHEN attention_contract.eligible THEN c.notification_payload->>'attention_topic_key' END
          FROM claimed c
          CROSS JOIN LATERAL unnest(c.notification_user_ids) AS recipients(recipient_id)
          JOIN users u ON u.id=recipients.recipient_id AND u.is_active
          CROSS JOIN LATERAL (
            SELECT CASE u.role
              WHEN 'parent' THEN 'parent'
              WHEN 'student' THEN 'student'
              WHEN 'staff' THEN 'teacher'
              WHEN 'admin' THEN 'principal'
            END AS portal
          ) role_context
          CROSS JOIN LATERAL (
            SELECT COALESCE((
              c.notification_payload->>'attention_eligible'='true'
              AND role_context.portal IN ('parent','teacher','principal')
              AND (
                NOT (c.notification_payload ? 'attention_portal')
                OR c.notification_payload->>'attention_portal'=role_context.portal
              )
              AND c.notification_payload->>'attention_module' IN (
                'leave','results','calendar','timetable','attendance','events',
                'fees','safeguarding','policies','departure','staff','responsibilities','transport'
              )
              AND c.notification_payload->>'attention_source_kind' IN (
                'student_leave_decision','staff_leave_decision','assessment_publication',
                'report_publication','day_plan_publication','timetable_publication','calendar_change',
                'attendance_outcome','event_cancellation','event_withdrawal','event_refund',
                'fee_review_decision','guardian_leave_authority','restricted_care_update',
                'policy_publication','departure_request_decision','transport_trip_cancellation',
                'transport_rider_exception','departure_handover_exception','departure_plan_exception',
                'responsibility_offer','responsibility_response','responsibility_revocation',
                'coverage_offer','coverage_response','staff_leave_review',
                'transport_swap','transport_swap_approval','transport_swap_response','transport_swap_decision'
              )
              AND CASE c.notification_payload->>'attention_source_kind'
                WHEN 'student_leave_decision' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='leave'
                WHEN 'staff_leave_decision' THEN role_context.portal='teacher'
                  AND c.notification_payload->>'attention_module'='leave'
                WHEN 'assessment_publication' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='results'
                WHEN 'report_publication' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='results'
                WHEN 'day_plan_publication' THEN role_context.portal IN ('parent','teacher','principal')
                  AND c.notification_payload->>'attention_module'='timetable'
                WHEN 'timetable_publication' THEN role_context.portal IN ('parent','teacher','principal')
                  AND c.notification_payload->>'attention_module'='timetable'
                WHEN 'calendar_change' THEN role_context.portal IN ('parent','teacher','principal')
                  AND c.notification_payload->>'attention_module'='calendar'
                WHEN 'attendance_outcome' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='attendance'
                WHEN 'event_cancellation' THEN role_context.portal IN ('parent','teacher','principal')
                  AND c.notification_payload->>'attention_module'='events'
                  AND (
                    (role_context.portal='parent'
                      AND COALESCE(c.notification_payload->>'attention_student_id','')<>'')
                    OR (role_context.portal IN ('teacher','principal')
                      AND COALESCE(c.notification_payload->>'attention_student_id','')='')
                  )
                WHEN 'event_withdrawal' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='events'
                WHEN 'event_refund' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='events'
                WHEN 'fee_review_decision' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='fees'
                WHEN 'guardian_leave_authority' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='leave'
                WHEN 'restricted_care_update' THEN role_context.portal IN ('teacher','principal')
                  AND c.notification_payload->>'attention_module'='safeguarding'
                WHEN 'policy_publication' THEN role_context.portal IN ('parent','teacher')
                  AND c.notification_payload->>'attention_module'='policies'
                WHEN 'departure_request_decision' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='departure'
                WHEN 'transport_trip_cancellation' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='departure'
                WHEN 'transport_rider_exception' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='departure'
                WHEN 'departure_handover_exception' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='departure'
                WHEN 'departure_plan_exception' THEN role_context.portal='parent'
                  AND c.notification_payload->>'attention_module'='departure'
                WHEN 'responsibility_offer' THEN role_context.portal='teacher'
                  AND c.notification_payload->>'attention_module'='responsibilities'
                WHEN 'responsibility_response' THEN role_context.portal='principal'
                  AND c.notification_payload->>'attention_module'='staff'
                WHEN 'responsibility_revocation' THEN role_context.portal='teacher'
                  AND c.notification_payload->>'attention_module'='responsibilities'
                WHEN 'coverage_offer' THEN role_context.portal='teacher'
                  AND c.notification_payload->>'attention_module'='responsibilities'
                WHEN 'coverage_response' THEN role_context.portal='principal'
                  AND c.notification_payload->>'attention_module'='staff'
                WHEN 'staff_leave_review' THEN role_context.portal='principal'
                  AND c.notification_payload->>'attention_module'='staff'
                WHEN 'transport_swap' THEN role_context.portal='teacher'
                  AND c.notification_payload->>'attention_module'='transport'
                WHEN 'transport_swap_approval' THEN role_context.portal='principal'
                  AND c.notification_payload->>'attention_module'='departure'
                WHEN 'transport_swap_response' THEN role_context.portal='teacher'
                  AND c.notification_payload->>'attention_module'='transport'
                WHEN 'transport_swap_decision' THEN role_context.portal='teacher'
                  AND c.notification_payload->>'attention_module'='transport'
                ELSE false
              END
              AND c.notification_payload->>'attention_source_id'
                ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              AND c.notification_payload->>'attention_source_revision' ~ '^[1-9][0-9]*$'
              AND length(trim(COALESCE(c.notification_payload->>'attention_topic_key',''))) BETWEEN 1 AND 255
              AND (
                NOT (c.notification_payload ? 'attention_student_id')
                OR COALESCE(c.notification_payload->>'attention_student_id','')=''
                OR c.notification_payload->>'attention_student_id'
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              )
              AND (
                NOT (c.notification_payload ? 'attention_class_section_id')
                OR COALESCE(c.notification_payload->>'attention_class_section_id','')=''
                OR c.notification_payload->>'attention_class_section_id'
                  ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
              )
            ), false) AS eligible
          ) attention_contract
          WHERE event_user_is_authorized(c.school_id, c.event_type, c.payload, recipients.recipient_id)
          ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
          RETURNING id
        )
        SELECT c.id, c.delivery_sequence AS sequence, c.school_id, c.event_type, c.aggregate_type,
          c.aggregate_id, c.audience_user_ids, c.payload, c.created_at,
          pg_notify(${BROKER_CHANNEL}, json_build_object('id', c.id, 'sequence', c.delivery_sequence)::text) AS notified
        FROM claimed c
        ORDER BY c.delivery_sequence
      `.execute(this.db);
    // LISTEN/NOTIFY fans this committed event out to every API instance,
    // including this one. Browser replay uses the durable outbox sequence.
    return result.rows.length;
  }

  private async recordPublishFailure(eventId: string, error: unknown): Promise<void> {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
    try {
      await sql`
        UPDATE event_outbox event
        SET attempts=event.attempts+1,
          last_attempt_at=clock_timestamp(),
          last_error=${message},
          published_by=NULL,
          claim_expires_at=NULL,
          available_at=clock_timestamp() + make_interval(
            secs => LEAST(300, (2 ^ LEAST(event.attempts + 1, 8))::integer)
          ),
          dead_lettered_at=CASE
            WHEN event.attempts + 1 >= ${MAX_EVENT_ATTEMPTS} THEN clock_timestamp()
            ELSE NULL
          END
        WHERE event.id=${eventId}::uuid
          AND event.published_at IS NULL
          AND event.published_by=${this.workerId}
      `.execute(this.db);
    } catch (recordError) {
      this.logger.error("Unable to persist event publish failure", recordError instanceof Error ? recordError.stack : String(recordError));
    }
  }

  private dispatch(event: EventEnvelope): void {
    const audience = new Set(event.audience_user_ids);
    for (const client of this.clients.values()) {
      if (!audience.has(client.userId)) continue;
      if (client.replaying) {
        const sequence = Number(event.sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence <= (client.lastSequence ?? 0)) continue;
        if (client.pendingEvents.size >= config().EVENT_REPLAY_LIMIT) {
          client.pendingEvents.clear();
          client.replayOverflow = true;
        } else if (!client.replayOverflow) {
          client.pendingEvents.set(sequence, event);
        }
      } else {
        this.dispatchToClient(client, event);
      }
    }
  }

  private dispatchToClient(client: StreamClient, event: EventEnvelope): void {
    const sequence = Number(event.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      this.send(client, "sync.required", { reason: "invalid_event_sequence" });
      return;
    }
    if (client.lastSequence !== null && sequence <= client.lastSequence) return;
    const accepted = this.send(client, event.event_type, {
      id: event.id,
      type: event.event_type,
      aggregate_type: event.aggregate_type,
      aggregate_id: event.aggregate_id,
      school_id: event.school_id,
      payload: parsePayload(event.payload),
      created_at: event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at,
    }, sequence);
    if (accepted) client.lastSequence = sequence;
  }

  private async readCurrentWatermark(): Promise<number> {
    const result = await sql<{ sequence: string | number | null }>`
      SELECT last_sequence AS sequence FROM event_delivery_cursor WHERE singleton
    `.execute(this.db);
    const watermark = Number(result.rows[0]?.sequence);
    if (!Number.isSafeInteger(watermark) || watermark < 0) {
      throw new Error("Event delivery cursor is not initialized");
    }
    return watermark;
  }

  private async advanceToCurrentWatermark(client: StreamClient): Promise<number> {
    const watermark = await this.readCurrentWatermark();
    // A full cache read supersedes the old cursor. Under normal operation this
    // only advances; replacing a cursor from another/reset database prevents a
    // permanently future Last-Event-ID from forcing full sync on every retry.
    client.lastSequence = watermark;
    return watermark;
  }

  private async requestFullSync(client: StreamClient, reason: string): Promise<void> {
    // Capture the committed boundary before asking the browser to refetch. Any
    // event committed before this read is visible to that later refetch; events
    // committed after it remain buffered and are delivered once replay ends.
    const watermark = await this.advanceToCurrentWatermark(client);
    // Control frames also checkpoint the browser's native EventSource cursor.
    // This includes v2-0 for a newly initialized database.
    this.send(client, "sync.required", { reason }, watermark);
  }

  private async recoverConnectedClients(): Promise<void> {
    const clients = [...this.clients.values()].filter((client) => !client.closed);
    await Promise.all(clients.map(async (client) => {
      client.replaying = true;
      try {
        if (client.lastSequence === null) {
          await this.requestFullSync(client, "broker_reconnected");
        } else {
          await this.replay(client, client.lastSequence);
        }
      } catch (error) {
        this.logger.warn(`Unable to recover SSE client after broker reconnect: ${error instanceof Error ? error.message : String(error)}`);
        try {
          await this.requestFullSync(client, "broker_replay_unavailable");
        } catch {
          this.closeClient(client);
        }
      } finally {
        await this.finishReplay(client);
      }
    }));
  }

  private async finishReplay(client: StreamClient): Promise<void> {
    if (client.closed) return;
    while (client.replayOverflow) {
      client.replayOverflow = false;
      client.pendingEvents.clear();
      await this.requestFullSync(client, "live_replay_buffer_exceeded");
    }
    while (client.pendingEvents.size) {
      const pending = [...client.pendingEvents.entries()].sort(([left], [right]) => left - right);
      client.pendingEvents.clear();
      for (const [, event] of pending) this.dispatchToClient(client, event);
      if (client.replayOverflow) return this.finishReplay(client);
    }
    client.replaying = false;
  }

  private send(client: StreamClient, eventName: string, data: unknown, sequence?: number): boolean {
    if (client.closed || client.reply.raw.destroyed || client.reply.raw.writableEnded) {
      this.closeClient(client);
      return false;
    }
    const frame = `${sequence === undefined ? "" : `id: ${SSE_CURSOR_VERSION}-${sequence}\n`}event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      const accepted = client.reply.raw.write(frame);
      if (!accepted) {
        // Do not let a slow client accumulate an unbounded Node response buffer.
        // The browser reconnects with Last-Event-ID and replays from the outbox.
        client.closed = true;
        this.clients.delete(client.id);
        client.reply.raw.destroy();
        return false;
      }
      return true;
    } catch {
      this.closeClient(client);
      return false;
    }
  }

  private closeClient(client: StreamClient): void {
    if (client.closed) return;
    client.closed = true;
    this.clients.delete(client.id);
    if (!client.reply.raw.writableEnded) client.reply.raw.end();
  }

  private async heartbeatAndValidateSessions(): Promise<void> {
    const liveClients = [...this.clients.values()].filter((client) => !client.closed);
    if (!liveClients.length) return;
    const sessionHashes = [...new Set(liveClients.map((client) => client.sessionHash))];
    try {
      const active = await sql<{ token_hash: string }>`
        SELECT s.token_hash FROM auth_sessions s
        JOIN users u ON u.id=s.user_id AND u.is_active
        WHERE s.token_hash = ANY(${sessionHashes}::text[]) AND s.expires_at > now()
      `.execute(this.db);
      const valid = new Set(active.rows.map((row) => row.token_hash));
      for (const client of liveClients) {
        if (!valid.has(client.sessionHash)) {
          this.send(client, "session.expired", { reason: "session_invalid" });
          this.closeClient(client);
        } else {
          try { client.reply.raw.write(": heartbeat\n\n"); } catch { this.closeClient(client); }
        }
      }
    } catch (error) {
      this.logger.warn(`SSE session validation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async cleanupExpiredEvents(batchSize = config().EVENT_CLEANUP_BATCH_SIZE): Promise<number> {
    const limit = Math.max(1, Math.trunc(batchSize));
    try {
      const result = await sql<{ deleted_count: number | string }>`
        WITH cleanup_claim AS MATERIALIZED (
          UPDATE event_maintenance_leases lease
          SET last_claimed_at=clock_timestamp()
          WHERE lease.task_name='event_retention_cleanup'
            AND (lease.last_claimed_at IS NULL
              OR lease.last_claimed_at <= clock_timestamp() - interval '55 seconds')
          RETURNING lease.task_name
        ), expired AS MATERIALIZED (
          SELECT id, delivery_sequence
          FROM event_outbox event CROSS JOIN cleanup_claim
          WHERE event.published_at IS NOT NULL
            AND event.delivery_sequence IS NOT NULL
            AND event.expires_at <= now()
          ORDER BY event.expires_at, event.delivery_sequence
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        ), deleted AS MATERIALIZED (
          DELETE FROM event_outbox event
          USING expired
          WHERE event.id=expired.id
          RETURNING event.delivery_sequence
        ), deleted_summary AS MATERIALIZED (
          SELECT count(*)::int AS deleted_count,
            max(delivery_sequence) AS highest_deleted_sequence
          FROM deleted
        ), advanced_floor AS (
          -- Depend on the bounded delete so the publisher's singleton cursor
          -- is locked only after this small batch has finished.
          UPDATE event_delivery_cursor cursor
          SET replay_floor=GREATEST(cursor.replay_floor, summary.highest_deleted_sequence)
          FROM deleted_summary summary
          WHERE cursor.singleton AND summary.highest_deleted_sequence IS NOT NULL
          RETURNING cursor.replay_floor
        )
        SELECT deleted_count FROM deleted_summary
      `.execute(this.db);
      return Number(result.rows[0]?.deleted_count ?? 0);
    } catch (error) {
      this.logger.warn(`Event retention cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      return 0;
    }
  }
}
