import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { getWorkspaceManifest } from "../workspace/api";
import type { WorkspaceManifest } from "../workspace/types";
import {
  ResponsibilityAttendanceWorkspace,
  attendanceSurfaceKey,
  findAttendanceSurface,
} from "./ResponsibilityAttendanceWorkspace";

vi.mock("../workspace/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workspace/api")>();
  return { ...actual, getWorkspaceManifest: vi.fn() };
});

const manifest: WorkspaceManifest = {
  revision: "workspace-42",
  generated_at: "2026-10-18T09:30:00.000Z",
  context: {
    institution_id: "cis",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live-cis" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "attendance",
    label: "Attendance",
    description: "Registers and attendance follow-up",
    href: "/areas/attendance",
    icon: "attendance",
    attention_count: 2,
    capabilities: ["attendance.record", "attendance.view", "followups.manage"],
    scopes: [
      { kind: "class", id: "6a", label: "Class 6A" },
      { kind: "dependent", id: "student-1", label: "Aarav Sharma" },
    ],
    surfaces: [{
      key: "registers",
      label: "Registers",
      description: "Assigned class and session registers",
      href: "/areas/attendance/registers",
      capabilities: ["attendance.record"],
      scopes: [{ kind: "class", id: "6a", label: "Class 6A" }],
    }, {
      key: "coordination",
      label: "Attendance follow-up",
      description: "Resolve attendance questions and exceptions",
      href: "/areas/attendance/coordination",
      capabilities: ["followups.manage"],
      scopes: [{ kind: "institution", id: "cis", label: "Cambridge International School" }],
    }, {
      key: "thresholds",
      label: "Attendance patterns",
      description: "Learners below the configured attendance minimum in your scope",
      href: "/areas/attendance/thresholds",
      capabilities: ["attendance.view"],
      scopes: [{ kind: "class", id: "6a", label: "Class 6A" }],
    }, {
      key: "records:dependent:student-1",
      label: "Aarav Sharma attendance",
      description: "Published attendance for Aarav Sharma",
      href: "/areas/attendance/records?scope=dependent&student_id=student-1",
      capabilities: ["attendance.view"],
      scopes: [{ kind: "dependent", id: "student-1", label: "Aarav Sharma" }],
    }, {
      key: "follow-ups:dependent:student-1",
      label: "Aarav Sharma attendance questions",
      description: "Reply to attendance questions and follow each resolution for Aarav Sharma",
      href: "/areas/attendance/follow-ups?scope=dependent&student_id=student-1",
      capabilities: ["attendance.view"],
      scopes: [{ kind: "dependent", id: "student-1", label: "Aarav Sharma" }],
    }],
  }],
  more: { setup: [], other: [] },
  freshness: { state: "current", as_of: "9:30 AM", source_revision: "source-9" },
};

function mount(
  selection: React.ComponentProps<typeof ResponsibilityAttendanceWorkspace>["selection"],
  child: React.ReactNode = <section aria-label="Authoritative attendance content">Domain content</section>,
  url = "/areas/attendance",
  beforeBack?: React.ComponentProps<typeof ResponsibilityAttendanceWorkspace>["beforeBack"],
  state?: unknown,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const location = new URL(url, window.location.origin);
  return render(<QueryClientProvider client={client}>
    <ExecutionEnvironmentProvider environment={{ mode: "live", namespaceId: "live-cis" }}>
      <MemoryRouter initialEntries={[{ pathname: location.pathname, search: location.search, hash: location.hash, state }]}>
        <ResponsibilityAttendanceWorkspace selection={selection} beforeBack={beforeBack}>{child}</ResponsibilityAttendanceWorkspace>
        <Location />
      </MemoryRouter>
    </ExecutionEnvironmentProvider>
  </QueryClientProvider>);
}
function Location() { const location = useLocation(); return <><output aria-label="Current attendance URL">{location.pathname}{location.search}{location.hash}</output><output aria-label="Current attendance state">{JSON.stringify(location.state)}</output></>; }

describe("ResponsibilityAttendanceWorkspace", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.mocked(getWorkspaceManifest).mockReset();
  });

  it("resolves operational and relationship surfaces by exact server identity", () => {
    const area = manifest.areas[0];
    expect(attendanceSurfaceKey({ kind: "registers" })).toBe("registers");
    expect(attendanceSurfaceKey({ kind: "records", relationship: "dependent", studentId: "student-1" }))
      .toBe("records:dependent:student-1");
    expect(attendanceSurfaceKey({ kind: "follow-ups", relationship: "dependent", studentId: "student-1" }))
      .toBe("follow-ups:dependent:student-1");
    expect(findAttendanceSurface(area, { kind: "coordination" })?.label).toBe("Attendance follow-up");
    expect(findAttendanceSurface(area, { kind: "records", relationship: "dependent", studentId: "student-2" }))
      .toBeUndefined();
  });

  it("composes every authorized attendance responsibility without a persona chooser", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    mount({ kind: "registers" });

    expect(await screen.findByRole("heading", { name: "Registers", level: 2 })).toBeInTheDocument();
    const switcher = screen.getByRole("navigation", { name: "Attendance work" });
    expect(within(switcher).getByRole("link", { name: "Current: Registers" })).toHaveAttribute("href", "/areas/attendance/registers");
    expect(within(switcher).getByRole("link", { name: "Open Attendance follow-up" })).toHaveAttribute("href", "/areas/attendance/coordination");
    expect(within(switcher).getByRole("link", { name: "Open Attendance patterns" })).toHaveAttribute("href", "/areas/attendance/thresholds");
    expect(within(switcher).getByRole("link", { name: "Open Aarav Sharma attendance" })).toHaveAttribute(
      "href",
      "/areas/attendance/records?scope=dependent&student_id=student-1",
    );
    expect(screen.getByLabelText("Current attendance scope")).toHaveTextContent("Class 6A");
    const details = screen.getByLabelText("Current attendance scope").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(within(switcher).getByRole("link", { name: "Current: Registers" })).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByText("Access details"));
    expect(details).toHaveAttribute("open");
    expect(screen.getByLabelText("Authoritative attendance content")).toBeVisible();
    expect(screen.queryByText(/teacher portal|principal portal|parent portal|student portal/i)).not.toBeInTheDocument();
  });

  it("uses the exact relationship label and content context supplied by the manifest", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    mount(
      { kind: "records", relationship: "dependent", studentId: "student-1" },
      <span>Published record history</span>,
    );

    expect(await screen.findByRole("heading", { name: "Aarav Sharma attendance", level: 2 })).toBeInTheDocument();
    expect(screen.getByLabelText("Current attendance scope")).toHaveTextContent("Aarav Sharma");
    expect(screen.getByLabelText("Current attendance scope").closest("details")).toBeNull();
    expect(screen.getByText("Published record history")).toBeVisible();
  });

  it.each(["register_id", "occurrence_id", "session_id", "class_section_id"])("uses the guarded shell Back for selected %s detail and retains queue context", async key => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    const guard = vi.fn().mockReturnValue(false);
    mount({ kind: "registers" }, undefined,
      `/areas/attendance/registers?date=2026-10-20&page=2&search=training&attendance_view=completed&activity_kind=training&${key}=selected`, guard);
    await screen.findByLabelText("Authoritative attendance content");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Attendance work" })).not.toBeInTheDocument();
    expect(screen.queryByText("Access details")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(guard).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Current attendance URL")).toHaveTextContent(`${key}=selected`);
    guard.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(guard).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Current attendance URL").textContent).toBe("/areas/attendance/registers?date=2026-10-20&page=2&search=training&attendance_view=completed&activity_kind=training");
    expect(screen.getByRole("navigation", { name: "Attendance work" })).toBeVisible();
    expect(screen.getByText("Access details")).toBeVisible();
  });

  it("returns academic detail to its validated teaching-session origin through the same unsaved guard", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    const origin = "/areas/timetable/session?session_id=lesson-1&date=2026-10-20";
    const guard = vi.fn().mockReturnValue(false);
    mount({ kind: "registers" }, undefined, "/areas/attendance/registers?date=2026-10-20&session_id=register-1", guard, { portalReturnTo: origin });
    await screen.findByLabelText("Authoritative attendance content");
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByLabelText("Current attendance URL")).toHaveTextContent("session_id=register-1");
    guard.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(guard).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Current attendance URL").textContent).toBe(origin);
  });

  it("clears the academic detail and highlighted learner only, retaining date, filters, hash and router context", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    mount({ kind: "coordination" }, undefined,
      "/areas/attendance/coordination?date=2026-10-20&page=2&search=maths&attendance_view=completed&session_id=session-1&class_section_id=class-1&student_id=student-1#queue", undefined, { source: "attention", portalReturnTo: "//example.com/areas" });
    await screen.findByLabelText("Authoritative attendance content");
    expect(screen.queryByRole("navigation", { name: "Attendance work" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.getByLabelText("Current attendance URL").textContent).toBe("/areas/attendance/coordination?date=2026-10-20&page=2&search=maths&attendance_view=completed#queue");
    expect(screen.getByLabelText("Current attendance state")).toHaveTextContent('"source":"attention"');
  });

  it("fails closed when the requested learner relationship is not in the manifest", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest);
    mount({ kind: "records", relationship: "dependent", studentId: "student-2" });
    expect(await screen.findByRole("heading", { name: "Your workspace access changed" })).toBeInTheDocument();
    expect(screen.queryByText("Domain content")).not.toBeInTheDocument();
  });

  it("does not render attendance content after manifest access is revoked", async () => {
    vi.mocked(getWorkspaceManifest).mockRejectedValue(new ApiError("Responsibility ended", 403));
    mount({ kind: "coordination" });
    expect(await screen.findByRole("heading", { name: "Your workspace access changed" })).toBeInTheDocument();
    expect(screen.queryByText("Domain content")).not.toBeInTheDocument();
  });
});
