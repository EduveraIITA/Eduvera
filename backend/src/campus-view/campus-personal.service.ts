import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { campusTimezone } from "../common/campus-timezone.js";
import { executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
import { EXECUTION_CLOCK_PORT, type ExecutionClockPort } from "../campus-model-core/execution-clock.port.js";
import { TEMPORAL_CONTEXT_PORT, type TemporalContextPort } from "../campus-model-core/temporal-context.port.js";
import { DatabaseService } from "../database/database.service.js";
import { WorkspaceRepository } from "../workspace/workspace.repository.js";
import { TeachingSessionContextService } from "../teaching-sessions/teaching-session-context.service.js";
import { ActivityPlanningService } from "../schedule-planning/activity-planning.service.js";
import { FacilitiesService } from "../facilities/facilities.service.js";
import { CampusViewRepository } from "./campus-view.repository.js";
import { CampusScenesService } from "../campus-scenes/campus-scenes.service.js";
import type { CampusPersonalJourney, CampusPersonalPlace, CampusPersonalProjection } from "./campus-personal.contracts.js";
import { projectCampusMotion, type CampusMotionClaimInput } from "./campus-motion.projection.js";

const querySchema = z.object({ campus_id: z.string().uuid().optional() }).strict();
const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const iso = (value: Date | string) => new Date(value).toISOString();

/** Personal application composition over the same effective schedule and owner access checks as Timetable.
 * No roster, observed location or institution-wide operational evidence crosses this boundary. */
@Injectable()
export class CampusPersonalService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repository: CampusViewRepository,
    private readonly workspace: WorkspaceRepository,
    private readonly sessions: TeachingSessionContextService,
    private readonly planning: ActivityPlanningService,
    private readonly facilities: FacilitiesService,
    @Inject(EXECUTION_CLOCK_PORT) private readonly clock: ExecutionClockPort,
    @Inject(TEMPORAL_CONTEXT_PORT) private readonly temporal: TemporalContextPort,
    private readonly scenes: CampusScenesService,
  ) {}

  /** The shared gate runs even when a map caller requests only campus-owned layers. */
  async authorizedContext(user: AuthUser, schoolId: string, rawQuery: unknown) {
    const parsed = querySchema.safeParse(rawQuery);
    if (!z.string().uuid().safeParse(schoolId).success || !parsed.success) {
      throw new BadRequestException("Choose a valid campus. Personal campus context does not accept a person or clock override.");
    }
    const environment = executionEnvironmentStorage.getStore();
    if (!user.is_active || user.active_school_id !== schoolId || environment && environment.institution_id !== schoolId) {
      throw new ForbiddenException("Choose this institution and its current world before opening your campus.");
    }
    // Owner rechecks current account, membership, stable person and selected world.
    const account = await this.sessions.account(this.db, user);
    const campuses = await this.repository.campuses(schoolId);
    const campus = parsed.data.campus_id
      ? campuses.find(item => item.id === parsed.data.campus_id)
      : campuses.find(item => item.is_primary) ?? campuses[0];
    if (parsed.data.campus_id && !campus) throw new NotFoundException("Campus not found in this institution.");
    const reading = this.clock.read({ institution_id: schoolId, time_zone: campusTimezone(campus?.timezone, account.timezone) });
    const snapshot = await this.workspace.load({ user_id: user.id, school_id: schoolId,
      at: reading.instant, execution_environment: environment ?? null });
    if (!snapshot.acting_agent_id || snapshot.acting_agent_id !== account.actor.agent_id) {
      throw new ForbiddenException("Your current campus identity is unavailable.");
    }
    return { account, campus, reading, snapshot: { ...snapshot, acting_agent_id: snapshot.acting_agent_id } };
  }

  async mine(user: AuthUser, schoolId: string, rawQuery: unknown = {}): Promise<CampusPersonalProjection> {
    const { account, campus, reading, snapshot } = await this.authorizedContext(user, schoolId, rawQuery);
    const placeRows = campus ? await this.repository.spaces(schoolId, campus.id) : [];
    const places: CampusPersonalPlace[] = placeRows.map(place => ({ id: place.id, parent_space_id: place.parent_space_id,
      name: place.name, code: place.code, kind: place.kind, capacity: place.capacity }));
    const byId = new Map(places.map(place => [place.id, place]));
    const journeys: CampusPersonalJourney[] = [];
    const motionClaims: CampusMotionClaimInput[] = [];
    let motionLimited = false;
    const limitations = ["Scheduled destinations are expectations, not your measured location."];
    const classes = [...new Set(snapshot.relationships.filter(item => item.relationship === "self" && item.class_section_id)
      .map(item => item.class_section_id!))];

    // Query scope is applied inside the canonical temporal port before its bound.
    // Never request the administrator's entire day then disclose it to a member.
    for (let offset = 0; offset <= 7; offset++) {
      const date = shiftDate(reading.local_date, offset);
      const scope = { school_id: schoolId, date, recorded_as_of: reading.iso_instant };
      const [own, enrolled] = await Promise.all([
        this.temporal.listOperatingDay({ ...scope, responsible_agent_id: snapshot.acting_agent_id }),
        classes.length ? this.temporal.listOperatingDay({ ...scope, class_section_ids: classes }) : Promise.resolve([]),
      ]);
      const planned = [...new Map([...own, ...enrolled].map(item => [item.id, item])).values()]
        .filter(item => item.slot_type === "class")
        .sort((left, right) => Date.parse(iso(left.starts_at)) - Date.parse(iso(right.starts_at)) || left.id.localeCompare(right.id));
      const earlier = offset === 0 ? planned.filter(item => Date.parse(iso(item.ends_at)) <= reading.instant.getTime()) : [];
      const future = planned.filter(item => Date.parse(iso(item.ends_at)) > reading.instant.getTime());
      if (offset === 0 && (own.length >= 500 || enrolled.length >= 500 || earlier.length > 20 || future.length > 20)) motionLimited = true;
      // Retain bounded previous context for a planned transfer without changing
      // the existing current/upcoming cards or disclosing another person's day.
      for (const occurrence of [...earlier.slice(-20), ...future.slice(0, 20)]) {
        let opened: Awaited<ReturnType<TeachingSessionContextService["openExpected"]>>;
        try {
          opened = await this.sessions.openExpected(user, date, { class_section_id: occurrence.class_domain_id,
            period_number: String(occurrence.period_number) });
        } catch (error) {
          // Current enrollment/cover authority may have changed since projection.
          if (error instanceof ForbiddenException || error instanceof NotFoundException) continue;
          throw error;
        }
        if (opened.space_id && !byId.has(opened.space_id)) continue;
        if (offset === 0) motionClaims.push({ identity: account.actor.person_id, kind: "self", occurrence_id: `session:${opened.id}`,
          space_id: opened.space_id, starts_at: opened.starts_at, ends_at: opened.ends_at, expected_count: 1,
          source: { domain: occurrence.source_domain, record_id: opened.source_record_id, revision: opened.source_revision } });
        if (Date.parse(opened.ends_at) <= reading.instant.getTime()) continue;
        const current = Date.parse(opened.starts_at) <= reading.instant.getTime();
        journeys.push({ id: `session:${opened.id}`, kind: "teaching_session", title: occurrence.subject_label ?? occurrence.title,
          detail: occurrence.class_label, starts_at: opened.starts_at, ends_at: opened.ends_at,
          state: current ? "in_progress" : "upcoming", space_id: opened.space_id,
          place_label: opened.space_id ? byId.get(opened.space_id)!.name : opened.place_label,
          target_path: opened.href, action_label: "Open session", dimension: "expected", spatial_claim: "expected_context_only",
          source: { domain: occurrence.source_domain, record_id: opened.source_record_id, revision: opened.source_revision,
            label: occurrence.source_domain === "day_plan" ? "Published day plan" : "Published timetable" } });
      }
      // Find the next teaching day without retaining a semester's schedule.
      if (journeys.some(item => item.state === "upcoming")) break;
    }

    const native = await this.planning.ensureOccurrences(schoolId, shiftDate(reading.local_date, -1), shiftDate(reading.local_date, 7), undefined, { source: "activity" });
    for (const occurrence of native) {
      if (occurrence.source !== "activity" || occurrence.state !== "expected"
        || !occurrence.participants.some(person => person.person_id === account.actor.person_id)) continue;
      if (occurrence.space_id && !byId.has(occurrence.space_id)) continue;
      const ended = Date.parse(occurrence.ends_at) <= reading.instant.getTime();
      const motionDay = occurrence.local_date === reading.local_date
        || Date.parse(occurrence.starts_at) <= reading.instant.getTime() && !ended;
      if (ended && !motionDay) continue;
      const current = Date.parse(occurrence.starts_at) <= reading.instant.getTime();
      let href = `/areas/timetable/schedule?${new URLSearchParams({ date: occurrence.local_date }).toString()}`;
      let actionLabel = "Open timetable";
      let motionBasis = { space_id: occurrence.space_id, starts_at: occurrence.starts_at, ends_at: occurrence.ends_at,
        record_id: occurrence.plan_version_id ?? occurrence.source_ref, revision: occurrence.source_revision };
      if (occurrence.purpose === "teaching") {
        try {
          const opened = await this.sessions.openExpected(user, occurrence.local_date, { occurrence_id: occurrence.id });
          if (opened.space_id && !byId.has(opened.space_id)) continue;
          href = opened.href; actionLabel = "Open session";
          motionBasis = { space_id: opened.space_id, starts_at: opened.starts_at, ends_at: opened.ends_at,
            record_id: opened.source_record_id, revision: opened.source_revision };
        }
        catch (error) { if (error instanceof ForbiddenException || error instanceof NotFoundException) continue; throw error; }
      }
      if (motionDay) motionClaims.push({ identity: account.actor.person_id, kind: "self", occurrence_id: `activity:${occurrence.id}`,
        space_id: motionBasis.space_id, starts_at: motionBasis.starts_at, ends_at: motionBasis.ends_at, expected_count: 1,
        source: { domain: "timetable", record_id: motionBasis.record_id, revision: motionBasis.revision } });
      if (ended) continue;
      journeys.push({ id: `activity:${occurrence.id}`, kind: occurrence.purpose === "teaching" ? "teaching_session" : "activity",
        title: occurrence.title, detail: "Your scheduled activity", starts_at: occurrence.starts_at, ends_at: occurrence.ends_at,
        state: current ? "in_progress" : "upcoming", space_id: occurrence.space_id,
        place_label: occurrence.space_id ? byId.get(occurrence.space_id)!.name : occurrence.space_label || occurrence.location_label || null,
        target_path: href, action_label: actionLabel, dimension: "expected", spatial_claim: "expected_context_only",
        source: { domain: "timetable", record_id: occurrence.plan_version_id ?? occurrence.source_ref, revision: occurrence.source_revision, label: "Published activity plan" } });
    }

    // Exact scoped duty, never a gate inferred from a job title or building label.
    for (const assignment of snapshot.assignments) {
      if (!assignment.action_key.startsWith("gate.") || assignment.scope.kind !== "space" || !assignment.scope.id || !byId.has(assignment.scope.id)) continue;
      const place = byId.get(assignment.scope.id)!;
      journeys.push({ id: `responsibility:${assignment.id}`, kind: "responsibility", title: place.name, detail: "Your assigned entry point",
        starts_at: null, ends_at: null, state: "assigned", space_id: place.id, place_label: place.name,
        target_path: "/areas/in-out/operate", action_label: "Open entry operations", dimension: "accepted", spatial_claim: "assigned_work_only",
        source: { domain: assignment.source_domain, record_id: assignment.source_record_id, revision: assignment.source_revision,
          label: "Effective responsibility" } });
    }
    const repairWork = await this.facilities.work(user, schoolId, campus ? { campus_id: campus.id } : {});
    for (const work of repairWork.needs_me.filter(item => item.owner.user_id === user.id).slice(0, 10)) {
      try {
        const repair = await this.facilities.detail(user, schoolId, work.repair_id);
        if (repair.recovery_only || repair.access_transferred || repair.state === "closed") continue;
        if (repair.space_id && !byId.has(repair.space_id)) continue;
        journeys.push({ id: `repair:${repair.id}`, kind: "repair", title: repair.title, detail: work.title,
          starts_at: null, ends_at: null, state: "assigned", space_id: repair.space_id,
          place_label: repair.space_id ? byId.get(repair.space_id)!.name : null,
          target_path: work.href, action_label: work.action === "verify" ? "Check repair" : "Open repair",
          dimension: "accepted", spatial_claim: "assigned_work_only", source: { domain: "facilities", record_id: repair.id,
            revision: repair.revision, label: "Assigned repair" } });
      } catch (error) { if (error instanceof ForbiddenException || error instanceof NotFoundException) continue; throw error; }
    }
    const timed = journeys.filter(item => item.starts_at).sort((left, right) => left.starts_at!.localeCompare(right.starts_at!) || left.id.localeCompare(right.id));
    const now = timed.filter(item => item.state === "in_progress").slice(0, 5);
    const future = timed.filter(item => item.state === "upcoming");
    const next = future.filter(item => item.starts_at === future[0]?.starts_at).slice(0, 5);
    const destinations = [...new Map([...now, ...future, ...journeys.filter(item => item.state === "assigned")]
      .map(item => [item.id, item])).values()].slice(0, 20);
    // Published geometry is the member directory. Additional exact places are
    // disclosed only for this person's own entitled destinations, with ancestry.
    const publication = campus ? await this.scenes.published(user, schoolId, campus.id) : null;
    const visible = new Set<string>();
    for (const id of [...(publication?.places.map(place => place.id) ?? []), ...destinations.flatMap(item => item.space_id ? [item.space_id] : []),
      ...motionClaims.flatMap(item => item.space_id ? [item.space_id] : [])]) {
      let current: string | null = id;
      while (current && !visible.has(current) && byId.has(current)) {
        visible.add(current); current = byId.get(current)!.parent_space_id;
      }
    }
    if (destinations.some(item => !item.space_id)) limitations.push("Some destinations have no exact mapped campus place yet.");
    if (!campus) limitations.push("No active campus is configured.");
    const motion = projectCampusMotion({ school_id: schoolId, campus_id: campus?.id ?? null, viewer_user_id: user.id,
      as_of: reading.iso_instant, environment: { kind: reading.environment_kind, namespace_id: reading.namespace_id },
      space_ids: visible, claims: motionClaims, source_limited: motionLimited });
    return { schema_version: 1, school_id: schoolId, campus_id: campus?.id ?? null, as_of: reading.iso_instant,
      local_date: reading.local_date, timezone: reading.time_zone, environment: { kind: reading.environment_kind, namespace_id: reading.namespace_id },
      freshness: { status: "current", as_of: reading.iso_instant }, places: places.filter(place => visible.has(place.id)), now, next, destinations, motion, limitations };
  }
}
