import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import InstitutionActivationPage from "./InstitutionActivationPage";
import { QuickStartForm } from "./QuickStartForm";
import type { ActivationWorkspace } from "./api";

const api = vi.hoisted(() => ({
  getActivation: vi.fn(), applyQuickStart: vi.fn(), reviewActivation: vi.fn(), activateInstitution: vi.fn(),
}));

vi.mock("./api", () => ({ ...api }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    user: { active_school_id: "school-1" },
    memberships: [{ id: "member-1", school_id: "school-1", school_name: "Kiran Tutorials", role: "admin" }],
    refresh: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock("../../pages/operations/OperationsShell", () => ({ OperationsShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

afterEach(cleanup);

const workspace: ActivationWorkspace = {
  institution: {
    id: "school-1", name: "Kiran Tutorials", code: "kiran", timezone: "Asia/Kolkata", institution_kind: "coaching",
    onboarding_model: "self_service_coaching", verification_status: "not_required", capability_pack: "coaching_core",
    capability_label: "Coaching workspace", capability_description: "Batch, learner, schedule and attendance setup.",
    cohort_label: "Batch", learner_label: "Learner", default_subject_names: ["Mathematics"], requires_staff: false,
    status: "ready", revision: 4, reviewed_at: "2026-10-05T00:00:00Z", activated_at: null,
  },
  checks: [
    { key: "owner_email", label: "Verify owner email", description: "Confirm ownership.", target_path: "/account/security", required: true, complete: true, detail: "Administrator email verified" },
    { key: "learner", label: "Enrol a learner", description: "Create a real learner.", target_path: "/principal/students", required: true, complete: false, detail: "0 learners" },
    { key: "staff_owner", label: "Assign teaching staff", description: "Optional tutor.", target_path: "/principal/invitations", required: false, complete: false, detail: "Optional for this coaching workspace" },
  ],
  summary: { completed: 1, required: 2, percent: 50, ready: true },
  counts: { terms: 1, cohorts: 1, subjects: 1, staff: 0, learners: 0, schedule: 6 },
  history: [{ id: "audit-1", action: "readiness_reviewed", from_status: "draft", to_status: "ready", note: "All checks passed.", created_at: "2026-10-05T00:00:00Z" }],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><InstitutionActivationPage /></QueryClientProvider></MemoryRouter>);
}

describe("institution activation", () => {
  it("shows computed readiness, optional requirements and activates the reviewed revision", async () => {
    api.getActivation.mockResolvedValue(workspace);
    api.activateInstitution.mockResolvedValue({ ...workspace, institution: { ...workspace.institution, status: "active" } });
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "Readiness checklist" })).toBeVisible();
    expect(screen.getByText("50%")).toBeVisible();
    expect(screen.getByText("0 learners")).toBeVisible();
    expect(screen.getByText("Optional")).toBeVisible();
    expect(screen.queryByText("Create a real learner.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Activate institution/i }));
    expect(api.activateInstitution).toHaveBeenCalledWith("school-1", 4);
  });

  it("submits quick start as real academic, attendance, contact and schedule settings", async () => {
    api.applyQuickStart.mockResolvedValue(workspace);
    const onDone = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<QuickStartForm schoolId="school-1" cohortLabel="Batch" defaults={["Mathematics"]} onDone={onDone} />);

    await user.type(screen.getByLabelText("Batch name"), "Foundation");
    await user.type(screen.getByLabelText("Responsible contact"), "Kiran");
    await user.type(screen.getByLabelText("Phone"), "9000000000");
    await user.click(screen.getByRole("button", { name: /Create and review records/i }));

    expect(api.applyQuickStart).toHaveBeenCalledWith("school-1", expect.objectContaining({
      grade_or_program: "Foundation", contact_name: "Kiran", contact_phone: "9000000000",
      subjects: [{ code: "MATHEMATICS", name: "Mathematics", short_name: "Mathematics" }],
      teaching_days: [1, 2, 3, 4, 5],
    }));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
