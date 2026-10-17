import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { AuthUser } from "../common/request.js";
import {
  CampusViewKpiRepository,
  type CampusKpiAggregateRow,
  type CampusKpiRepositoryQuery,
} from "./campus-view-kpi.repository.js";
import { CampusViewRepository } from "./campus-view.repository.js";
import {
  CAMPUS_KPI_CATALOGUE,
  CAMPUS_KPI_CATALOGUE_VERSION,
  CAMPUS_KPI_SCHEMA_VERSION,
  campusKpiPages,
  campusKpiQuerySchema,
  type CampusKpiAvailability,
  type CampusKpiDefinition,
  type CampusKpiGrain,
  type CampusKpiRange,
} from "./kpi-contracts.js";

const overviewKeys = [
  "teaching.sessions_planned",
  "attendance.register_completion_rate",
  "coordination.work_open",
  "access.gate_entries_recorded",
  "coordination.work_overdue",
  "access.gate_exits_recorded",
  "attendance.recording_coverage",
] as const;

const overviewHeadlineKeys = overviewKeys.slice(0, 4);

const bottleneckCoverageKeys = [
  "teaching.teacher_assignment_rate",
  "attendance.register_completion_rate",
  "spaces.over_capacity_sessions",
  "spaces.double_booking_conflicts",
  "spaces.missing_canonical_space",
  "coordination.work_overdue",
  "coordination.exceptions_open",
  "evidence.observations_waiting",
] as const;

const latestGaugeKeys = new Set([
  "attendance.evidence_review_backlog",
  "spaces.planned_active",
  "access.visitors_inside",
  "coordination.work_open",
  "coordination.work_overdue",
  "coordination.exceptions_open",
  "evidence.observations_waiting",
]);

const peakKeys = new Set([
  "people.teachers_expected",
  "access.people_observed_distinct",
]);

const ratioKeys = new Set([
  "teaching.teacher_assignment_rate",
  "attendance.register_completion_rate",
  "attendance.recording_coverage",
  "attendance.participation_rate",
  "attendance.late_rate",
  "spaces.planned_use_rate",
  "spaces.planned_seat_load_rate",
  "coordination.response_rate",
  "coordination.failure_rate",
  "evidence.command_conflict_failure_rate",
]);

const nonAdditiveKeys = new Set(["coordination.median_response_minutes"]);

export interface CampusKpiWindow {
  from: string;
  to: string;
  grain: CampusKpiGrain;
  label: string;
}

function localParts(instant: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function zonedMidnightUtc(year: number, month: number, day: number, timezone: string): Date {
  const desired = Date.UTC(year, month - 1, day);
  let guess = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
    guess += desired - rendered;
  }
  return new Date(guess);
}

export function resolveCampusKpiWindow(range: CampusKpiRange, asOf: string, timezone: string): CampusKpiWindow {
  const end = new Date(asOf);
  const local = localParts(end, timezone);
  const localDate = new Date(Date.UTC(local.year, local.month - 1, local.day));
  const days = range === "today" ? 1 : range === "7d" ? 7 : range === "30d" ? 30 : range === "90d" ? 90 : 365;
  localDate.setUTCDate(localDate.getUTCDate() - (days - 1));
  const from = zonedMidnightUtc(
    localDate.getUTCFullYear(), localDate.getUTCMonth() + 1, localDate.getUTCDate(), timezone,
  );
  const grain: CampusKpiGrain = range === "today" ? "15_minute"
    : range === "7d" || range === "30d" ? "hour" : "day";
  return {
    from: from.toISOString(),
    to: end.toISOString(),
    grain,
    label: grain === "15_minute" ? "15-minute" : grain === "hour" ? "Hourly" : "Daily",
  };
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function worstAvailability(rows: CampusKpiAggregateRow[]): CampusKpiAvailability {
  if (rows.every((row) => row.availability === "unavailable")) return "unavailable";
  if (rows.some((row) => row.availability !== "available")) return "partial";
  return "available";
}

function rollup(key: string, rows: CampusKpiAggregateRow[]) {
  if (!rows.length) return { value: null, numerator: null, denominator: null, unknown_count: 0 };
  const unknownCount = rows.reduce((sum, row) => sum + (numeric(row.unknown_count) ?? 0), 0);
  if (latestGaugeKeys.has(key) || nonAdditiveKeys.has(key)) {
    const latest = [...rows].reverse().find((row) => numeric(row.value) !== null) ?? rows.at(-1)!;
    return {
      value: numeric(latest.value), numerator: numeric(latest.numerator),
      denominator: numeric(latest.denominator), unknown_count: numeric(latest.unknown_count) ?? 0,
    };
  }
  if (peakKeys.has(key)) {
    const values = rows.map((row) => numeric(row.value)).filter((value): value is number => value !== null);
    return { value: values.length ? Math.max(...values) : null, numerator: null, denominator: null, unknown_count: unknownCount };
  }
  if (ratioKeys.has(key)) {
    const numerator = rows.reduce((sum, row) => sum + (numeric(row.numerator) ?? 0), 0);
    const denominator = rows.reduce((sum, row) => sum + (numeric(row.denominator) ?? 0), 0);
    return { value: denominator > 0 ? numerator * 100 / denominator : null, numerator, denominator, unknown_count: unknownCount };
  }
  const values = rows.map((row) => numeric(row.value)).filter((value): value is number => value !== null);
  return {
    value: values.length ? values.reduce((sum, value) => sum + value, 0) : null,
    numerator: rows.reduce((sum, row) => sum + (numeric(row.numerator) ?? 0), 0),
    denominator: null,
    unknown_count: unknownCount,
  };
}

function targetPath(key: string): string | null {
  if (key.startsWith("attendance.")) return "/principal/attendance";
  if (key.startsWith("teaching.") || key.startsWith("people.teacher")) return "/principal/timetable";
  if (key.startsWith("spaces.")) return "/principal/administration?section=campus";
  if (key.startsWith("access.")) return "/principal/gate";
  if (key.startsWith("coordination.")) return "/principal/requests";
  return null;
}

function metricFromRows(definition: CampusKpiDefinition, rows: CampusKpiAggregateRow[]) {
  if (!rows.length) {
    return {
      key: definition.key,
      label: definition.label,
      description: definition.description,
      unit: definition.unit,
      value: null,
      numerator: null,
      denominator: null,
      unknown_count: 0,
      availability: "unavailable" as const,
      scope: definition.key === "access.visitors_inside" || definition.page === "coordination" || definition.page === "data_health"
        ? "institution" as const : "selected_campus" as const,
      evidence_dimensions: [...definition.input_dimensions],
      source_label: definition.source_label,
      source_max_at: null,
      unavailable_reason: "The current durable records do not support this metric for the selected period.",
      target_path: targetPath(definition.key),
      series: [],
    };
  }
  const total = rollup(definition.key, rows);
  const availability = (ratioKeys.has(definition.key) && !(total.denominator && total.denominator > 0))
    || (nonAdditiveKeys.has(definition.key) && total.value === null)
    ? "unavailable" as const : worstAvailability(rows);
  const sourceTimes = rows.filter((row) => row.source_max_at).map((row) => Date.parse(iso(row.source_max_at!)));
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    unit: definition.unit,
    ...total,
    availability,
    scope: definition.key === "access.visitors_inside" || definition.page === "coordination" || definition.page === "data_health"
      ? "institution" as const : "selected_campus" as const,
    evidence_dimensions: [...definition.input_dimensions],
    source_label: definition.source_label,
    source_max_at: sourceTimes.length ? new Date(Math.max(...sourceTimes)).toISOString() : null,
    unavailable_reason: availability === "unavailable"
      ? "No eligible source records exist for this metric in the selected period."
      : null,
    target_path: targetPath(definition.key),
    ...(definition.key === "coordination.median_response_minutes"
      ? { value_context: "latest_interval_with_response_evidence" as const } : {}),
    series: rows.map((row) => ({
      bucket_start: iso(row.bucket_start),
      bucket_end: iso(row.bucket_end),
      value: numeric(row.value),
      numerator: numeric(row.numerator),
      denominator: numeric(row.denominator),
      unknown_count: numeric(row.unknown_count) ?? 0,
    })),
  };
}

function withOverviewSnapshot(
  metric: ReturnType<typeof metricFromRows>,
  snapshot: CampusKpiAggregateRow | undefined,
) {
  const label = metric.key === "teaching.sessions_planned" ? "Active planned sessions"
    : metric.key === "access.gate_entries_recorded" ? "Gate entries · last 15 min"
      : metric.key === "access.gate_exits_recorded" ? "Gate exits · last 15 min"
        : metric.key === "attendance.register_completion_rate" ? "Due registers completed"
          : metric.label;
  if (!snapshot) return { ...metric, label };
  return {
    ...metric,
    label,
    value: numeric(snapshot.value),
    numerator: numeric(snapshot.numerator),
    denominator: numeric(snapshot.denominator),
    unknown_count: numeric(snapshot.unknown_count) ?? 0,
    availability: snapshot.availability,
    source_max_at: snapshot.source_max_at ? iso(snapshot.source_max_at) : metric.source_max_at,
    value_context: metric.key === "teaching.sessions_planned" ? "active_at_as_of"
      : metric.key.startsWith("access.gate_") ? "trailing_15_minutes" : "selected_period",
  };
}

interface BottleneckMetric {
  key: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  unknown_count: number;
  availability: CampusKpiAvailability;
  scope: "selected_campus" | "institution";
  evidence_dimensions: Array<"expected" | "observed" | "accepted">;
  source_label: string;
  target_path: string | null;
}

function bottlenecks(metrics: BottleneckMetric[]) {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric]));
  const rows: Array<{
    id: string; label: string; detail: string; count: number; severity: "review" | "important";
    scope: "selected_campus" | "institution"; evidence_dimension: "expected" | "observed" | "accepted" | "unknown";
    source_label: string; target_path: string | null;
  }> = [];
  const add = (key: string, label: string, count: number, severity: "review" | "important", detail: string) => {
    if (!(count > 0)) return;
    const metric = byKey.get(key);
    rows.push({
      id: key, label, detail, count, severity,
      scope: metric?.scope ?? "institution",
      evidence_dimension: metric?.evidence_dimensions[0] ?? "unknown",
      source_label: metric?.source_label ?? "Evidence unavailable",
      target_path: metric?.target_path ?? null,
    });
  };
  const assignment = byKey.get("teaching.teacher_assignment_rate");
  add("teaching.teacher_assignment_rate", "Sessions need a teacher",
    Math.max(0, (assignment?.denominator ?? 0) - (assignment?.numerator ?? 0)), "important",
    "Effective scheduled sessions do not have a responsible teacher.");
  const completion = byKey.get("attendance.register_completion_rate");
  add("attendance.register_completion_rate", "Registers remain incomplete",
    Math.max(0, (completion?.denominator ?? 0) - (completion?.numerator ?? 0) - (completion?.unknown_count ?? 0)), "important",
    "Ended scheduled sessions still have a draft register.");
  add("spaces.over_capacity_sessions", "Planned sessions exceed capacity",
    byKey.get("spaces.over_capacity_sessions")?.value ?? 0, "important",
    "The effective roster is larger than the room capacity recorded now.");
  add("spaces.double_booking_conflicts", "Spaces are double-booked",
    byKey.get("spaces.double_booking_conflicts")?.value ?? 0, "important",
    "Effective scheduled sessions overlap in the same canonical space.");
  add("spaces.missing_canonical_space", "Sessions need a mapped space",
    byKey.get("spaces.missing_canonical_space")?.value ?? 0, "review",
    "Physical sessions cannot be placed on the campus map without a canonical space.");
  add("coordination.work_overdue", "Actionable work is overdue",
    byKey.get("coordination.work_overdue")?.value ?? 0, "important",
    "Requests, tasks or offers have passed their configured response time.");
  add("coordination.exceptions_open", "Coordination routes need review",
    byKey.get("coordination.exceptions_open")?.value ?? 0, "important",
    "A configured recipient or behaviour could not be resolved.");
  add("evidence.observations_waiting", "Evidence is waiting for review",
    byKey.get("evidence.observations_waiting")?.value ?? 0, "review",
    "Pending or quarantined observations have not received a domain decision.");
  const unavailableCoverage = bottleneckCoverageKeys.filter((key) => byKey.get(key)?.availability === "unavailable");
  if (unavailableCoverage.length) {
    rows.push({
      id: "evidence.kpi_coverage_unknown",
      label: "Operational evidence is unavailable",
      detail: "One or more bottleneck sources cannot establish whether operations are clear. Missing evidence is not a zero.",
      count: unavailableCoverage.length,
      severity: "review",
      scope: "institution",
      evidence_dimension: "unknown",
      source_label: "Campus KPI source coverage",
      target_path: null,
    });
  }
  return rows.sort((left, right) =>
    Number(right.severity === "important") - Number(left.severity === "important") || right.count - left.count,
  ).slice(0, 8);
}

@Injectable()
export class CampusViewKpiService {
  constructor(
    private readonly campusViewRepository: CampusViewRepository,
    private readonly repository: CampusViewKpiRepository,
  ) {}

  async view(
    user: AuthUser,
    schoolId: string,
    rawQuery: { campus_id?: string; page?: string; range?: string; at?: string },
  ) {
    const parsed = campusKpiQuerySchema.safeParse({ school_id: schoolId, ...rawQuery });
    if (!parsed.success) throw new BadRequestException("Choose a valid campus, KPI page, range and ISO date/time.");
    const query = parsed.data;
    if (!(await this.campusViewRepository.hasActiveAdminMembership(user.id, query.school_id))) {
      throw new ForbiddenException("An active institution administrator membership is required.");
    }
    const [school, campuses] = await Promise.all([
      this.campusViewRepository.school(query.school_id),
      this.campusViewRepository.campuses(query.school_id),
    ]);
    if (!school) throw new NotFoundException("Institution not found.");
    const campus = query.campus_id
      ? campuses.find((item) => item.id === query.campus_id)
      : campuses.find((item) => item.is_primary) ?? campuses[0];
    if (query.campus_id && !campus) throw new NotFoundException("Campus not found in this institution.");

    const generatedAt = new Date().toISOString();
    const asOf = query.at ?? generatedAt;
    const timezone = campus?.timezone || school.timezone || "Asia/Kolkata";
    const window = resolveCampusKpiWindow(query.range, asOf, timezone);
    const definitions = query.page === "overview"
      ? CAMPUS_KPI_CATALOGUE
      : CAMPUS_KPI_CATALOGUE.filter((definition) => definition.page === query.page);

    let rawRows: CampusKpiAggregateRow[] = [];
    let overviewSnapshots: CampusKpiAggregateRow[] = [];
    if (campus) {
      const repositoryQuery: CampusKpiRepositoryQuery = {
        school_id: query.school_id,
        campus_id: campus.id,
        timezone,
        from_at: window.from,
        to_at: window.to,
        as_of: asOf,
        grain: window.grain,
      };
      if (query.page === "overview") {
        const pages = ["teaching", "movement", "spaces", "coordination", "data_health"] as const;
        const [series, attendanceBacklog, snapshots] = await Promise.all([
          Promise.all(pages.map((page) => this.repository.series(page, repositoryQuery))),
          this.repository.attendanceEvidenceBacklog(repositoryQuery),
          this.repository.overviewSnapshots(repositoryQuery),
        ]);
        rawRows = series.flat();
        overviewSnapshots = snapshots;
        if (attendanceBacklog) rawRows.push(attendanceBacklog);
      } else {
        rawRows = await this.repository.series(query.page, repositoryQuery);
        if (query.page === "teaching") {
          const attendanceBacklog = await this.repository.attendanceEvidenceBacklog(repositoryQuery);
          if (attendanceBacklog) rawRows.push(attendanceBacklog);
        }
      }
    }

    const rowsByKey = new Map<string, CampusKpiAggregateRow[]>();
    for (const row of rawRows) {
      const rows = rowsByKey.get(row.metric_key) ?? [];
      rows.push(row);
      rowsByKey.set(row.metric_key, rows);
    }
    const snapshotByKey = new Map(overviewSnapshots.map((row) => [row.metric_key, row]));
    let allMetrics = definitions.map((definition) => {
      const metric = metricFromRows(definition, rowsByKey.get(definition.key) ?? []);
      return query.page === "overview" ? withOverviewSnapshot(metric, snapshotByKey.get(metric.key)) : metric;
    });
    if (query.page === "overview") {
      const overdue = allMetrics.find((metric) => metric.key === "coordination.work_overdue");
      allMetrics = allMetrics.map((metric) => metric.key === "coordination.work_open" ? {
        ...metric,
        label: "Open actionable work",
        value_context: "current_at_as_of" as const,
        secondary: {
          key: "coordination.work_overdue",
          label: "Overdue",
          value: overdue?.value ?? null,
          availability: overdue?.availability ?? "unavailable",
        },
      } : metric);
    }
    const metrics = query.page === "overview"
      ? overviewKeys.map((key) => allMetrics.find((metric) => metric.key === key)!).filter(Boolean)
      : allMetrics;
    const completion = allMetrics.find((metric) => metric.key === "attendance.register_completion_rate");
    const composition = completion?.denominator && completion.denominator > 0 ? [
      { key: "completed", label: "Completed", value: completion.numerator ?? 0, tone: "accepted" as const },
      { key: "outstanding", label: "Outstanding", value: Math.max(0,
        completion.denominator-(completion.numerator ?? 0)-completion.unknown_count), tone: "review" as const },
      { key: "unknown", label: "Unknown", value: completion.unknown_count, tone: "unknown" as const },
    ] : [];
    const headlines = query.page === "overview" ? overviewHeadlineKeys.map((key) => {
      const metric = allMetrics.find((item) => item.key === key)!;
      return {
        key: metric.key,
        label: metric.label,
        value: metric.value,
        unit: metric.unit,
        availability: metric.availability,
        value_context: "value_context" in metric ? metric.value_context : "selected_period",
        ...("secondary" in metric ? { secondary: metric.secondary } : {}),
      };
    }) : [];

    return {
      schema_version: CAMPUS_KPI_SCHEMA_VERSION,
      catalogue_version: CAMPUS_KPI_CATALOGUE_VERSION,
      catalogue: CAMPUS_KPI_CATALOGUE,
      available_pages: campusKpiPages,
      page: query.page,
      range: query.range,
      generated_at: generatedAt,
      period: { from: window.from, to: window.to, timezone },
      bucket: { kind: window.grain, label: window.label },
      scope: { campus_id: campus?.id ?? null, campus_label: campus?.name ?? "No campus configured" },
      metrics,
      ...(query.page === "overview" ? {
        overview: {
          headline_keys: overviewHeadlineKeys,
          headlines,
          evidence_state: overviewHeadlineKeys.every((key) => allMetrics.find((metric) => metric.key === key)?.availability === "unavailable")
            ? "unavailable"
            : [...new Set([...overviewHeadlineKeys, ...bottleneckCoverageKeys])]
              .some((key) => allMetrics.find((metric) => metric.key === key)?.availability !== "available")
              ? "partial" : "available",
          composition: { label: "Due attendance registers", unit: "registers", slices: composition },
          bottlenecks: bottlenecks(allMetrics),
        },
      } : {}),
    };
  }
}
