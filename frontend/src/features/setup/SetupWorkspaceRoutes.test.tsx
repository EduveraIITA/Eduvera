import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useExecutionEnvironment: () => ({ mode: "live", namespaceId: "live:school-1" }),
}));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: vi.fn() }));
vi.mock("../workspace/WorkspaceState", () => ({
  WorkspaceState: ({ state }: { state: string }) => <p data-testid="workspace-state">{state}</p>,
}));
vi.mock("../onboarding/InvitationsPage", () => ({ default: () => <p>Invitations editor</p> }));
vi.mock("../onboarding/ProgressiveSetupPage", () => ({
  ProgressiveSetupWorkspacePage: () => <p>Capability guide</p>,
}));
vi.mock("../office/AdministrationPage", () => ({ default: () => <p>Foundation editor</p> }));
vi.mock("../organization/OrganizationPage", () => ({ default: () => <p>Organization editor</p> }));
vi.mock("../staff-operations/StaffOperationsRoutes", () => ({
  WorkspaceStaffSetupRoute: () => <p>Responsibility editor</p>,
}));

import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import {
  canonicalSetupRouteDefinitions,
  PeopleSetupWorkspace,
  SetupRouteBoundary,
  SetupWorkspaceOverview,
} from "./SetupWorkspaceRoutes";

afterEach(cleanup);

const manifest: WorkspaceManifest = {
  revision: "workspace-setup-1",
  generated_at: "2026-10-18T10:00:00.000Z",
  context: {
    institution_id: "school-1",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live:school-1" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "people",
    label: "People",
    href: "/areas/people",
    capabilities: ["people.view"],
    scopes: [],
    surfaces: [{
      key: "records",
      label: "People records",
      href: "/areas/people/records",
      capabilities: ["people.view"],
      scopes: [],
    }],
  }],
  more: {
    setup: [
      { key: "capabilities", label: "Capabilities", href: "/more/setup/capabilities" },
      { key: "institution", label: "Campus foundation", href: "/more/setup/institution" },
      { key: "people", label: "People & access", href: "/more/setup/people" },
      { key: "responsibilities", label: "Responsibilities", href: "/more/setup/responsibilities" },
      { key: "invitations", label: "Invitations", href: "/more/setup/people/invitations" },
      { key: "organization", label: "Organization", href: "/more/setup/organization" },
    ],
    other: [],
  },
  freshness: { state: "current", as_of: "3:30 PM", source_revision: "setup-1" },
};

describe("Setup workspace", () => {
  it("starts from the next operating outcome, then connects only its prerequisites", () => {
    render(<MemoryRouter><SetupWorkspaceOverview manifest={manifest} /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Set up the next thing you need." })).toBeInTheDocument();
    expect(screen.getByText(/Start with one useful outcome/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review capabilities/ })).toHaveAttribute("href", "/more/setup/capabilities");
    expect(screen.getByRole("link", { name: "Open Build your whole campus" })).toHaveAttribute("href", "/more/setup/whole-campus");
    expect(screen.getByRole("link", { name: "Open Campus foundation" })).toHaveAttribute("href", "/more/setup/institution");
    expect(screen.getByRole("link", { name: "Open Responsibilities" })).toHaveAttribute("href", "/more/setup/responsibilities");
    expect(screen.queryByText(/percent|complete your campus/i)).not.toBeInTheDocument();
  });

  it("keeps people records, responsibility, membership and login access distinct", () => {
    render(<MemoryRouter><PeopleSetupWorkspace manifest={manifest} /></MemoryRouter>);

    expect(screen.getByRole("link", { name: "Open People records" })).toHaveAttribute("href", "/areas/people/records");
    expect(screen.getByRole("link", { name: "Open Responsibilities" })).toHaveAttribute("href", "/more/setup/responsibilities");
    expect(screen.getByRole("link", { name: "Open People & access" })).toHaveAttribute("href", "/more/setup/people/access");
    expect(screen.getByRole("link", { name: "Open Invitations" })).toHaveAttribute("href", "/more/setup/people/invitations");
    expect(screen.getByText(/title or reporting line never grants access/i)).toBeInTheDocument();
  });

  it("fails closed when no setup responsibility is currently contributed", () => {
    vi.mocked(useWorkspaceManifest).mockReturnValue({
      isPending: false,
      error: null,
      data: { ...manifest, more: { setup: [], other: [] } },
      refetch: vi.fn(),
    } as never);
    render(<SetupRouteBoundary><p>Setup body</p></SetupRouteBoundary>);
    expect(screen.queryByText("Setup body")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-state")).toHaveTextContent("revoked");
  });

  it("exports one neutral route tree without a persona destination", () => {
    const paths = canonicalSetupRouteDefinitions.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("/more/setup");
    expect(paths).toContain("/more/setup/whole-campus");
    expect(paths).toContain("/more/setup/institution/history");
    expect(paths).toContain("/more/setup/responsibilities/:staffProfileId");
    expect(paths.every((path) => !/^\/(principal|teacher|student|parent|gate|admin)\b/.test(path))).toBe(true);
  });
});
