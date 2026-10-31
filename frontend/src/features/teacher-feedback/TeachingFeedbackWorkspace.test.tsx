import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceManifest, WorkspaceMoreItem } from "../workspace/types";
import { TeachingFeedbackWorkspace, feedbackWorkspaceAccess } from "./TeachingFeedbackWorkspace";
import { getPending, getResults, getWorkspace, type Campaign, type Workspace } from "./api";

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getPending: vi.fn(),
  getResults: vi.fn(),
  getWorkspace: vi.fn(),
  closeCampaign: vi.fn(),
  submitFeedback: vi.fn(),
}));

const campaign: Campaign = {
  id: "campaign-1",
  title: "Teaching check-in",
  teacher_name: "Anita Sharma",
  class_name: "7A",
  audience: "parents",
  parameters: ["Teaching clarity"],
  closes_at: "2026-12-01T10:00:00Z",
  is_closed: false,
  response_count: 2,
};

const workspace: Workspace = {
  teachers: [{ id: "teacher-1", name: "Anita Sharma" }],
  classes: [{ id: "class-1", grade: "7", section: "A", academic_year: "2026-27" }],
  campaigns: [campaign],
  default_parameters: ["Teaching clarity"],
};

function manifest(namespace = "live:school-1"): WorkspaceManifest {
  return {
    revision: `workspace-${namespace}`,
    generated_at: "2026-10-19T04:00:00.000Z",
    context: {
      institution_id: "school-1",
      institution_label: "Cambridge International School",
      environment: namespace.startsWith("simulation:")
        ? { kind: "simulation", namespace_id: namespace, virtual_now: "2026-10-20T04:00:00.000Z" }
        : { kind: "live", namespace_id: namespace },
    },
    today: { now: [], attention: { total: 0, overdue: 0, due_soon: 0 }, next: [] },
    work: { total: 0, items: [] },
    areas: [],
    more: { groups: [], setup: [], other: [] },
    freshness: { state: "current", as_of: "9:30 AM", source_revision: namespace },
  };
}

function contribution(capabilities: string[]): WorkspaceMoreItem {
  return {
    key: "feedback",
    label: "Teaching feedback",
    href: "/more/feedback",
    capabilities,
    scopes: [
      { kind: "institution", id: "school-1", label: "Cambridge International School" },
      { kind: "dependent", id: "student-1", label: "Mira Sharma" },
    ],
  };
}

function renderWorkspace(item: WorkspaceMoreItem, entry = "/more/feedback", selectedManifest = manifest()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[entry]}>
      <TeachingFeedbackWorkspace manifest={selectedManifest} item={item} />
    </MemoryRouter>
  </QueryClientProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("responsibility-composed teaching feedback", () => {
  it("derives coordination and response surfaces only from manifest metadata", () => {
    expect(feedbackWorkspaceAccess(contribution(["teacher_feedback.coordinate"]))).toMatchObject({ canCoordinate: true, canRespond: false });
    expect(feedbackWorkspaceAccess(contribution(["teacher_feedback.respond"]))).toMatchObject({ canCoordinate: false, canRespond: true });
  });

  it("opens the coordination capability without an auth-role or persona selection", async () => {
    vi.mocked(getWorkspace).mockResolvedValue(workspace);
    renderWorkspace(contribution(["teacher_feedback.coordinate"]));

    expect(await screen.findByRole("heading", { name: "Coordinate teaching check-ins" })).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Ask for feedback" })).toBeEnabled());
    expect(getWorkspace).toHaveBeenCalledWith("school-1");
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("opens an exact relationship request and retains the response action", async () => {
    vi.mocked(getPending).mockResolvedValue({ campaigns: [campaign] });
    renderWorkspace(
      contribution(["teacher_feedback.respond"]),
      "/more/feedback?scope=dependent&student_id=student-1&campaign=campaign-1",
    );

    expect(await screen.findByRole("heading", { name: "Anita Sharma" })).toBeVisible();
    expect(document.getElementById("attention-campaign-1")).toHaveClass("attention-focus");
    expect(screen.getByRole("button", { name: "Submit feedback" })).toBeDisabled();
    expect(screen.getByText("Mira Sharma")).toBeVisible();
  });

  it("lets one person move between contributed response and coordination capabilities", async () => {
    const user = userEvent.setup();
    vi.mocked(getPending).mockResolvedValue({ campaigns: [campaign] });
    vi.mocked(getWorkspace).mockResolvedValue(workspace);
    vi.mocked(getResults).mockResolvedValue({ campaign, response_count: 2, available: false, parameters: [] });
    renderWorkspace(
      contribution(["teacher_feedback.coordinate", "teacher_feedback.respond"]),
      "/more/feedback?scope=dependent&campaign=campaign-1",
    );

    expect(await screen.findByRole("tab", { name: "Respond" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "Coordinate" }));
    expect(await screen.findByRole("heading", { name: "Coordinate teaching check-ins" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide results" })).toBeVisible();
  });

  it("uses the selected Live or Simulation namespace in feedback cache identity", async () => {
    vi.mocked(getPending).mockResolvedValue({ campaigns: [] });
    const item = contribution(["teacher_feedback.respond"]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={queryClient}>
      <MemoryRouter><TeachingFeedbackWorkspace manifest={manifest()} item={item} /></MemoryRouter>
    </QueryClientProvider>);
    expect(await screen.findByText("You're all caught up")).toBeVisible();

    view.rerender(<QueryClientProvider client={queryClient}>
      <MemoryRouter><TeachingFeedbackWorkspace manifest={manifest("simulation:run-1")} item={item} /></MemoryRouter>
    </QueryClientProvider>);
    expect(await screen.findByText("You're all caught up")).toBeVisible();
    expect(getPending).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryCache().findAll({ queryKey: ["teacher-feedback", "pending"] })).toHaveLength(2);
  });
});
