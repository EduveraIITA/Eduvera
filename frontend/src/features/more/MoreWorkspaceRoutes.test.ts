import { describe, expect, it } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";
import {
  canonicalMoreRouteDefinitions,
  legacyMoreRedirectDefinitions,
  workspaceConnectionContexts,
  workspaceMoreItem,
} from "./MoreWorkspaceRoutes";

const manifest: WorkspaceManifest = {
  revision: "workspace-1",
  generated_at: "2026-10-19T04:00:00.000Z",
  context: {
    institution_id: "school-1",
    institution_label: "Cambridge International School",
    environment: { kind: "live", namespace_id: "live:school-1" },
  },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "timetable",
    label: "Timetable",
    href: "/areas/timetable",
    icon: "timetable",
    attention_count: 0,
    capabilities: ["timetable.view"],
    scopes: [
      { kind: "self", id: "student-self", label: "Aarav Sharma" },
      { kind: "dependent", id: "student-dependent", label: "Mira Sharma" },
    ],
    surfaces: [],
  }],
  more: {
    groups: [
      { key: "account", label: "Account", items: [{ key: "account", label: "Profile & appearance", href: "/more/account" }] },
      { key: "connections", label: "Connections", items: [{ key: "connections", label: "Connected apps", href: "/more/connections" }] },
      { key: "work", label: "My work record", items: [{ key: "responsibilities", label: "My responsibilities", href: "/areas/responsibilities/mine" }] },
      { key: "participation", label: "Policies & feedback", items: [{ key: "governance", label: "Policies & governance", href: "/more/governance" }] },
      { key: "simulation", label: "Simulation", items: [{ key: "simulation", label: "Simulation", href: "/more/simulation", icon: "simulation" }] },
    ],
    setup: [],
    other: [],
  },
  freshness: { state: "current", as_of: "9:30 AM", source_revision: "workspace-1" },
};

describe("canonical More contributions", () => {
  it("resolves a route only from the server-composed catalogue", () => {
    expect(workspaceMoreItem(manifest, "connections")?.href).toBe("/more/connections");
    expect(workspaceMoreItem(manifest, "campus-view")).toBeNull();
  });

  it("derives connector contexts from responsibilities and relationships without persona labels", () => {
    expect(workspaceConnectionContexts(manifest)).toEqual([
      expect.objectContaining({ key: "institution", label: "Institution operations", audience: "principal" }),
      expect.objectContaining({ key: "assigned-work", label: "My assigned work", audience: "teacher" }),
      expect.objectContaining({ key: "self:student-self", label: "My learning", audience: "student", studentId: "student-self" }),
      expect.objectContaining({ key: "dependent:student-dependent", label: "Mira Sharma", audience: "parent", studentId: "student-dependent" }),
    ]);
    expect(workspaceConnectionContexts(manifest).map((context) => context.label).join(" ")).not.toMatch(/principal|teacher|parent|student/i);
  });

  it("exports only canonical neutral paths for router integration", () => {
    expect(canonicalMoreRouteDefinitions.map((route) => route.path)).toContain("/more/virtual-campus");
    expect(canonicalMoreRouteDefinitions.some((route) => route.path === "/more/campus-view" || route.itemKey === "campus-view")).toBe(false);
    expect(legacyMoreRedirectDefinitions).toEqual(expect.arrayContaining([
      { from: "/more/campus-view", to: "/more/virtual-campus" },
      { from: "/principal/campus", to: "/more/virtual-campus" },
    ]));
    expect(canonicalMoreRouteDefinitions.map((route) => route.path)).toContain("/more/simulation");
    expect(canonicalMoreRouteDefinitions.map((route) => route.path)).not.toContain("/more/development");
    expect(canonicalMoreRouteDefinitions.map((route) => route.path)).not.toContain("/more/development/campus-lab");
    expect(canonicalMoreRouteDefinitions.every((route) => !/\/(principal|teacher|parent|student)\//.test(route.path))).toBe(true);
    expect(legacyMoreRedirectDefinitions.every((route) => route.to.startsWith("/more/") || route.to.startsWith("/areas/"))).toBe(true);
    expect(legacyMoreRedirectDefinitions.some((route) => route.from === "/principal/experimental" || route.from === "/principal/campus-lab")).toBe(false);
  });
});
