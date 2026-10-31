import { describe, expect, it } from "vitest";
import type { WorkspaceManifest } from "../workspace/types";
import { insightContextDestination, resolveInsightsWorkspaceAccess } from "./InsightsWorkspaceRoutes";

const manifest: WorkspaceManifest = {
  revision: "insights-test",
  generated_at: "2026-10-18T00:00:00.000Z",
  context: { institution_id: "school-1", institution_label: "Test campus", environment: { kind: "live", namespace_id: "live:school-1" } },
  today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
  work: { total: 0, items: [] },
  areas: [{
    key: "insights", label: "Insights", description: "Evidence", href: "/areas/insights", icon: "insights", attention_count: 0,
    capabilities: ["attendance.view", "insights.manage", "insights.view"], scopes: [],
    surfaces: [
      { key: "institution", label: "Institution insights", href: "/areas/insights?scope=institution", capabilities: ["insights.manage"], scopes: [{ kind: "institution", id: "school-1", label: "Test campus" }] },
      { key: "assigned", label: "My work insights", href: "/areas/insights?scope=assigned", capabilities: ["attendance.view"], scopes: [{ kind: "class", id: "class-1", label: "Class 6A" }] },
      { key: "overview:self:student-1", label: "My insights", href: "/areas/insights?scope=self&student_id=student-1", capabilities: ["insights.view"], scopes: [{ kind: "self", id: "student-1", label: "Aarav" }] },
      { key: "overview:dependent:student-2", label: "Mira insights", href: "/areas/insights?scope=dependent&student_id=student-2", capabilities: ["insights.view"], scopes: [{ kind: "dependent", id: "student-2", label: "Mira" }] },
    ],
  }],
  more: { setup: [], groups: [] },
  freshness: { state: "current", as_of: "Now", source_revision: "one" },
};

describe("responsibility-composed Insights", () => {
  it("resolves institution and assigned scopes from contributed surfaces", () => {
    expect(resolveInsightsWorkspaceAccess(manifest, new URLSearchParams("scope=institution"))).toMatchObject({ kind: "institution", audience: "principal" });
    expect(resolveInsightsWorkspaceAccess(manifest, new URLSearchParams("scope=assigned"))).toMatchObject({ kind: "assigned", audience: "teacher" });
  });

  it("resolves exact learner relationships without a persona route", () => {
    expect(resolveInsightsWorkspaceAccess(manifest, new URLSearchParams("scope=dependent&student_id=student-2"))).toMatchObject({
      kind: "dependent", audience: "parent", studentId: "student-2", contextLabel: "Mira insights",
    });
    expect(resolveInsightsWorkspaceAccess(manifest, new URLSearchParams("scope=self&student_id=student-1"))).toMatchObject({ kind: "self", audience: "student" });
  });

  it("fails closed for a relationship not contributed by the manifest", () => {
    expect(resolveInsightsWorkspaceAccess(manifest, new URLSearchParams("scope=dependent&student_id=student-1"))).toBeNull();
    expect(resolveInsightsWorkspaceAccess(manifest, new URLSearchParams("scope=unknown"))).toBeNull();
  });

  it("keeps reporting filters while changing context on the same canonical route", () => {
    const destination = insightContextDestination(
      "/areas/insights?scope=dependent&student_id=student-2",
      new URLSearchParams("scope=institution&period=90&class=class-1&compare=class"),
      "attendance",
    );
    expect(destination).toBe("/areas/insights/attendance?scope=dependent&student_id=student-2&period=90&class=class-1&compare=class");
  });
});
