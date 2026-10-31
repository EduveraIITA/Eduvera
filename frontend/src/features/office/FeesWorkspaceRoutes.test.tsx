import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceArea, WorkspaceManifest } from "../workspace/types";
import { feeWorkspaceContexts, WorkspaceFeesRoute } from "./FeesWorkspaceRoutes";

const state = vi.hoisted(() => ({ manifest: null as WorkspaceManifest | null }));

vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useExecutionEnvironment: () => ({ mode: "live" }),
}));
vi.mock("../workspace/useWorkspaceManifest", () => ({
  useWorkspaceManifest: () => ({ data: state.manifest, isPending: false, error: null, refetch: vi.fn() }),
}));
vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <><h1>{title}</h1>{children}</>,
}));

const area = (surfaces: WorkspaceArea["surfaces"]): WorkspaceArea => ({
  key: "fees",
  label: "Fees",
  description: "Authorized fee and receipt operations",
  href: "/areas/fees",
  icon: "resources",
  capabilities: ["fees.view"],
  scopes: [],
  surfaces,
});

const manifest = (fees: WorkspaceArea): WorkspaceManifest => ({
  revision: "1",
  generated_at: "2026-10-18T10:00:00.000Z",
  context: { institution_id: "school-1", environment: { kind: "live" } },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [fees],
  more: { setup: [] },
  freshness: { state: "current", as_of: "2026-10-18T10:00:00.000Z", source_revision: "1" },
});

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname}{location.search}</span>;
}

afterEach(cleanup);
beforeEach(() => { state.manifest = null; });

describe("fee responsibility composition", () => {
  it("translates surfaces into work and relationship contexts without personas", () => {
    const contexts = feeWorkspaceContexts(area([
      { key: "ledger", label: "Fees & receipts", description: "Maintain records", href: "/areas/fees/ledger", capabilities: ["fees.manage"], scopes: [{ kind: "institution", id: "school-1" }] },
      { key: "account:self:student-1", label: "My fees", description: "My records", href: "/areas/fees/account?scope=self&student_id=student-1", capabilities: ["fees.view"], scopes: [{ kind: "self", id: "student-1" }] },
      { key: "account:dependent:student-2", label: "Mira's fees", description: "Linked learner", href: "/areas/fees/account?scope=dependent&student_id=student-2", capabilities: ["fees.view"], scopes: [{ kind: "dependent", id: "student-2" }] },
    ]));

    expect(contexts.map((context) => [context.kind, context.title])).toEqual([
      ["responsibility", "Collect & reconcile"],
      ["self", "My fee account"],
      ["dependent", "Mira's fees"],
    ]);
    expect(contexts.some((context) => /parent|student|principal/i.test(context.title))).toBe(false);
  });

  it("opens a sole current account directly", async () => {
    state.manifest = manifest(area([
      { key: "account:dependent:student-2", label: "Mira's fees", description: "Linked learner", href: "/areas/fees/account?scope=dependent&student_id=student-2", capabilities: ["fees.view"], scopes: [{ kind: "dependent", id: "student-2" }] },
    ]));
    render(<MemoryRouter initialEntries={["/areas/fees"]}><LocationProbe /><Routes><Route path="/areas/fees" element={<WorkspaceFeesRoute />} /><Route path="/areas/fees/account" element={<span>Exact account</span>} /></Routes></MemoryRouter>);
    expect(await screen.findByText("Exact account")).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/areas/fees/account?scope=dependent&student_id=student-2");
  });

  it("shows work contexts only when a person genuinely has more than one", () => {
    state.manifest = manifest(area([
      { key: "ledger", label: "Fees & receipts", description: "Maintain invoices and receipts", href: "/areas/fees/ledger", capabilities: ["fees.manage"], scopes: [{ kind: "institution", id: "school-1" }] },
      { key: "account:dependent:student-2", label: "Mira's fees", description: "Linked learner records", href: "/areas/fees/account?scope=dependent&student_id=student-2", capabilities: ["fees.view"], scopes: [{ kind: "dependent", id: "student-2" }] },
    ]));
    render(<MemoryRouter initialEntries={["/areas/fees"]}><WorkspaceFeesRoute /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Institution work" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Accounts I can view" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open Collect & reconcile" })).toHaveAttribute("href", "/areas/fees/ledger");
    expect(screen.getByRole("link", { name: "Open Mira's fees" })).toHaveAttribute("href", "/areas/fees/account?scope=dependent&student_id=student-2");
  });
});
