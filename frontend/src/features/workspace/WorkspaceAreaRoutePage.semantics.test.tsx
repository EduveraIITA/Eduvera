import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { getWorkspaceManifest } from "./api";
import type { WorkspaceManifest } from "./types";
import { WorkspaceAreaRoutePage } from "./WorkspaceAreaRoutePage";

vi.mock("./api", () => ({ getWorkspaceManifest: vi.fn() }));
vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ children, title, contentHasHeading = false }: { children: ReactNode; title: string; contentHasHeading?: boolean }) => <>
    {!contentHasHeading ? <header><h1>{title}</h1></header> : null}
    <main>{children}</main>
  </>,
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function manifest(areas: WorkspaceManifest["areas"]): WorkspaceManifest {
  return {
    revision: "1", generated_at: "2026-10-20T12:00:00Z",
    context: { institution_id: "campus", environment: { kind: "live" } },
    today: { now: [], next: [], attention: { total: 0, overdue: 0, due_soon: 0 } },
    work: { total: 0, items: [] }, areas, more: { setup: [] },
    freshness: { state: "current", as_of: "Now", source_revision: "1" },
  };
}
function mount() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ExecutionEnvironmentProvider environment={{ mode: "live" }}>
      <MemoryRouter initialEntries={["/areas/learning"]}><WorkspaceAreaRoutePage areaKey="learning" /></MemoryRouter>
    </ExecutionEnvironmentProvider>
  </QueryClientProvider>);
}

describe("Area shell heading and landmarks", () => {
  it("keeps a missing Area state below the single shell heading and main landmark", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest([]));
    mount();
    expect(await screen.findByRole("heading", { name: "This Area is not in your current work", level: 2 })).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Areas", level: 1 })).toBeVisible();
  });
  it("keeps a multi-surface Area within the shell rather than nesting main landmarks", async () => {
    vi.mocked(getWorkspaceManifest).mockResolvedValue(manifest([{
      key: "learning", label: "Learning", href: "/areas/learning", capabilities: [], scopes: [],
      surfaces: [
        { key: "assigned", label: "My classes", href: "/areas/learning/assigned", capabilities: [], scopes: [] },
        { key: "records", label: "Learning records", href: "/areas/learning/records", capabilities: [], scopes: [] },
      ],
    }]));
    mount();
    expect(await screen.findByRole("heading", { name: "Choose what you want to do", level: 2 })).toBeVisible();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Learning", level: 1 })).toBeVisible();
  });
});
