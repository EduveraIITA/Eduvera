import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { RepairDetailView } from "./RepairDetailView";
import { repairFixture } from "./facilities.test-fixtures";
import type { RepairDetail, RepairExternalAccess } from "./facilitiesApi";
vi.mock("../accommodation/RepairAccommodationLink", () => ({ RepairAccommodationLink: () => <p>Private accommodation controls</p> }));
afterEach(cleanup);
function mount(extra: Partial<RepairDetail> = {}) {
  const repair = repairFixture({ external_view: true, coordinator: { id: "contact", label: "Campus contact" }, external_access: { id: "grant", person: { id: "tech", label: "Amit", revision: 1, has_app_access: true }, starts_at: "2026-10-26T00:00:00Z", ends_at: "2026-11-02T00:00:00Z", instructions: "Replace the light fitting", shared_photo_ids: [], state: "ready", can_manage: false, can_activate: true }, allowed_actions: { accept: false, assign: false, update: false, complete: false, verify: false, reopen: false, add_photo: false }, ...extra });
  render(<MemoryRouter><ExecutionEnvironmentProvider environment={{ mode: "live" }}><RepairDetailView schoolId="school" actorId="tech" repair={repair} timezone="Asia/Kolkata" readOnly={false} refresh={vi.fn()} historyPage={1} onHistoryPage={vi.fn()} /></ExecutionEnvironmentProvider></MemoryRouter>);
}
describe("the existing repair screen for a scoped technician", () => {
  it("leads with shared instructions and contact, not private report notes or accommodation", () => {
    mount(); expect(screen.getByText("Replace the light fitting")).toBeVisible(); expect(screen.getByText("Campus contact · Campus contact")).toBeVisible();
    expect(screen.queryByText("Leaking pipe below the washbasin")).not.toBeInTheDocument(); expect(screen.queryByText("Private accommodation controls")).not.toBeInTheDocument();
    expect(screen.queryByText("Reported by")).not.toBeInTheDocument(); expect(screen.queryByText("Recorded by")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Accept job" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Invite technician" })).not.toBeInTheDocument(); expect(screen.queryByText("Change responsibility")).not.toBeInTheDocument();
  });
  it("keeps technician completion distinct from campus verification", () => {
    mount({ state: "awaiting_verification", external_access: null }); expect(screen.getByText("Waiting for the campus to check the reported work.")).toBeVisible();
    expect(screen.queryByText("Asha Patel needs to check the repair.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirm repaired" })).not.toBeInTheDocument();
  });
  it.each<RepairExternalAccess["state"]>(["ready", "awaiting_sign_in", "scheduled"])("shows the pending named technician instead of the retained internal handler for %s access", state => {
    const access: RepairExternalAccess = { id: "grant", person: { id: "tech", label: "Amit Kumar", revision: 1, has_app_access: state !== "awaiting_sign_in" }, starts_at: "2026-10-28T04:30:00Z", ends_at: "2026-11-02T00:00:00Z", instructions: "Replace the light fitting", shared_photo_ids: [], state, can_manage: true, can_activate: false };
    mount({ external_view: false, external_access: access });
    const progress = within(screen.getByLabelText("Current repair progress"));
    expect(progress.queryByText("Dev Shah needs to accept this report.")).not.toBeInTheDocument();
    if (state === "scheduled") expect(progress.getByText(/Access for Amit Kumar starts.*They can accept then\./)).toBeVisible();
    else expect(progress.getByText(`Waiting for Amit Kumar to ${state === "awaiting_sign_in" ? "sign in and " : ""}accept the job.`)).toBeVisible();
  });
  it.each<RepairExternalAccess["state"]>(["expired", "ended"])("does not present %s access as a pending technician acceptance", state => {
    mount({ external_view: false, external_access: { id: "grant", person: { id: "tech", label: "Amit Kumar", revision: 1, has_app_access: true }, starts_at: "2026-10-26T00:00:00Z", ends_at: "2026-11-02T00:00:00Z", instructions: "Replace the light fitting", shared_photo_ids: [], state, can_manage: true, can_activate: false } });
    const progress = within(screen.getByLabelText("Current repair progress"));
    expect(progress.getByText("Dev Shah needs to accept this report.")).toBeVisible(); expect(progress.queryByText(/Waiting for Amit Kumar/)).not.toBeInTheDocument();
  });
  it("keeps ordinary internal handler and named verification copy unchanged", () => {
    mount({ external_view: false, external_access: null });
    expect(screen.getByText("Dev Shah needs to accept this report.")).toBeVisible();
    cleanup(); mount({ external_view: false, external_access: null, state: "awaiting_verification" });
    expect(screen.getByText("Asha Patel needs to check the repair.")).toBeVisible();
  });
});
