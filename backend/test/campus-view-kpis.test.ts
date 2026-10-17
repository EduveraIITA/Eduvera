import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { CampusViewController } from "../src/campus-view/campus-view.controller.js";
import type {
  CampusKpiAggregateRow,
  CampusViewKpiRepository,
} from "../src/campus-view/campus-view-kpi.repository.js";
import {
  CampusViewKpiService,
  resolveCampusKpiWindow,
} from "../src/campus-view/campus-view-kpi.service.js";
import type { CampusViewRepository } from "../src/campus-view/campus-view.repository.js";
import type { CampusViewService } from "../src/campus-view/campus-view.service.js";

const ids = {
  school: "10000000-0000-4000-8000-000000000001",
  campus: "20000000-0000-4000-8000-000000000002",
  otherCampus: "20000000-0000-4000-8000-000000000099",
  user: "30000000-0000-4000-8000-000000000003",
};
const user = { id: ids.user, role: "admin" } as AuthUser;

function row(
  metricKey: string,
  value: number | null,
  numerator: number | null = value,
  denominator: number | null = null,
  bucketStart = "2026-10-17T03:30:00.000Z",
): CampusKpiAggregateRow {
  return {
    metric_key: metricKey,
    bucket_start: bucketStart,
    bucket_end: new Date(Date.parse(bucketStart) + 15 * 60_000).toISOString(),
    value,
    numerator,
    denominator,
    unknown_count: 0,
    availability: "available",
    source_max_at: bucketStart,
  };
}

function dependencies(options: { authorized?: boolean; noCampus?: boolean } = {}) {
  const hasActiveAdminMembership = vi.fn().mockResolvedValue(options.authorized ?? true);
  const school = vi.fn().mockResolvedValue({ id: ids.school, name: "Cambridge International School", code: "CIS", timezone: "Asia/Kolkata" });
  const campuses = vi.fn().mockResolvedValue(options.noCampus ? [] : [{
    id: ids.campus, name: "Main", code: "MAIN", campus_type: "main", is_primary: true,
    timezone: "Asia/Kolkata", revision: 1,
  }]);
  const campusViewRepository = {
    hasActiveAdminMembership,
    school,
    campuses,
  } as unknown as CampusViewRepository;
  const series = vi.fn().mockImplementation((page: string) => {
    if (page === "teaching") return Promise.resolve([
      row("teaching.sessions_planned", 3),
      row("attendance.register_completion_rate", 50, 1, 2, "2026-10-17T03:30:00.000Z"),
      row("attendance.register_completion_rate", 90, 9, 10, "2026-10-17T03:45:00.000Z"),
      row("attendance.recording_coverage", 80, 20, 25),
    ]);
    if (page === "spaces") return Promise.resolve([row("spaces.over_capacity_sessions", 2)]);
    if (page === "movement") return Promise.resolve([
      row("access.gate_entries_recorded", 18), row("access.gate_exits_recorded", 4),
    ]);
    if (page === "coordination") return Promise.resolve([
      row("coordination.work_open", 5), row("coordination.work_overdue", 2),
    ]);
    return Promise.resolve([row("evidence.observations_waiting", 3)]);
  });
  const attendanceEvidenceBacklog = vi.fn().mockResolvedValue(null);
  const overviewSnapshots = vi.fn().mockResolvedValue([
    row("teaching.sessions_planned", 1),
    row("access.gate_entries_recorded", 7),
    row("access.gate_exits_recorded", 2),
  ]);
  const repository = {
    series,
    attendanceEvidenceBacklog,
    overviewSnapshots,
  } as unknown as CampusViewKpiRepository;
  return {
    service: new CampusViewKpiService(campusViewRepository, repository),
    campusViewRepository,
    repository,
    mocks: { hasActiveAdminMembership, school, campuses, series, attendanceEvidenceBacklog, overviewSnapshots },
  };
}

describe("Campus View KPI contract", () => {
  it("uses campus-local day boundaries and adaptive grains", () => {
    expect(resolveCampusKpiWindow("today", "2026-10-17T04:00:00.000Z", "Asia/Kolkata")).toEqual({
      from: "2026-10-16T18:30:00.000Z",
      to: "2026-10-17T04:00:00.000Z",
      grain: "15_minute",
      label: "15-minute",
    });
    expect(resolveCampusKpiWindow("7d", "2026-10-17T04:00:00.000Z", "Asia/Kolkata").grain).toBe("hour");
    expect(resolveCampusKpiWindow("30d", "2026-10-17T04:00:00.000Z", "Asia/Kolkata").grain).toBe("hour");
    expect(resolveCampusKpiWindow("1y", "2026-10-17T04:00:00.000Z", "Asia/Kolkata").grain).toBe("day");
  });

  it("publishes the stable school-scoped read-only KPI route", () => {
    const handler = Object.getOwnPropertyDescriptor(CampusViewController.prototype, "kpis")?.value as object;
    expect(Reflect.getMetadata(PATH_METADATA, CampusViewController)).toBe("api/v1/schools/:schoolId/campus-view");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("/kpis");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it("forwards only the selected read query", async () => {
    const kpis = vi.fn().mockResolvedValue({ schema_version: 1 });
    const controller = new CampusViewController(
      {} as CampusViewService,
      { view: kpis } as unknown as CampusViewKpiService,
    );
    await controller.kpis(
      { authUser: user } as AuthenticatedRequest,
      ids.school,
      ids.campus,
      "spaces",
      "90d",
      "2026-10-17T04:00:00.000Z",
    );
    expect(kpis).toHaveBeenCalledWith(user, ids.school, {
      campus_id: ids.campus, page: "spaces", range: "90d", at: "2026-10-17T04:00:00.000Z",
    });
  });

  it("keeps overview bounded, exposes 30 versioned definitions and aggregates ratios from counts", async () => {
    const { service } = dependencies();
    const result = await service.view(user, ids.school, {
      campus_id: ids.campus, page: "overview", range: "today", at: "2026-10-17T04:00:00.000Z",
    });
    expect(result.catalogue).toHaveLength(30);
    expect(result.catalogue_version).toBe("2026-10-17.v1");
    expect(result.metrics).toHaveLength(7);
    expect(result.overview?.headline_keys).toHaveLength(4);
    expect(result.overview?.headline_keys).toContain("access.gate_entries_recorded");
    expect(result.overview?.headlines[2]).toMatchObject({
      key: "coordination.work_open",
      value: 5,
      value_context: "current_at_as_of",
      secondary: { key: "coordination.work_overdue", value: 2 },
    });
    expect(result.metrics.find((metric) => metric.key === "teaching.sessions_planned")).toMatchObject({
      label: "Active planned sessions", value: 1, value_context: "active_at_as_of",
    });
    expect(result.metrics.find((metric) => metric.key === "access.gate_entries_recorded")).toMatchObject({
      label: "Gate entries · last 15 min", value: 7, value_context: "trailing_15_minutes",
    });
    const completion = result.metrics.find((metric) => metric.key === "attendance.register_completion_rate");
    expect(completion).toMatchObject({ numerator: 10, denominator: 12 });
    expect(completion?.value).toBeCloseTo(83.333, 2);
    expect(result.overview?.composition).toMatchObject({
      label: "Due attendance registers",
      unit: "registers",
      slices: [
        { key: "completed", value: 10 },
        { key: "outstanding", value: 2 },
        { key: "unknown", value: 0 },
      ],
    });
    expect(result.overview?.bottlenecks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "spaces.over_capacity_sessions", count: 2, severity: "important" }),
      expect.objectContaining({ id: "coordination.work_overdue", count: 2, severity: "important" }),
    ]));
  });

  it("returns unsupported catalogue metrics as null and unavailable, never fabricated zero", async () => {
    const { service } = dependencies();
    const result = await service.view(user, ids.school, {
      campus_id: ids.campus, page: "teaching", range: "today", at: "2026-10-17T04:00:00.000Z",
    });
    expect(result.metrics.find((metric) => metric.key === "attendance.evidence_review_backlog")).toMatchObject({
      value: null,
      numerator: null,
      denominator: null,
      availability: "unavailable",
      series: [],
    });
  });

  it("routes space bottlenecks to the single campus configuration path", async () => {
    const { service } = dependencies();
    const result = await service.view(user, ids.school, {
      campus_id: ids.campus, page: "spaces", range: "today", at: "2026-10-17T04:00:00.000Z",
    });
    expect(result.metrics.find((metric) => metric.key === "spaces.missing_canonical_space")?.target_path)
      .toBe("/principal/administration?section=campus");
  });

  it("authorizes before reading institution or KPI data", async () => {
    const { service, mocks } = dependencies({ authorized: false });
    await expect(service.view(user, ids.school, { page: "overview", range: "today" }))
      .rejects.toThrow("active institution administrator");
    expect(mocks.school).not.toHaveBeenCalled();
    expect(mocks.series).not.toHaveBeenCalled();
  });

  it("never accepts a campus outside the authorized institution topology", async () => {
    const { service, mocks } = dependencies();
    await expect(service.view(user, ids.school, {
      campus_id: ids.otherCampus, page: "spaces", range: "today",
    })).rejects.toThrow("Campus not found in this institution");
    expect(mocks.series).not.toHaveBeenCalled();
  });

  it("reports unknown KPI coverage instead of a calm state when overview evidence is unavailable", async () => {
    const { service, mocks } = dependencies({ noCampus: true });
    const result = await service.view(user, ids.school, {
      page: "overview", range: "today", at: "2026-10-17T04:00:00.000Z",
    });
    expect(mocks.series).not.toHaveBeenCalled();
    expect(result.metrics.every((metric) => metric.availability === "unavailable")).toBe(true);
    expect(result.overview?.evidence_state).toBe("unavailable");
    expect(result.overview?.bottlenecks).toContainEqual(expect.objectContaining({
      id: "evidence.kpi_coverage_unknown",
      evidence_dimension: "unknown",
      severity: "review",
      count: 8,
    }));
  });

  it("rejects invalid pages and ranges before authorization", async () => {
    const { service, mocks } = dependencies();
    await expect(service.view(user, ids.school, { page: "finance", range: "forever" }))
      .rejects.toThrow("valid campus, KPI page, range");
    expect(mocks.hasActiveAdminMembership).not.toHaveBeenCalled();
  });
});
