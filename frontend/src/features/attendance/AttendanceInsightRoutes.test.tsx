import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  attendance: vi.fn(),
  followups: vi.fn(),
}));

vi.mock("../operations/api", async () => {
  const actual = await vi.importActual<typeof import("../operations/api")>("../operations/api");
  return { ...actual, getResponsibilityAttendanceWorkspace: calls.attendance };
});

vi.mock("../coordination/FollowupInbox", () => ({
  FollowupInbox: (props: unknown) => {
    calls.followups(props);
    return <div>Relationship follow-ups</div>;
  },
}));

vi.mock("./ResponsibilityAttendanceWorkspace", () => ({
  ResponsibilityAttendanceWorkspace: ({ selection, children }: {
    selection: { kind: string; relationship?: string; studentId?: string };
    children: React.ReactNode;
  }) => <section data-testid="attendance-boundary" data-selection={JSON.stringify(selection)}>{children}</section>,
}));

vi.mock("../workspace/RelationshipSurfaceResolver", () => ({
  RelationshipSurfaceResolver: ({ children }: {
    children: (selection: { relationship: "dependent"; studentId: string }) => React.ReactNode;
  }) => children({ relationship: "dependent", studentId: "student-1" }),
}));

import {
  WorkspaceAttendanceFollowupsRoute,
  WorkspaceAttendanceThresholdsRoute,
} from "./AttendanceInsightRoutes";

function mount(node: React.ReactNode, path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
  </QueryClientProvider>);
}

describe("canonical Attendance insight routes", () => {
  beforeEach(() => {
    calls.attendance.mockReset();
    calls.followups.mockReset();
  });
  afterEach(cleanup);

  it("binds a guardian conversation to the exact dependent relationship", () => {
    mount(
      <WorkspaceAttendanceFollowupsRoute />,
      "/areas/attendance/follow-ups?scope=dependent&student_id=student-1&followup=followup-9",
    );

    expect(screen.getByTestId("attendance-boundary")).toHaveAttribute(
      "data-selection",
      JSON.stringify({ kind: "follow-ups", relationship: "dependent", studentId: "student-1" }),
    );
    expect(calls.followups).toHaveBeenCalledWith(expect.objectContaining({
      context: "guardian",
      studentId: "student-1",
      initialFollowupId: "followup-9",
    }));
  });

  it("loads scoped threshold records without the principal home transport", async () => {
    calls.attendance.mockResolvedValue({
      surface: "thresholds",
      date: "2026-10-19",
      thresholds: [{
        id: "student-1",
        admission_number: "CIS-001",
        name: "Aarav Sharma",
        class_section_id: "class-6a",
        class_name: "Class 6A",
        recorded_days: 12,
        percentage: 72.5,
        threshold: 75,
      }],
    });
    mount(<WorkspaceAttendanceThresholdsRoute />, "/areas/attendance/thresholds?date=2026-10-19");

    expect(await screen.findByText("Aarav Sharma")).toBeVisible();
    await waitFor(() => expect(calls.attendance).toHaveBeenCalledWith("thresholds", "2026-10-19"));
    expect(screen.getByRole("link", { name: "Review Aarav Sharma, 72.5% attendance" })).toHaveAttribute(
      "href",
      "/areas/attendance/registers?class_section_id=class-6a&date=2026-10-19&student_id=student-1",
    );
    expect(screen.queryByText(/principal portal/i)).not.toBeInTheDocument();
  });
});
