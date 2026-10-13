import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import FamilyFeedbackPage from "./FamilyFeedbackPage";
import { getPending, type Campaign } from "./api";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "parent-1", active_school_id: "school-1" }, memberships: [] }),
}));
vi.mock("../../pages/parent/ParentShell", () => ({ ParentShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../../pages/student/StudentShell", () => ({ StudentShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  getPending: vi.fn(),
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
  response_count: 0,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FamilyFeedbackPage attention links", () => {
  it("focuses the exact campaign requested by the attention destination", async () => {
    vi.mocked(getPending).mockResolvedValue({ campaigns: [campaign, { ...campaign, id: "campaign-2", teacher_name: "Leena Bose" }] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/parent/teacher-feedback?campaign=campaign-2"]}>
          <FamilyFeedbackPage portal="parent" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Leena Bose" })).toBeVisible();
    const target = document.getElementById("attention-campaign-2");
    expect(target).toHaveClass("attention-focus");
    await waitFor(() => expect(target).toHaveFocus());
  });

  it("shows a truthful state when the linked campaign is no longer pending", async () => {
    vi.mocked(getPending).mockResolvedValue({ campaigns: [campaign] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={["/parent/teacher-feedback?campaign=closed-campaign"]}>
          <FamilyFeedbackPage portal="parent" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("no longer open");
    expect(document.querySelector(".attention-focus")).not.toBeInTheDocument();
  });
});
