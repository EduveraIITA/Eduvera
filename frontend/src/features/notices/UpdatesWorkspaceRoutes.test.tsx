import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import {
  WorkspaceUpdateCreateRoute,
  WorkspaceUpdateDetailRoute,
  WorkspaceUpdatesRoute,
  updateContextOptions,
} from "./UpdatesWorkspaceRoutes";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
}));

vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useExecutionEnvironment: () => ({ mode: "live", namespaceId: "live-cis" }),
}));

vi.mock("../workspace/useWorkspaceManifest", () => ({
  useWorkspaceManifest: vi.fn(),
}));

vi.mock("./NoticeListPage", () => ({
  NoticeListPage: ({ workspace, workspaceOptions, onWorkspaceChange }: {
    workspace: unknown;
    workspaceOptions: Array<{ key: string }>;
    onWorkspaceChange: (key: string) => void;
  }) => <section>
    <pre data-testid="updates-context">{JSON.stringify(workspace)}</pre>
    {workspaceOptions.map((option) => <button key={option.key} type="button" onClick={() => onWorkspaceChange(option.key)}>{option.key}</button>)}
  </section>,
}));

vi.mock("./NoticeDetailPage", () => ({
  NoticeDetailPage: ({ workspace, noticeId }: { workspace: unknown; noticeId: string }) => <pre data-testid="update-detail">{JSON.stringify({ workspace, noticeId })}</pre>,
}));

vi.mock("./NoticeComposerPage", () => ({
  NoticeComposerPage: ({ workspace, noticeId }: { workspace: unknown; noticeId?: string }) => <pre data-testid="update-composer">{JSON.stringify({ workspace, noticeId })}</pre>,
}));

const manifest: WorkspaceManifest = {
  revision: "updates-workspace-1",
  generated_at: "2026-10-18T12:00:00.000Z",
  context: {
    institution_id: "cis",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live-cis" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "messages",
    label: "Messages",
    href: "/areas/messages",
    capabilities: ["messages.view", "messages.send"],
    scopes: [{ kind: "institution", id: "cis", label: "Cambridge International School" }],
    surfaces: [{
      key: "updates",
      label: "Campus updates",
      description: "Updates for the responsibilities you hold",
      href: "/areas/messages/updates",
      capabilities: ["messages.view", "messages.send"],
      scopes: [{ kind: "institution", id: "cis", label: "Cambridge International School" }],
    }, {
      key: "updates:dependent:aarav",
      label: "Aarav's updates",
      description: "School updates connected to Aarav",
      href: "/areas/messages/updates?scope=dependent&student_id=aarav",
      capabilities: ["messages.view"],
      scopes: [{ kind: "dependent", id: "aarav", label: "Aarav Sharma" }],
    }],
  }],
  more: { setup: [], other: [] },
  freshness: { state: "current", as_of: "12:00 PM", source_revision: "updates-1" },
};

function LocationSearch() {
  return <output data-testid="location-search">{useLocation().search}</output>;
}

function show(path = "/areas/messages/updates", element: ReactNode = <WorkspaceUpdatesRoute />) {
  return render(<MemoryRouter initialEntries={[path]}>{element}<LocationSearch /></MemoryRouter>);
}

beforeEach(() => {
  vi.mocked(useWorkspaceManifest).mockReturnValue({
    data: manifest,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceManifest>);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("responsibility-composed Updates workspace", () => {
  it("derives responsibility and explicit dependent contexts from manifest surfaces", () => {
    expect(updateContextOptions(manifest.areas[0]!, "cis").map((option) => option.context)).toEqual([
      expect.objectContaining({ scope: "responsibility", schoolId: "cis", capabilities: ["messages.view", "messages.send"] }),
      expect.objectContaining({ scope: "dependent", studentId: "aarav", capabilities: ["messages.view"] }),
    ]);
  });

  it("opens the neutral responsibility surface and switches to an exact relationship", () => {
    show();

    expect(screen.getByTestId("updates-context")).toHaveTextContent('"scope":"responsibility"');
    fireEvent.click(screen.getByRole("button", { name: "updates:dependent:aarav" }));

    expect(screen.getByTestId("location-search")).toHaveTextContent("?scope=dependent&student_id=aarav");
    expect(screen.getByTestId("updates-context")).toHaveTextContent('"scope":"dependent"');
    expect(screen.getByTestId("updates-context")).toHaveTextContent('"studentId":"aarav"');
  });

  it("passes the exact workspace context and update identity to the detail surface", () => {
    show("/areas/messages/updates/update-7?scope=dependent&student_id=aarav", <Routes>
      <Route path="/areas/messages/updates/:noticeId" element={<WorkspaceUpdateDetailRoute />} />
    </Routes>);

    expect(screen.getByTestId("update-detail")).toHaveTextContent('"noticeId":"update-7"');
    expect(screen.getByTestId("update-detail")).toHaveTextContent('"scope":"dependent"');
    expect(screen.getByTestId("update-detail")).toHaveTextContent('"studentId":"aarav"');
  });

  it("fails closed for an unknown relationship and for relationship-scoped composition", () => {
    const { unmount } = show("/areas/messages/updates?scope=dependent&student_id=unknown");
    expect(screen.getByRole("heading", { name: "Your workspace access changed" })).toBeInTheDocument();
    expect(screen.queryByTestId("updates-context")).not.toBeInTheDocument();
    unmount();

    show("/areas/messages/updates/new?scope=dependent&student_id=aarav", <WorkspaceUpdateCreateRoute />);
    expect(screen.getByRole("heading", { name: "Your workspace access changed" })).toBeInTheDocument();
    expect(screen.queryByTestId("update-composer")).not.toBeInTheDocument();
  });

  it("allows composition only from a manifest-authorized responsibility surface", () => {
    show("/areas/messages/updates/new", <WorkspaceUpdateCreateRoute />);

    expect(screen.getByTestId("update-composer")).toHaveTextContent('"scope":"responsibility"');
    expect(screen.getByTestId("update-composer")).toHaveTextContent('"schoolId":"cis"');
  });
});
