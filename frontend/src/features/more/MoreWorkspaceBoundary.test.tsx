import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useExecutionEnvironment: () => ({ mode: "live", namespaceId: "live:school-1" }),
}));
vi.mock("../workspace/useWorkspaceManifest", () => ({ useWorkspaceManifest: vi.fn() }));
vi.mock("../workspace/WorkspaceState", () => ({
  WorkspaceState: ({ state }: { state: string }) => <p data-testid="workspace-state">{state}</p>,
}));
vi.mock("../campus-scenes/CampusScenePage", () => ({ default: () => <p>Published virtual campus</p> }));

import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import type { WorkspaceManifest } from "../workspace/types";
import { MoreRouteBoundary, WorkspaceVirtualCampusRoute } from "./MoreWorkspaceRoutes";

afterEach(cleanup);

const manifest: WorkspaceManifest = {
  revision: "workspace-1",
  generated_at: "2026-10-19T04:00:00.000Z",
  context: { institution_id: "school-1", environment: { kind: "live", namespace_id: "live:school-1" } },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [],
  more: {
    groups: [{ key: "account", label: "Account", items: [{ key: "account", label: "Profile", href: "/more/account" }] }],
    setup: [],
    other: [],
  },
  freshness: { state: "current", as_of: "9:30 AM", source_revision: "workspace-1" },
};

describe("MoreRouteBoundary", () => {
  it("renders an item only when the server manifest contributed it", () => {
    vi.mocked(useWorkspaceManifest).mockReturnValue({ isPending: false, error: null, data: manifest, refetch: vi.fn() } as never);
    render(<MoreRouteBoundary itemKey="account" title="Profile">{() => <p>Account body</p>}</MoreRouteBoundary>);
    expect(screen.getByText("Account body")).toBeInTheDocument();
  });

  it("fails closed when current responsibilities no longer contribute the item", () => {
    vi.mocked(useWorkspaceManifest).mockReturnValue({ isPending: false, error: null, data: manifest, refetch: vi.fn() } as never);
    render(<MoreRouteBoundary itemKey="virtual-campus" title="Virtual campus">{() => <p>Campus body</p>}</MoreRouteBoundary>);
    expect(screen.queryByText("Campus body")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-state")).toHaveTextContent("revoked");
  });

  it("opens virtual campus for a member when the current manifest contributes it", () => {
    const memberManifest = { ...manifest, more: { ...manifest.more, groups: [{ key: "campus", label: "Campus", items: [{ key: "virtual-campus", label: "Virtual campus", href: "/more/virtual-campus" }] }] } };
    vi.mocked(useWorkspaceManifest).mockReturnValue({ isPending: false, error: null, data: memberManifest, refetch: vi.fn() } as never);
    render(<WorkspaceVirtualCampusRoute />);
    expect(screen.getByText("Published virtual campus")).toBeInTheDocument();
  });

  it("does not mount virtual campus after the manifest removes access", () => {
    vi.mocked(useWorkspaceManifest).mockReturnValue({ isPending: false, error: null, data: manifest, refetch: vi.fn() } as never);
    render(<WorkspaceVirtualCampusRoute />);
    expect(screen.queryByText("Published virtual campus")).not.toBeInTheDocument();
    expect(screen.getByTestId("workspace-state")).toHaveTextContent("revoked");
  });
});
