import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { sql, type Kysely } from "kysely";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import type {
  ScenarioIdentityMapping,
  ScenarioSourceAgentKind,
} from "../campus-model-core/scenarios/contracts.js";
import type {
  CampusScenarioCoverageEvidence,
  CampusScenarioInterventionType,
  CampusScenarioRepositorySnapshot,
  CampusScenarioSession,
  CampusScenarioTarget,
} from "./scenario-contracts.js";

interface ScheduleRow {
  occurrence_key: string;
  occurrence_date: string;
  starts_at: Date | string;
  ends_at: Date | string;
  class_section_id: string;
  teacher_agent_id: string | null;
  teacher_person_id: string | null;
  teacher_assignment_present: boolean;
  space_id: string | null;
  space_capacity: number | string | null;
  expected_count: number | string;
  source_kind: string;
  source_revision: number | string;
  source_version: number | string | null;
}

interface CoverageEvidenceRow {
  offered_count: number | string;
  responded_count: number | string;
  accepted_count: number | string;
  median_response_minutes: number | string | null;
  source_max_at: Date | string | null;
}

interface ConfigurationRow {
  kind: "operating_rule" | "domain_configuration";
  key: string;
  revision: number | string;
  updated_at: Date | string;
  payload: unknown;
}

interface SnapshotInput {
  school_id: string;
  campus_id: string;
  timezone: string;
  captured_at: string;
  horizon_to: string;
  target: CampusScenarioTarget;
  scenario_id: string;
  behaviour_policy_version_id: string | null;
}

export interface ScenarioAgentIdentityRow {
  id: string;
  agent_kind: string;
  person_id: string | null;
  external_ref: string | null;
  revision: number | string;
}

const sourceAgentKinds = new Set<ScenarioSourceAgentKind>([
  "human", "team", "device", "integration", "software",
]);

function requiredIdentityValue(value: string | null, label: string): string {
  if (value === null || value.trim().length === 0) {
    throw new Error(`Cannot capture scenario identity: ${label} is missing.`);
  }
  if (value !== value.trim()) {
    throw new Error(`Cannot capture scenario identity: ${label} is not canonical.`);
  }
  return value;
}

/**
 * Convert a complete active Model Core agent registry snapshot to isolated,
 * run-local counterparts. This intentionally fails closed if legacy or corrupted
 * data violates the reviewed human/non-human identity shapes.
 */
export function buildScenarioIdentityMappings(input: {
  scenario_id: string;
  behaviour_policy_version_id: string | null;
  agents: readonly ScenarioAgentIdentityRow[];
}): ScenarioIdentityMapping[] {
  const scenarioId = requiredIdentityValue(input.scenario_id, "scenario ID");
  const behaviourVersion = input.behaviour_policy_version_id === null
    ? null
    : requiredIdentityValue(input.behaviour_policy_version_id, "behaviour policy version ID");
  const seen = new Set<string>();

  return input.agents.map((row) => {
    const agentId = requiredIdentityValue(row.id, "source agent ID");
    if (seen.has(agentId)) {
      throw new Error(`Cannot capture scenario identity: duplicate source agent ${agentId}.`);
    }
    seen.add(agentId);
    if (!sourceAgentKinds.has(row.agent_kind as ScenarioSourceAgentKind)) {
      throw new Error(`Cannot capture scenario identity: unsupported agent kind ${row.agent_kind}.`);
    }
    if (!Number.isSafeInteger(Number(row.revision)) || Number(row.revision) < 1) {
      throw new Error(`Cannot capture scenario identity: agent ${agentId} has an invalid revision.`);
    }

    const kind = row.agent_kind as ScenarioSourceAgentKind;
    const counterpart = {
      kind: "scenario_counterpart" as const,
      scenario_counterpart_id: `${scenarioId}:agent:${agentId}`,
      scenario_id: scenarioId,
      source_agent_id: agentId,
      source_agent_kind: kind,
      // The selected cohort policy is human behaviour evidence; it cannot be
      // silently attached to teams, devices, integrations or software actors.
      behaviour_policy_version_id: kind === "human" ? behaviourVersion : null,
    };

    if (kind === "human") {
      if (row.external_ref !== null) {
        throw new Error(`Cannot capture scenario identity: human agent ${agentId} has an external reference.`);
      }
      return {
        source: {
          kind,
          human_agent_id: agentId,
          person_id: requiredIdentityValue(row.person_id, `human agent ${agentId} person ID`),
        },
        delegates: [],
        counterpart,
      };
    }

    if (row.person_id !== null) {
      throw new Error(`Cannot capture scenario identity: ${kind} agent ${agentId} has a person identity.`);
    }
    return {
      source: {
        kind,
        agent_id: agentId,
        external_ref: requiredIdentityValue(row.external_ref, `${kind} agent ${agentId} external reference`),
      },
      delegates: [],
      counterpart,
    };
  });
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function calendarDateInTimezone(instant: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(instant));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isFutureScenarioWindow(
  session: Pick<CampusScenarioSession, "occurrence_date" | "starts_at" | "ends_at">,
  capturedAt: string,
  horizonTo: string,
  timezone: string,
): boolean {
  const localToday = calendarDateInTimezone(capturedAt, timezone);
  return session.occurrence_date > localToday
    && Date.parse(session.starts_at) >= Date.parse(capturedAt) + 15 * 60 * 1_000
    && Date.parse(session.ends_at) <= Date.parse(horizonTo);
}

export function scenarioDateWindows(
  windows: ReadonlyArray<{ date: string; starts_at: string; ends_at: string }>,
): Array<{ date: string; starts_at: string; ends_at: string }> {
  const byDate = new Map<string, { date: string; starts_at: string; ends_at: string }>();
  for (const window of windows) {
    const current = byDate.get(window.date);
    if (!current) {
      byDate.set(window.date, { ...window });
      continue;
    }
    if (Date.parse(window.starts_at) < Date.parse(current.starts_at)) current.starts_at = window.starts_at;
    if (Date.parse(window.ends_at) > Date.parse(current.ends_at)) current.ends_at = window.ends_at;
  }
  return [...byDate.values()].sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));
}

@Injectable()
export class CampusScenarioRepository {
  constructor(private readonly db: DatabaseService) {}

  async hasActiveAdminMembership(userId: string, schoolId: string): Promise<boolean> {
    const row = await this.db.selectFrom("school_memberships")
      .select("id")
      .where("school_id", "=", schoolId)
      .where("user_id", "=", userId)
      .where("role", "=", "admin")
      .where("is_active", "=", true)
      .executeTakeFirst();
    return Boolean(row);
  }

  school(schoolId: string) {
    return this.db.selectFrom("schools")
      .select(["id", "name", "timezone"])
      .where("id", "=", schoolId)
      .executeTakeFirst();
  }

  campuses(schoolId: string) {
    return this.db.selectFrom("institution_campuses")
      .select(["id", "name", "code", "timezone", "is_primary", "revision"])
      .where("school_id", "=", schoolId)
      .where("status", "=", "active")
      .orderBy("is_primary", "desc")
      .orderBy("name")
      .execute();
  }

  async resolveTarget(
    schoolId: string,
    campusId: string,
    type: CampusScenarioInterventionType,
    targetId: string,
    at: string,
  ): Promise<CampusScenarioTarget | null> {
    if (type === "space_unavailable") {
      const space = await this.db.selectFrom("campus_spaces")
        .select(["id", "name", "revision"])
        .where("id", "=", targetId)
        .where("school_id", "=", schoolId)
        .where("campus_id", "=", campusId)
        .where("status", "=", "active")
        .where("is_bookable", "=", true)
        .executeTakeFirst();
      return space ? {
        id: space.id,
        label: space.name,
        type,
        effective_ref: space.id,
        user_id: null,
        person_id: null,
        revision: space.revision,
      } : null;
    }

    const result = await sql<{
      id: string;
      label: string;
      user_id: string | null;
      person_id: string | null;
      revision: number | string;
    }>`SELECT agent.id,agent.label,endpoint.user_id,agent.person_id,agent.revision
      FROM campus_model_agents agent
      JOIN LATERAL (
        SELECT linked.user_id
        FROM campus_model_agent_endpoints linked
        WHERE linked.school_id=agent.school_id AND linked.agent_id=agent.id
          AND linked.endpoint_kind='account' AND linked.provider='thatcampus'
          AND linked.status='active' AND linked.user_id IS NOT NULL
          AND linked.effective_from<=${at}::timestamptz
          AND (linked.effective_until IS NULL OR linked.effective_until>${at}::timestamptz)
        ORDER BY linked.effective_from DESC,linked.id DESC
        LIMIT 1
      ) endpoint ON true
      JOIN staff_profiles profile
        ON profile.school_id=agent.school_id AND profile.person_id=agent.person_id
        AND profile.user_id=endpoint.user_id AND profile.status='active'
      WHERE agent.school_id=${schoolId}::uuid
        AND agent.agent_kind='human' AND agent.status='active'
        AND (agent.id=${targetId}::uuid OR endpoint.user_id=${targetId}::uuid OR profile.id=${targetId}::uuid)
      ORDER BY CASE WHEN agent.id=${targetId}::uuid THEN 0 ELSE 1 END,agent.id
      LIMIT 1`.execute(this.db);
    const agent = result.rows[0];
    if (!agent?.user_id) return null;
    return {
      id: agent.id,
      label: agent.label,
      type,
      effective_ref: agent.user_id,
      user_id: agent.user_id,
      person_id: agent.person_id,
      revision: Number(agent.revision),
    };
  }

  private async schedule(
    schoolId: string,
    campusId: string,
    timezone: string,
    from: string,
    to: string,
    db: Kysely<Database> = this.db,
  ): Promise<CampusScenarioSession[]> {
    const result = await sql<ScheduleRow>`WITH school_days AS (
        SELECT day::date AS school_day
        FROM generate_series(
          (${from}::timestamptz AT TIME ZONE ${timezone})::date,
          ((${to}::timestamptz-interval '1 microsecond') AT TIME ZONE ${timezone})::date,
          interval '1 day'
        ) day
      )
      SELECT schedule.occurrence_key,day.school_day::text AS occurrence_date,
        ((day.school_day+schedule.starts_at) AT TIME ZONE ${timezone}) AS starts_at,
        ((day.school_day+schedule.ends_at) AT TIME ZONE ${timezone}) AS ends_at,
        schedule.class_section_id,human_agent.id AS teacher_agent_id,
        human_agent.person_id AS teacher_person_id,
        (schedule.teacher_user_id IS NOT NULL) AS teacher_assignment_present,
        COALESCE(schedule.space_id,placement.home_space_id) AS space_id,
        selected_space.capacity AS space_capacity,
        COALESCE(roster.expected_count,0)::int AS expected_count,
        schedule.source_kind,schedule.source_revision,schedule.source_version
      FROM school_days day
      CROSS JOIN LATERAL effective_school_schedule_v4(${schoolId}::uuid,day.school_day) schedule
      LEFT JOIN LATERAL (
        SELECT placement.campus_id,placement.home_space_id
        FROM class_campus_placements placement
        WHERE placement.school_id=${schoolId}::uuid
          AND placement.class_section_id=schedule.class_section_id
          AND placement.effective_from<=day.school_day
          AND (placement.effective_until IS NULL OR placement.effective_until>=day.school_day)
        ORDER BY placement.is_primary DESC,placement.effective_from DESC,placement.id DESC
        LIMIT 1
      ) placement ON true
      LEFT JOIN campus_spaces selected_space
        ON selected_space.id=COALESCE(schedule.space_id,placement.home_space_id)
        AND selected_space.school_id=${schoolId}::uuid AND selected_space.status='active'
      LEFT JOIN LATERAL (
        SELECT agent.id,agent.person_id
        FROM campus_model_agent_endpoints endpoint
        JOIN campus_model_agents agent
          ON agent.school_id=endpoint.school_id AND agent.id=endpoint.agent_id
          AND agent.agent_kind='human' AND agent.status='active'
        JOIN staff_profiles profile
          ON profile.school_id=agent.school_id AND profile.person_id=agent.person_id
          AND profile.user_id=endpoint.user_id AND profile.status='active'
        WHERE endpoint.school_id=${schoolId}::uuid
          AND endpoint.endpoint_kind='account' AND endpoint.provider='thatcampus'
          AND endpoint.status='active' AND endpoint.user_id=schedule.teacher_user_id
          AND endpoint.effective_from<=((day.school_day+schedule.starts_at) AT TIME ZONE ${timezone})
          AND (endpoint.effective_until IS NULL
            OR endpoint.effective_until>((day.school_day+schedule.starts_at) AT TIME ZONE ${timezone}))
        ORDER BY endpoint.effective_from DESC,endpoint.id DESC LIMIT 1
      ) human_agent ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS expected_count
        FROM enrollments enrollment
        WHERE enrollment.class_section_id=schedule.class_section_id
          AND enrollment.enrolled_on<=day.school_day
          AND (enrollment.inactive_from IS NULL OR enrollment.inactive_from>day.school_day)
      ) roster ON true
      WHERE NOT schedule.cancelled AND schedule.slot_type IN ('class','activity')
        AND ((day.school_day+schedule.ends_at) AT TIME ZONE ${timezone})>${from}::timestamptz
        AND ((day.school_day+schedule.starts_at) AT TIME ZONE ${timezone})<${to}::timestamptz
        AND (
          selected_space.campus_id=${campusId}::uuid
          OR (schedule.space_id IS NULL AND placement.campus_id=${campusId}::uuid)
        )
      ORDER BY starts_at,schedule.class_section_id,schedule.period_number,schedule.occurrence_key
      LIMIT 5001`.execute(db);

    return result.rows.map((row) => ({
      occurrence_key: row.occurrence_key,
      occurrence_date: row.occurrence_date,
      starts_at: iso(row.starts_at),
      ends_at: iso(row.ends_at),
      class_section_id: row.class_section_id,
      teacher_agent_id: row.teacher_agent_id,
      teacher_person_id: row.teacher_person_id,
      teacher_assignment_present: row.teacher_assignment_present,
      space_id: row.space_id,
      space_capacity: numeric(row.space_capacity),
      expected_count: numeric(row.expected_count) ?? 0,
      source_kind: row.source_kind,
      source_revision: numeric(row.source_revision) ?? 0,
      source_version: numeric(row.source_version),
    }));
  }

  async targetOptions(input: {
    school_id: string;
    campus_id: string;
    timezone: string;
    from: string;
    to: string;
  }) {
    const sessions = await this.schedule(
      input.school_id, input.campus_id, input.timezone, input.from, input.to,
    );
    if (sessions.length > 5_000) {
      return { overflow: true as const, teachers: [], spaces: [] };
    }
    const eligibleSessions = sessions.filter((session) => (
      isFutureScenarioWindow(session, input.from, input.to, input.timezone)
    ));
    const teacherIds = [...new Set(eligibleSessions
      .map((session) => session.teacher_agent_id)
      .filter((id): id is string => Boolean(id)))];
    const spaceIds = [...new Set(eligibleSessions
      .map((session) => session.space_id)
      .filter((id): id is string => Boolean(id)))];
    const datesByTeacher = new Map<string, Set<string>>();
    const datesBySpace = new Map<string, Set<string>>();
    const windowsByTeacher = new Map<string, Array<{ date: string; starts_at: string; ends_at: string }>>();
    const windowsBySpace = new Map<string, Array<{ date: string; starts_at: string; ends_at: string }>>();
    for (const session of eligibleSessions) {
      if (session.teacher_agent_id) {
        const dates = datesByTeacher.get(session.teacher_agent_id) ?? new Set<string>();
        dates.add(session.occurrence_date);
        datesByTeacher.set(session.teacher_agent_id, dates);
        const windows = windowsByTeacher.get(session.teacher_agent_id) ?? [];
        windows.push({
          date: session.occurrence_date,
          starts_at: session.starts_at,
          ends_at: session.ends_at,
        });
        windowsByTeacher.set(session.teacher_agent_id, windows);
      }
      if (session.space_id) {
        const dates = datesBySpace.get(session.space_id) ?? new Set<string>();
        dates.add(session.occurrence_date);
        datesBySpace.set(session.space_id, dates);
        const windows = windowsBySpace.get(session.space_id) ?? [];
        windows.push({
          date: session.occurrence_date,
          starts_at: session.starts_at,
          ends_at: session.ends_at,
        });
        windowsBySpace.set(session.space_id, windows);
      }
    }
    const [teachers, spaces] = await Promise.all([
      teacherIds.length ? this.db.selectFrom("campus_model_agents")
        .select(["id", "label"])
        .where("school_id", "=", input.school_id)
        .where("id", "in", teacherIds)
        .where("agent_kind", "=", "human")
        .where("status", "=", "active")
        .orderBy("label")
        .execute() : Promise.resolve([]),
      spaceIds.length ? this.db.selectFrom("campus_spaces")
        .select(["id", "name as label", "kind", "capacity"])
        .where("school_id", "=", input.school_id)
        .where("campus_id", "=", input.campus_id)
        .where("status", "=", "active")
        .where("is_bookable", "=", true)
        .where("id", "in", spaceIds)
        .orderBy("name")
        .execute() : Promise.resolve([]),
    ]);
    return {
      overflow: false as const,
      teachers: teachers.map((teacher) => {
        const sessionWindows = windowsByTeacher.get(teacher.id) ?? [];
        const dateWindows = scenarioDateWindows(sessionWindows);
        return {
          ...teacher,
          session_dates: [...(datesByTeacher.get(teacher.id) ?? [])].sort(),
          session_windows: sessionWindows,
          date_windows: dateWindows,
          suggested_window: dateWindows[0]
            ? { starts_at: dateWindows[0].starts_at, ends_at: dateWindows[0].ends_at }
            : null,
        };
      }),
      spaces: spaces.map((space) => {
        const sessionWindows = windowsBySpace.get(space.id) ?? [];
        const dateWindows = scenarioDateWindows(sessionWindows);
        return {
          ...space,
          session_dates: [...(datesBySpace.get(space.id) ?? [])].sort(),
          session_windows: sessionWindows,
          date_windows: dateWindows,
          suggested_window: dateWindows[0]
            ? { starts_at: dateWindows[0].starts_at, ends_at: dateWindows[0].ends_at }
            : null,
        };
      }),
    };
  }

  private async approvedScenarioPolicy(
    schoolId: string,
    versionId: string,
    at: string,
    db: Kysely<Database>,
  ) {
    const policy = await db.selectFrom("campus_model_behaviour_versions")
      .select([
        "id", "behaviour_key", "version", "configuration", "effective_from", "effective_until",
        "approved_at", "configuration_schema_version",
      ])
      .where("id", "=", versionId)
      .where("school_id", "=", schoolId)
      .where("status", "=", "approved")
      .where("approved_at", "is not", null)
      .where("effective_from", "<=", new Date(at))
      .where((expression) => expression.or([
        expression("effective_until", "is", null),
        expression("effective_until", ">", new Date(at)),
      ]))
      .executeTakeFirst();
    return policy ? {
      ...policy,
      version: Number(policy.version),
      configuration_schema_version: Number(policy.configuration_schema_version),
      configuration_hash: hash(policy.configuration),
      effective_from: iso(policy.effective_from),
      effective_until: policy.effective_until ? iso(policy.effective_until) : null,
      approved_at: iso(policy.approved_at!),
    } : null;
  }

  private async coverageEvidence(
    schoolId: string,
    capturedAt: string,
    db: Kysely<Database> = this.db,
  ): Promise<CampusScenarioCoverageEvidence> {
    const result = await sql<CoverageEvidenceRow>`WITH response AS (
        SELECT task.id,task.offered_at,first_response.action,first_response.created_at
        FROM staff_coverage_tasks task
        LEFT JOIN LATERAL (
          SELECT audit.action,audit.created_at
          FROM staff_coverage_task_audits audit
          WHERE audit.task_id=task.id AND audit.action IN ('accepted','declined')
          ORDER BY audit.created_at,audit.id LIMIT 1
        ) first_response ON true
        WHERE task.school_id=${schoolId}::uuid AND task.offered_at IS NOT NULL
          AND task.offered_at>${capturedAt}::timestamptz-interval '365 days'
          AND task.offered_at<=${capturedAt}::timestamptz
      )
      SELECT count(*)::int AS offered_count,
        count(created_at)::int AS responded_count,
        count(*) FILTER(WHERE action='accepted')::int AS accepted_count,
        percentile_cont(0.5) WITHIN GROUP(
          ORDER BY EXTRACT(epoch FROM (created_at-offered_at))/60
        ) FILTER(WHERE created_at IS NOT NULL) AS median_response_minutes,
        max(created_at) AS source_max_at
      FROM response`.execute(db);
    const row = result.rows[0] ?? {
      offered_count: 0,
      responded_count: 0,
      accepted_count: 0,
      median_response_minutes: null,
      source_max_at: null,
    };
    const evidence = {
      offered_count: numeric(row.offered_count) ?? 0,
      responded_count: numeric(row.responded_count) ?? 0,
      accepted_count: numeric(row.accepted_count) ?? 0,
      median_response_minutes: numeric(row.median_response_minutes),
      source_max_at: row.source_max_at ? iso(row.source_max_at) : null,
    };
    return {
      ...evidence,
      evidence_hash: evidence.offered_count > 0 ? hash(evidence) : null,
    };
  }

  private async configurationSnapshot(schoolId: string, db: Kysely<Database> = this.db) {
    const result = await sql<ConfigurationRow>`
      SELECT 'operating_rule'::text AS kind,'institution_operating_rules'::text AS key,
        rule.revision,rule.updated_at,to_jsonb(rule)-'school_id'-'updated_by' AS payload
      FROM institution_operating_rules rule WHERE rule.school_id=${schoolId}::uuid
      UNION ALL
      SELECT 'domain_configuration'::text AS kind,'staff_coverage_policy'::text AS key,
        policy.revision,policy.updated_at,to_jsonb(policy)-'school_id'-'updated_by' AS payload
      FROM staff_coverage_policies policy WHERE policy.school_id=${schoolId}::uuid`.execute(db);
    return result.rows.map((row) => ({
      kind: row.kind,
      key: row.key,
      version_id: `${row.key}:r${Number(row.revision)}`,
      configuration_hash: hash(row.payload),
      effective_from: iso(row.updated_at),
      effective_until: null,
    }));
  }

  snapshot(input: SnapshotInput): Promise<CampusScenarioRepositorySnapshot> {
    return this.db.transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute((transaction) => this.snapshotInTransaction(transaction, input));
  }

  private async snapshotInTransaction(
    db: Kysely<Database>,
    input: SnapshotInput,
  ): Promise<CampusScenarioRepositorySnapshot> {
    const [
      sessions,
      coverageEvidence,
      configurationSnapshot,
      spacesMeta,
      activeAgents,
      approvedBehaviourPolicy,
    ] = await Promise.all([
      this.schedule(input.school_id, input.campus_id, input.timezone, input.captured_at, input.horizon_to, db),
      this.coverageEvidence(input.school_id, input.captured_at, db),
      this.configurationSnapshot(input.school_id, db),
      db.selectFrom("campus_spaces")
        .select(({ fn }) => [fn.count<number>("id").as("count"), fn.max<number>("revision").as("revision")])
        .where("school_id", "=", input.school_id)
        .where("campus_id", "=", input.campus_id)
        .where("status", "=", "active")
        .executeTakeFirst(),
      db.selectFrom("campus_model_agents")
        .select(["id", "agent_kind", "person_id", "external_ref", "revision"])
        .where("school_id", "=", input.school_id)
        .where("status", "=", "active")
        .orderBy("id")
        .execute(),
      input.behaviour_policy_version_id
        ? this.approvedScenarioPolicy(
          input.school_id,
          input.behaviour_policy_version_id,
          input.captured_at,
          db,
        )
        : Promise.resolve(null),
    ]);
    const classIds = [...new Set(sessions.map((session) => session.class_section_id))];
    const enrolmentsMeta = classIds.length ? await db.selectFrom("enrollments")
      .select(({ fn }) => [fn.count<number>("student_id").distinct().as("count"), fn.max<number>("revision").as("revision")])
      .where("class_section_id", "in", classIds)
      .where("is_active", "=", true)
      .executeTakeFirst() : null;
    const scheduleRevisionMax = sessions.reduce((maximum, session) => Math.max(maximum, session.source_revision), 0);
    const identities = buildScenarioIdentityMappings({
      scenario_id: input.scenario_id,
      behaviour_policy_version_id: approvedBehaviourPolicy?.id ?? null,
      agents: activeAgents,
    });
    const sourcesById = new Map(identities.map((mapping) => {
      if (!("source" in mapping)) {
        throw new Error("Scenario repository emitted an unsupported legacy identity mapping.");
      }
      const id = mapping.source.kind === "human"
        ? mapping.source.human_agent_id
        : mapping.source.agent_id;
      return [id, mapping.source] as const;
    }));
    const teacherIdentities = new Set<string>();
    for (const session of sessions) {
      if (session.teacher_agent_id && session.teacher_person_id) {
        const source = sourcesById.get(session.teacher_agent_id);
        if (source?.kind !== "human" || source.person_id !== session.teacher_person_id) {
          throw new Error(
            `Cannot capture scenario: scheduled teacher agent ${session.teacher_agent_id} has no matching active human identity.`,
          );
        }
        teacherIdentities.add(session.teacher_agent_id);
      }
    }
    const agentKindCounts = {
      human: 0,
      team: 0,
      device: 0,
      integration: 0,
      software: 0,
    };
    for (const row of activeAgents) {
      agentKindCounts[row.agent_kind] += 1;
    }
    const agentRevisionMax = activeAgents.reduce(
      (maximum, agent) => Math.max(maximum, Number(agent.revision)),
      0,
    );

    return {
      snapshot: {
        kind: "campus_operations_snapshot",
        version: 1,
        school_id: input.school_id,
        campus_id: input.campus_id,
        timezone: input.timezone,
        captured_at: input.captured_at,
        horizon: { from: input.captured_at, to: input.horizon_to },
        sessions,
        coverage_evidence: coverageEvidence,
      },
      target: input.target,
      configuration_snapshot: configurationSnapshot,
      identities,
      source_revisions: {
        schedule: scheduleRevisionMax ? `max:${scheduleRevisionMax}` : "none",
        spaces: spacesMeta?.revision ? `max:${spacesMeta.revision}` : "none",
        agents: agentRevisionMax ? `max:${agentRevisionMax}` : "none",
        enrolments: enrolmentsMeta?.revision ? `max:${enrolmentsMeta.revision}` : "none",
        coverage_evidence: coverageEvidence.evidence_hash ?? "none",
        behaviour_policy: approvedBehaviourPolicy?.configuration_hash ?? "none",
      },
      approved_behaviour_policy: approvedBehaviourPolicy,
      counts: {
        sessions: sessions.length,
        spaces: Number(spacesMeta?.count ?? 0),
        teachers: teacherIdentities.size,
        agents: activeAgents.length,
        agent_kinds: agentKindCounts,
        enrolments: Number(enrolmentsMeta?.count ?? 0),
      },
    };
  }
}
