import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { GovernanceAdminPage } from "./GovernanceAdminPage";
import { PolicyLibraryPage } from "./PolicyLibraryPage";
import type { GovernanceWorkspace, PolicyFamily, PublishedPolicy } from "./api";

const family: PolicyFamily = {
  id: "family-1", code: "child_protection", title: "Child protection and mandatory reporting", category: "safeguarding",
  capability_pack: "india_school_core", applicable_institution_kinds: ["school", "hybrid"],
  source_references: [{ label: "POCSO Act, 2012", url: "https://example.test/pocso" }], default_audiences: ["admin", "staff"],
  default_requires_acknowledgement: true, risk_level: "high", guidance: "Define reporting and restricted records.", applicable: true,
  current_version_id: null, current_version: null, current_status: null, current_summary: null, current_effective_on: null,
  current_review_due_on: null, current_requires_acknowledgement: null, current_revision: null,
  work_version_id: "version-1", work_version: 1, work_status: "draft", work_title: "Child protection and mandatory reporting",
  work_summary: "How our institution protects children.", work_body_markdown: "All staff use the protected reporting channel and record the external report.",
  work_audience_roles: ["admin", "staff"], work_requires_acknowledgement: true, work_effective_on: "2026-10-04",
  work_review_due_on: "2027-10-04", work_source_note: "Reviewed against school safety records.", work_revision: 2,
  work_created_by: "admin-1", work_submitted_by: null,
};
const workspace: GovernanceWorkspace = {
  profile: { school_id: "school-1", institution_kind: "school", country_code: "IN", state_code: "KA", district: "Bengaluru Urban", management_kind: "private_unaided", delivery_mode: "in_person", education_levels: ["primary", "secondary"], regulator_codes: ["CBSE"], capability_packs: ["india_school_core"], recognition_reference: "REC-1", affiliation_reference: "AFF-1", residential: false, transport_provided: true, minors_enrolled: true, staff_count_band: "50_99", reviewed_on: "2026-10-04", review_note: "Reviewed by the principal.", revision: 3, updated_at: "2026-10-04T00:00:00Z" },
  families: [family], metrics: { applicable: 13, published: 4, in_review: 1, review_due: 2 },
  audits: [{ id: "audit-1", action: "governance.profile.updated", target_type: "regulatory_profile", metadata: { revision: 3 }, created_at: "2026-10-04T06:00:00Z", first_name: "Meera", last_name: "Kapoor" }],
};

function shell(children: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>); }
afterEach(cleanup);

describe("governance policy centre", () => {
  it("shows applicability, lifecycle state and a complete mobile policy editor", async () => {
    shell(<GovernanceAdminPage schoolId="school-1" schoolName="Cambridge International School" data={workspace} refresh={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByRole("heading", { name: "Policy centre" })).toBeVisible();
    expect(screen.getByText("13")).toBeVisible();
    expect(screen.getByText("Draft v1")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: /Child protection and mandatory reporting/ }));
    const dialog = screen.getByRole("dialog", { name: "Child protection and mandatory reporting" });
    expect(within(dialog).getByLabelText<HTMLTextAreaElement>("Policy text").value).toContain("protected reporting channel");
    expect(within(dialog).getByRole("checkbox", { name: "Staff" })).toBeChecked();
    expect(within(dialog).getByRole("button", { name: "Submit for review" })).toBeVisible();
  });

  it("keeps institution applicability separate from the policy register", async () => {
    shell(<GovernanceAdminPage schoolId="school-1" data={workspace} refresh={vi.fn().mockResolvedValue(undefined)} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /Institution profile/ }));
    expect(screen.getByLabelText("Institution type")).toHaveValue("school");
    expect(screen.getByLabelText(/Board, regulator or university codes/)).toHaveValue("CBSE");
    expect(screen.getByText("Revision 3")).toBeVisible();
  });

  it("presents version-specific acknowledgement without calling it consent", async () => {
    const published: PublishedPolicy = { id: "version-1", code: family.code, category: family.category, title: family.title, summary: "How our institution protects children.", body_markdown: family.work_body_markdown!, audience_roles: ["staff"], requires_acknowledgement: true, version: 1, effective_on: "2026-10-04", review_due_on: "2027-10-04", source_note: "Reviewed against the safety plan.", source_references: family.source_references, acknowledgement_id: null, acknowledged_at: null, guidance: family.guidance };
    shell(<PolicyLibraryPage portal="teacher" schoolId="school-1" data={{ policies: [published], membership_roles: ["staff"] }} refresh={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText(/Acknowledgement records the exact version shown/)).toBeVisible();
    expect(screen.getByText("Action needed")).toBeVisible();
    await userEvent.setup().click(screen.getByText(family.title));
    expect(screen.getByRole("button", { name: "Acknowledge this version" })).toBeVisible();
  });
});
