import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { CampusOperatingDayOccurrence, TemporalContextPort } from "../src/campus-model-core/temporal-context.port.js";
import { OperatingDayService } from "../src/operating-day/operating-day.service.js";

const ids = {
  user: "00000000-0000-4000-8000-000000000001",
  school: "00000000-0000-4000-8000-000000000002",
  agent: "00000000-0000-4000-8000-000000000003",
  classA: "00000000-0000-4000-8000-000000000004",
};

const user: AuthUser = {
  id: ids.user, username: "teacher", email: "teacher@example.test", first_name: "Kavita", last_name: "Mehta",
  role: "staff", is_active: true, active_school_id: ids.school,
};

function occurrence(id: string, starts_at: string, ends_at: string): CampusOperatingDayOccurrence {
  return {
    id, occurrence_id: `logical-${id}`, occurrence_date: "2026-10-17", period_number: Number(id),
    period_domain_id: `20000000-0000-4000-8000-00000000000${id}`,
    class_entity_id: `10000000-0000-4000-8000-00000000000${id}`, class_domain_id: ids.classA,
    class_label: "Class 6A", subject_entity_id: null, subject_label: id === "1" ? "Mathematics" : "Science",
    space_entity_id: null, space_label: "Classroom 201", responsible_agent_id: ids.agent,
    responsible_agent_label: "Kavita Mehta", title: id === "1" ? "Mathematics" : "Science", slot_type: "class",
    starts_at, ends_at, source_domain: "timetable", source_record_id: `slot-${id}`, source_revision: 3,
    change_kind: id === "2" ? "substituted" : "published",
  };
}

describe("campus operating-day projection", () => {
  it("combines the effective model plan with authoritative attendance, gate and contradiction evidence", async () => {
    const repository = {
      membership: vi.fn().mockResolvedValue({ school_id: ids.school, role: "staff" }),
      school: vi.fn().mockResolvedValue({
        id: ids.school, name: "Cambridge International School", timezone: "Asia/Kolkata",
        attendance_academic_mode: "daily_class",
      }),
      attendance: vi.fn().mockResolvedValue([{
        scope_key: ids.classA, register_id: "register-1", class_section_id: ids.classA, state: "submitted", revision: 4, marked_count: 25,
        expected_count: 25, submitted_at: "2026-10-17T04:25:00.000Z",
      }]),
      gateTotals: vi.fn().mockResolvedValue({ entries: 184, exits: 3 }),
    };
    const listOperatingDay = vi.fn().mockResolvedValue([
        occurrence("1", "2026-10-17T03:30:00.000Z", "2026-10-17T04:15:00.000Z"),
        occurrence("2", "2026-10-17T04:20:00.000Z", "2026-10-17T05:05:00.000Z"),
      ]);
    const temporal = { listOperatingDay } as unknown as TemporalContextPort;
    const db = { transaction: () => ({ execute: (callback: (value: unknown) => unknown) => callback({}) }) };
    const identities = { resolveAccountEndpoint: vi.fn().mockResolvedValue({ acting: true, agent_id: ids.agent }) };
    const clock = { read: vi.fn().mockReturnValue({
      environment_kind: "simulation", namespace_id: "scenario:scenario-1:run:run-1",
      institution_id: ids.school, instant: new Date("2026-10-17T04:30:00.000Z"),
      iso_instant: "2026-10-17T04:30:00.000Z", time_zone: "Asia/Kolkata", local_date: "2026-10-17", local_time: "10:00:00",
    }) };
    const campusModel = { operationalSignals: vi.fn().mockResolvedValue([{
      id: "signal-1", kind: "expected_after_exit", severity: "review", owner: "gate",
      student_id: "student-1", person_label: "Aarav Sharma", class_label: "Class 6A",
      activity_label: "Science", gate_label: "Main Gate", gate_observed_at: "2026-10-17T04:10:00.000Z",
      expected_from: "2026-10-17T04:20:00.000Z", expected_until: "2026-10-17T05:05:00.000Z", attendance_status: null,
    }]) };
    const service = new OperatingDayService(
      db as never, repository as never, clock as never, temporal, identities as never, campusModel as never,
    );

    const result = await service.project(user, ids.school);

    expect(result.environment).toMatchObject({ kind: "simulation", label: "Simulation" });
    expect(listOperatingDay).toHaveBeenCalledWith(expect.objectContaining({
      school_id: ids.school, date: "2026-10-17", responsible_agent_id: ids.agent,
    }));
    expect(result.now).toHaveLength(1);
    expect(result.now[0]).toMatchObject({ subject_label: "Science", state: "in_progress", source: { change_kind: "substituted" } });
    expect(result.sessions[0]?.attendance).toMatchObject({ state: "submitted", marked_count: 25, expected_count: 25 });
    expect(repository.attendance).toHaveBeenCalledWith(
      ids.school, "2026-10-17", "daily_class", expect.arrayContaining([expect.objectContaining({ slot_type: "class" })]),
    );
    expect(result.summary).toMatchObject({
      scheduled_sessions: 2, completed_sessions: 1, current_sessions: 1,
      registers_expected: 1, registers_submitted: 1, gate_entries: 184, gate_exits: 3,
    });
    expect(result.contradictions[0]?.explanation).toContain("later expected Science session");
  });

  it("does not restrict an administrator's projection to the administrator agent", async () => {
    const repository = {
      membership: vi.fn().mockResolvedValue({ school_id: ids.school, role: "admin" }),
      school: vi.fn().mockResolvedValue({
        id: ids.school, name: "School", timezone: "Asia/Kolkata", attendance_academic_mode: "none",
      }),
      attendance: vi.fn().mockResolvedValue([]), gateTotals: vi.fn().mockResolvedValue({ entries: 0, exits: 0 }),
    };
    const listOperatingDay = vi.fn().mockResolvedValue([]);
    const temporal = { listOperatingDay } as unknown as TemporalContextPort;
    const service = new OperatingDayService(
      { transaction: () => ({ execute: (callback: (value: unknown) => unknown) => callback({}) }) } as never,
      repository as never,
      { read: () => ({ environment_kind: "live", namespace_id: `live:${ids.school}`, institution_id: ids.school, instant: new Date(), iso_instant: "2026-10-17T04:30:00.000Z", time_zone: "Asia/Kolkata", local_date: "2026-10-17", local_time: "10:00:00" }) } as never,
      temporal,
      { resolveAccountEndpoint: vi.fn().mockResolvedValue({ acting: true, agent_id: ids.agent }) } as never,
      { operationalSignals: vi.fn().mockResolvedValue([]) } as never,
    );
    await service.project({ ...user, role: "admin" }, ids.school);
    expect(listOperatingDay).toHaveBeenCalledWith(expect.not.objectContaining({ responsible_agent_id: expect.anything() }));
  });

  it("counts scheduled-session registers independently and never invents attendance when the mode is none", async () => {
    const periods = [
      occurrence("1", "2026-10-17T03:30:00.000Z", "2026-10-17T04:15:00.000Z"),
      occurrence("2", "2026-10-17T04:20:00.000Z", "2026-10-17T05:05:00.000Z"),
    ];
    const baseRepository = {
      membership: vi.fn().mockResolvedValue({ school_id: ids.school, role: "admin" }),
      gateTotals: vi.fn().mockResolvedValue({ entries: 0, exits: 0 }),
    };
    const temporal = { listOperatingDay: vi.fn().mockResolvedValue(periods) } as unknown as TemporalContextPort;
    const dependencies = [
      { transaction: () => ({ execute: (callback: (value: unknown) => unknown) => callback({}) }) } as never,
      { read: () => ({ environment_kind: "live", namespace_id: `live:${ids.school}`, institution_id: ids.school, instant: new Date(), iso_instant: "2026-10-17T03:45:00.000Z", time_zone: "Asia/Kolkata", local_date: "2026-10-17", local_time: "09:15:00" }) } as never,
      temporal,
      { resolveAccountEndpoint: vi.fn().mockResolvedValue({ acting: true, agent_id: ids.agent }) } as never,
      { operationalSignals: vi.fn().mockResolvedValue([]) } as never,
    ] as const;
    const sessionRepository = {
      ...baseRepository,
      school: vi.fn().mockResolvedValue({ id: ids.school, name: "School", timezone: "Asia/Kolkata", attendance_academic_mode: "scheduled_session" }),
      attendance: vi.fn().mockResolvedValue(periods.map((item, index) => ({
        scope_key: item.id, register_id: `register-${index}`, class_section_id: ids.classA, state: index ? "draft" : "submitted",
        revision: index ? 0 : 1, marked_count: index ? 0 : 25, expected_count: 25, submitted_at: null,
      }))),
    };
    const scheduled = new OperatingDayService(
      dependencies[0], sessionRepository as never, dependencies[1], dependencies[2], dependencies[3], dependencies[4],
    );
    const sessionResult = await scheduled.project({ ...user, role: "admin" }, ids.school);
    expect(sessionResult.summary).toMatchObject({ registers_expected: 2, registers_submitted: 1, registers_not_started: 1 });
    expect(sessionResult.sessions[0]?.target_path).toBe("/principal/attendance?session_id=register-0&date=2026-10-17");

    const noAttendanceRepository = {
      ...baseRepository,
      school: vi.fn().mockResolvedValue({ id: ids.school, name: "School", timezone: "Asia/Kolkata", attendance_academic_mode: "none" }),
      attendance: vi.fn().mockResolvedValue([]),
    };
    const noAttendance = new OperatingDayService(
      dependencies[0], noAttendanceRepository as never, dependencies[1], dependencies[2], dependencies[3], dependencies[4],
    );
    const noneResult = await noAttendance.project({ ...user, role: "admin" }, ids.school);
    expect(noneResult.summary.registers_expected).toBe(0);
    expect(noneResult.sessions.every((item) => item.attendance.state === "not_required")).toBe(true);
  });
});
