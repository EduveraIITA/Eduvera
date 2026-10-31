import "reflect-metadata";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CampusPersonalService } from "../src/campus-view/campus-personal.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { AuthUser } from "../src/common/request.js";
import { TeachingSessionContextService } from "../src/teaching-sessions/teaching-session-context.service.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const school = id(1), campus = id(2), room = id(3), otherCampusRoom = id(4), agent = id(5), classId = id(6), person = id(7);
const user: AuthUser = { id: id(8), username: "student", email: "student@example.test", first_name: "Aditi", last_name: "Vyas",
  role: "student", is_active: true, active_school_id: school };
const at = "2026-10-26T04:30:00.000Z";
const academic = (n = 9, overrides: Record<string, unknown> = {}) => ({ id: id(n), class_domain_id: classId,
  period_number: n, slot_type: "class", starts_at: "2026-10-26T05:30:00.000Z", ends_at: "2026-10-26T06:30:00.000Z",
  subject_label: "Advanced Algorithms", title: "Algorithms", class_label: "M.Tech Data Engineering · Semester I",
  source_domain: "timetable", source_record_id: id(10), source_revision: 2, space_domain_id: room, ...overrides });
const opened = (n = 9, overrides: Record<string, unknown> = {}) => ({ id: id(n), date: "2026-10-26",
  href: `/areas/timetable/session?session_id=${id(n)}&date=2026-10-26`, space_id: room, place_label: "Seminar 101",
  starts_at: "2026-10-26T05:30:00.000Z", ends_at: "2026-10-26T06:30:00.000Z", source_record_id: id(10), source_revision: 2, ...overrides });

function setup() {
  const repository = { campuses: vi.fn().mockResolvedValue([{ id: campus, is_primary: true }]),
    spaces: vi.fn().mockResolvedValue([{ id: room, parent_space_id: null, name: "Seminar 101", code: "S101", kind: "classroom", capacity: 36 }]) };
  const workspace = { load: vi.fn().mockResolvedValue({ acting_agent_id: agent, relationships: [{ relationship: "self", class_section_id: classId },
    { relationship: "dependent", class_section_id: id(50) }], assignments: [] }) };
  const sessions = { account: vi.fn().mockResolvedValue({ timezone: "Asia/Kolkata", actor: { agent_id: agent, person_id: person } }),
    openExpected: vi.fn().mockResolvedValue(opened()) };
  const planning = { ensureOccurrences: vi.fn().mockResolvedValue([]) };
  const facilities = { work: vi.fn().mockResolvedValue({ needs_me: [], waiting: [] }), detail: vi.fn() };
  const clock = { read: vi.fn().mockReturnValue({ environment_kind: "live", namespace_id: `live:${school}`, institution_id: school,
    instant: new Date(at), iso_instant: at, time_zone: "Asia/Kolkata", local_date: "2026-10-26" }) };
  const temporal = { listOperatingDay: vi.fn().mockImplementation((query: { date: string; class_section_ids?: string[] }) =>
    Promise.resolve(query.date === "2026-10-26" && query.class_section_ids ? [academic()] : [])) };
  const scenes = { published: vi.fn().mockResolvedValue({ places: [{ id: room }] }) };
  const service = new CampusPersonalService({} as never, repository as never, workspace as never, sessions as never,
    planning as never, facilities as never, clock as never, temporal as never, scenes as never);
  return { service, repository, workspace, sessions, planning, facilities, clock, temporal, scenes };
}

describe("personal Virtual campus composition", () => {
  it("uses only actor/self scope, owner-authorized canonical session and expected destination", async () => {
    const t = setup(); const result = await t.service.mine(user, school, { campus_id: campus });
    expect(result.next).toEqual([expect.objectContaining({ kind: "teaching_session", title: "Advanced Algorithms", space_id: room,
      target_path: opened().href, state: "upcoming", dimension: "expected", spatial_claim: "expected_context_only" })]);
    expect(t.temporal.listOperatingDay).toHaveBeenCalledWith(expect.objectContaining({ responsible_agent_id: agent }));
    expect(t.temporal.listOperatingDay).toHaveBeenCalledWith(expect.objectContaining({ class_section_ids: [classId] }));
    expect(t.temporal.listOperatingDay.mock.calls.every(([q]) => q.responsible_agent_id || q.class_section_ids)).toBe(true);
    expect(t.sessions.openExpected).toHaveBeenCalledWith(user, "2026-10-26", { class_section_id: classId, period_number: "9" });
    expect(JSON.stringify(result)).not.toMatch(/roster|guardian|student_id|teacher_user_id|responsible_agent_id/);
    expect(result.motion).toMatchObject({ school_id: school, campus_id: campus, as_of: at,
      environment: { kind: "live", namespace_id: `live:${school}` }, subjects: [{ kind: "self", claims: [
        { space_id: room, expected_count: 1, starts_at: opened().starts_at, ends_at: opened().ends_at,
          spatial_claim: "expected_context_only", source: { revision: 2 } },
      ] }] });
    expect(JSON.stringify(result.motion)).not.toContain(person);
  });

  it("rejects arbitrary person/date/world selection before reading personal sources", async () => {
    const t = setup();
    await expect(t.service.mine(user, school, { person_id: id(40) })).rejects.toThrow("does not accept a person");
    await expect(t.service.mine(user, school, { at })).rejects.toThrow("does not accept a person");
    await expect(t.service.mine(user, id(20), {})).rejects.toThrow("current world");
    await expect(executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: id(22), clock: { now: () => new Date(at), nowIso: () => at } }), () => t.service.mine(user, school))).rejects.toThrow("current world");
    expect(t.sessions.account).not.toHaveBeenCalled();
  });

  it("fails closed for current identity/membership revocation and unknown campus", async () => {
    const t = setup(); t.sessions.account.mockRejectedValueOnce(new ForbiddenException("Account revoked"));
    await expect(t.service.mine(user, school)).rejects.toThrow("revoked");
    await expect(t.service.mine(user, school, { campus_id: id(30) })).rejects.toThrow("Campus not found");
    expect(t.planning.ensureOccurrences).not.toHaveBeenCalled();
  });

  it("removes cancelled/now unauthorized owner sources even if the temporal projection is retained", async () => {
    const t = setup(); t.sessions.openExpected.mockRejectedValue(new NotFoundException("This session is no longer scheduled"));
    const result = await t.service.mine(user, school);
    expect(result.now).toEqual([]); expect(result.next).toEqual([]); expect(result.destinations).toEqual([]);
    expect(result.motion.subjects).toEqual([]);
    expect(t.temporal.listOperatingDay).toHaveBeenCalledTimes(16);
  });

  it("uses the owner's latest moved place/time/revision and excludes other campus destinations", async () => {
    const t = setup(); t.sessions.openExpected.mockResolvedValueOnce(opened(9, { starts_at: "2026-10-26T04:00:00.000Z", source_revision: 5 }));
    const result = await t.service.mine(user, school);
    expect(result.now[0]).toMatchObject({ state: "in_progress", starts_at: "2026-10-26T04:00:00.000Z", source: { revision: 5 } });
    expect(result.motion.subjects[0]?.claims[0]).toMatchObject({ starts_at: "2026-10-26T04:00:00.000Z", source: { revision: 5 } });
    const moved = setup(); moved.sessions.openExpected.mockResolvedValue(opened(9, { space_id: otherCampusRoom }));
    expect((await moved.service.mine(user, school)).destinations).toEqual([]);
  });

  it("searches the next seven days using the selected world clock and never guesses a room from a label", async () => {
    const t = setup(); t.clock.read.mockReturnValue({ ...t.clock.read(), environment_kind: "simulation", namespace_id: `scenario:${id(90)}:run:${id(91)}` });
    t.temporal.listOperatingDay.mockImplementation((q: { date: string; class_section_ids?: string[] }) =>
      Promise.resolve(q.date === "2026-10-28" && q.class_section_ids ? [academic()] : []));
    t.sessions.openExpected.mockResolvedValue(opened(9, { date: "2026-10-28", space_id: null, place_label: "Unmapped seminar room",
      starts_at: "2026-10-28T05:30:00.000Z", ends_at: "2026-10-28T06:30:00.000Z" }));
    const result = await t.service.mine(user, school);
    expect(result.environment.kind).toBe("simulation"); expect(result.next[0]?.space_id).toBeNull();
    expect(result.limitations.join(" ")).toContain("no exact mapped");
    expect(t.temporal.listOperatingDay).toHaveBeenCalledTimes(6);
    expect(t.planning.ensureOccurrences).toHaveBeenCalledWith(school, "2026-10-25", "2026-11-02", undefined, { source: "activity" });
  });

  it("includes only exact assigned gate work and actor-owned repair, not an institution grant or another handler", async () => {
    const t = setup(); t.workspace.load.mockResolvedValue({ acting_agent_id: agent, relationships: [], assignments: [
      { id: id(60), action_key: "gate.operate", scope: { kind: "space", id: room }, source_domain: "staff", source_record_id: id(61), source_revision: 1 },
      { id: id(62), action_key: "gate.operate", scope: { kind: "institution", id: school } },
    ] });
    t.facilities.work.mockResolvedValue({ needs_me: [{ repair_id: id(64), owner: { user_id: user.id }, title: "Continue repair", href: "/areas/facilities?repair_id=x", action: "work" },
      { repair_id: id(66), owner: { user_id: id(67) } }], waiting: [] });
    t.facilities.detail.mockResolvedValue({ id: id(64), title: "Path light", state: "in_progress", space_id: room, revision: 3 });
    const result = await t.service.mine(user, school);
    expect(result.destinations.map(item => item.kind)).toEqual(["responsibility", "repair"]);
    expect(result.destinations.every(item => item.spatial_claim === "assigned_work_only")).toBe(true);
    expect(result.motion.subjects).toEqual([]);
    expect(t.facilities.detail).toHaveBeenCalledTimes(1);
  });

  it("propagates an unavailable owner rather than inventing an empty successful projection", async () => {
    const t = setup(); t.facilities.work.mockRejectedValue(new Error("Selected world store unavailable"));
    await expect(t.service.mine(user, school)).rejects.toThrow("Selected world store unavailable");
  });

  it("uses the selected campus timezone to resolve the local day", async () => {
    const t = setup(); t.repository.campuses.mockResolvedValue([{ id: campus, is_primary: true, timezone: "America/Los_Angeles" }]);
    await t.service.mine(user, school, { campus_id: campus });
    expect(t.clock.read).toHaveBeenCalledWith({ institution_id: school, time_zone: "America/Los_Angeles" });
  });

  it("discloses published places and own destination ancestry, keeping other unpublished rooms private", async () => {
    const t = setup(); t.scenes.published.mockResolvedValue({ places: [] });
    t.repository.spaces.mockResolvedValue([
      { id: room, parent_space_id: id(70), name: "Seminar 101", code: "S101", kind: "classroom", capacity: 36 },
      { id: id(70), parent_space_id: null, name: "Academic block", code: "AC", kind: "building", capacity: null },
      { id: id(71), parent_space_id: null, name: "PRIVATE unpublished room", code: "PVT", kind: "office", capacity: null },
    ]);
    const result = await t.service.mine(user, school);
    expect(result.places.map(place => place.id)).toEqual([room, id(70)]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("retains owner-rechecked earlier intervals for self movement without putting ended work back into cards", async () => {
    const t = setup();
    t.temporal.listOperatingDay.mockImplementation((q: { date: string; class_section_ids?: string[] }) =>
      Promise.resolve(q.date === "2026-10-26" && q.class_section_ids ? [
        academic(12, { starts_at: "2026-10-26T03:00:00.000Z", ends_at: "2026-10-26T04:00:00.000Z" }), academic(),
      ] : []));
    t.sessions.openExpected.mockImplementation((_actor, _date, selector: { period_number: string }) => Promise.resolve(selector.period_number === "12"
      ? opened(12, { starts_at: "2026-10-26T03:00:00.000Z", ends_at: "2026-10-26T04:00:00.000Z" }) : opened()));
    const result = await t.service.mine(user, school);
    expect(result.destinations).toHaveLength(1);
    expect(result.motion.subjects).toHaveLength(1);
    expect(result.motion.subjects[0]?.claims).toEqual([
      expect.objectContaining({ starts_at: "2026-10-26T03:00:00.000Z", ends_at: "2026-10-26T04:00:00.000Z" }),
      expect.objectContaining({ starts_at: "2026-10-26T05:30:00.000Z", ends_at: "2026-10-26T06:30:00.000Z" }),
    ]);
    expect(t.sessions.openExpected).toHaveBeenCalledWith(user, "2026-10-26", { class_section_id: classId, period_number: "12" });
  });

  it("uses native expected activity participation for self across purposes, without adding other participants", async () => {
    const t = setup(); t.temporal.listOperatingDay.mockResolvedValue([]);
    t.planning.ensureOccurrences.mockResolvedValue([{ id: id(120), source: "activity", state: "expected", purpose: "duty",
      local_date: "2026-10-26", starts_at: "2026-10-26T04:00:00.000Z", ends_at: "2026-10-26T06:00:00.000Z",
      space_id: room, title: "North entrance duty", participants: [{ person_id: person }, { person_id: id(121) }],
      source_ref: id(122), plan_version_id: id(123), source_revision: 4 }]);
    const result = await t.service.mine(user, school);
    expect(result.motion.subjects).toEqual([{ subject_key: expect.any(String), kind: "self", claims: [expect.objectContaining({
      space_id: room, expected_count: 1, starts_at: "2026-10-26T04:00:00.000Z", ends_at: "2026-10-26T06:00:00.000Z",
      source: { domain: "timetable", record_id: id(123), revision: 4 },
    })] }]);
    expect(JSON.stringify(result.motion)).not.toContain(id(121));
  });

  it("uses the teaching owner's current native activity place, times and revision for motion", async () => {
    const t = setup(); t.temporal.listOperatingDay.mockResolvedValue([]);
    t.planning.ensureOccurrences.mockResolvedValue([{ id: id(120), source: "activity", state: "expected", purpose: "teaching",
      local_date: "2026-10-26", starts_at: "2026-10-26T04:00:00.000Z", ends_at: "2026-10-26T06:00:00.000Z",
      space_id: room, title: "Algorithms seminar", participants: [{ person_id: person }],
      source_ref: id(122), plan_version_id: id(123), source_revision: 4 }]);
    t.sessions.openExpected.mockResolvedValue(opened(120, { space_id: null, place_label: "New room awaiting mapping",
      starts_at: "2026-10-26T04:15:00.000Z", ends_at: "2026-10-26T06:15:00.000Z", source_record_id: id(124), source_revision: 5 }));
    expect((await t.service.mine(user, school)).motion.subjects[0]?.claims).toEqual([expect.objectContaining({
      space_id: null, starts_at: "2026-10-26T04:15:00.000Z", ends_at: "2026-10-26T06:15:00.000Z",
      source: { domain: "timetable", record_id: id(124), revision: 5 },
    })]);
  });

  it("teaching owner retains cancelled historical access but never offers it as a destination", async () => {
    const service = new TeachingSessionContextService({} as never, {} as never, {} as never);
    const source = { ...opened(), source_kind: "academic", class_section_id: classId, period_number: 1,
      state: "cancelled", source_evidence: { space_id: room, source_record_id: id(10), source_revision: 3 } };
    vi.spyOn(service, "sources").mockResolvedValue({ school: {} as never, sources: [source as never] });
    const access = vi.spyOn(service, "access").mockResolvedValue({} as never);
    const selector = { class_section_id: classId, period_number: "1" };
    await expect(service.open(user, "2026-10-26", selector)).resolves.toMatchObject({ id: source.id });
    await expect(service.openExpected(user, "2026-10-26", selector)).rejects.toThrow("no longer scheduled");
    access.mockRejectedValueOnce(new ForbiddenException("Participation revoked"));
    await expect(service.openExpected(user, "2026-10-26", selector)).rejects.toThrow("revoked");
  });
});
