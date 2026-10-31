import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRelationshipLeaveRoute } from "./LeaveWorkspaceRoutes";

const { manifestQuery } = vi.hoisted((): { manifestQuery: {
  isPending: boolean;
  error: Error | null;
  refetch: ReturnType<typeof vi.fn>;
  data: unknown;
} } => ({
  manifestQuery: {
    isPending: false,
    error: null as Error | null,
    refetch: vi.fn(),
    data: undefined,
  },
}));

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));
vi.mock("../school/ParentLiveRoutes", () => ({ ParentLeaveRoute: () => <output>dependent leave</output> }));
vi.mock("../school/StudentLiveRoutes", () => ({
  StudentLeaveNewRoute: () => <output>self apply</output>,
  StudentLeaveStatusRoute: () => <output>self status</output>,
}));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useExecutionEnvironment: () => ({ mode: "live", namespaceId: "live:school-1" }),
}));
vi.mock("../workspace/ResponsibilityWorkspace", () => ({ manifestMatchesEnvironment: () => true }));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: () => manifestQuery }));
vi.mock("../workspace/WorkspaceState", () => ({ WorkspaceState: ({ state }: { state: string }) => <output>{state}</output> }));

const manifest = {
  context: { institution_label: "Cambridge International School" },
  areas: [{
    key: "attendance",
    label: "Attendance",
    surfaces: [
      { key: "leave:self:student-1", scopes: [{ kind: "self", id: "student-1", label: "Aarav" }] },
      { key: "leave:dependent:student-2", scopes: [{ kind: "dependent", id: "student-2", label: "Mira" }] },
    ],
  }],
};

describe("WorkspaceRelationshipLeaveRoute", () => {
  beforeEach(() => {
    manifestQuery.data = manifest;
    manifestQuery.error = null;
  });
  afterEach(cleanup);

  it("composes self status and application in the same canonical surface", () => {
    const view = render(<MemoryRouter initialEntries={["/areas/attendance/leave?scope=self&student_id=student-1"]}><WorkspaceRelationshipLeaveRoute /></MemoryRouter>);
    expect(screen.getByText("self status")).toBeVisible();
    view.unmount();
    render(<MemoryRouter initialEntries={["/areas/attendance/leave?scope=self&student_id=student-1&view=apply"]}><WorkspaceRelationshipLeaveRoute /></MemoryRouter>);
    expect(screen.getByText("self apply")).toBeVisible();
  });

  it("opens dependent authorization without a parent persona shell", () => {
    render(<MemoryRouter initialEntries={["/areas/attendance/leave?scope=dependent&student_id=student-2"]}><WorkspaceRelationshipLeaveRoute /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Mira leave" })).toBeVisible();
    expect(screen.getByText("dependent leave")).toBeVisible();
  });

  it("fails closed when the manifest does not grant the requested relationship", () => {
    render(<MemoryRouter initialEntries={["/areas/attendance/leave?scope=dependent&student_id=student-9"]}><WorkspaceRelationshipLeaveRoute /></MemoryRouter>);
    expect(screen.getByText("revoked")).toBeVisible();
    expect(screen.queryByText("dependent leave")).not.toBeInTheDocument();
  });
});
