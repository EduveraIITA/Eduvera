import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceManifest } from "./types";
import { useWorkspaceManifest } from "./useWorkspaceManifest";
import {
  RelationshipSurfaceResolver,
  relationshipSurfaceOptions,
  resolveRelationshipSelection,
} from "./RelationshipSurfaceResolver";

vi.mock("../../pages/operations/OperationsShell", () => ({
  OperationsShell: ({ title, children }: { title: string; children: ReactNode }) => <main><h2>{title}</h2>{children}</main>,
}));
vi.mock("../simulation/ExecutionEnvironmentContext", () => ({
  useExecutionEnvironment: () => ({ mode: "live", namespaceId: "live-cis" }),
}));
vi.mock("./ResponsibilityWorkspace", () => ({ manifestMatchesEnvironment: () => true }));
vi.mock("./useWorkspaceManifest", () => ({ useWorkspaceManifest: vi.fn() }));

const baseManifest: WorkspaceManifest = {
  revision: "relationships-1",
  generated_at: "2026-10-18T09:00:00.000Z",
  context: { institution_id: "cis", environment: { kind: "live", namespace_id: "live-cis" } },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "fees",
    label: "Fees",
    href: "/areas/fees",
    capabilities: ["fees.view"],
    scopes: [{ kind: "dependent", id: "learner-1", label: "Mira Sen" }],
    surfaces: [{
      key: "account:dependent:learner-1",
      label: "Mira's fees",
      description: "Invoices and receipts for Mira",
      href: "/areas/fees/account?scope=dependent&student_id=learner-1",
      capabilities: ["fees.view"],
      scopes: [{ kind: "dependent", id: "learner-1", label: "Mira Sen" }],
    }],
  }],
  more: { setup: [], other: [] },
  freshness: { state: "current", as_of: "9:00 AM", source_revision: "source-1" },
};

function LocationState() {
  const location = useLocation();
  return <output aria-label="location">{`${location.pathname}${location.search}${location.hash}`}</output>;
}

function show(manifest: WorkspaceManifest, path: string) {
  vi.mocked(useWorkspaceManifest).mockReturnValue({
    data: manifest,
    error: null,
    isPending: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useWorkspaceManifest>);
  return render(<MemoryRouter initialEntries={[path]}>
    <RelationshipSurfaceResolver areaKey="fees" surfacePrefix="account" title="Fees & receipts">
      {({ label }) => <output aria-label="selected learner">{label}</output>}
    </RelationshipSurfaceResolver>
    <LocationState />
  </MemoryRouter>);
}

describe("relationship surface resolution", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("infers the only authorized dependent and preserves the bookmark query and hash", async () => {
    show(baseManifest, "/areas/fees/account?scope=dependent&view=receipts#history");

    expect(await screen.findByLabelText("selected learner")).toHaveTextContent("Mira Sen");
    expect(screen.getByLabelText("location")).toHaveTextContent(
      "/areas/fees/account?scope=dependent&view=receipts&student_id=learner-1#history",
    );
  });

  it("offers an explicit subject picker when more than one relationship is authorized", () => {
    const area = baseManifest.areas[0]!;
    const second = {
      ...area.surfaces[0]!,
      key: "account:dependent:learner-2",
      label: "Ishan's fees",
      href: "/areas/fees/account?scope=dependent&student_id=learner-2",
      scopes: [{ kind: "dependent" as const, id: "learner-2", label: "Ishan Sen" }],
    };
    show({ ...baseManifest, areas: [{ ...area, surfaces: [...area.surfaces, second] }] }, "/areas/fees/account?scope=dependent&view=receipts#history");

    expect(screen.getByRole("heading", { name: "Choose a learner for fees & receipts" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Mira Sen/i })).toHaveAttribute(
      "href",
      "/areas/fees/account?scope=dependent&view=receipts&student_id=learner-1#history",
    );
    expect(screen.getByRole("link", { name: /Ishan Sen/i })).toBeVisible();
  });

  it("does not replace an explicitly unauthorized learner", () => {
    show(baseManifest, "/areas/fees/account?scope=dependent&student_id=unknown");
    expect(screen.getByRole("heading", { name: "Your workspace access changed" })).toBeVisible();
    expect(screen.queryByLabelText("selected learner")).not.toBeInTheDocument();
  });

  it("parses stable relationship identity independently of display labels", () => {
    const options = relationshipSurfaceOptions(baseManifest.areas[0], "account");
    expect(options).toEqual([expect.objectContaining({
      relationship: "dependent",
      studentId: "learner-1",
      label: "Mira Sen",
    })]);
    expect(resolveRelationshipSelection(options, new URLSearchParams())).toEqual(expect.objectContaining({ state: "selected", canonicalize: true }));
  });
});
