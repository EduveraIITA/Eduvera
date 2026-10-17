import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { ExaminationOperatingRules } from "./ExaminationOperatingRules";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());

const rules = {
  readiness_minutes_before: 30,
  attendance_close_after_minutes: 60,
  minimum_invigilators: 1,
  require_all_candidate_attendance: true,
  post_completion_marking_mode: "manual" as const,
  revision: 3,
};

describe("examination operating rules", () => {
  it("saves one institution rule set with optimistic revision", async () => {
    vi.mocked(apiFetch).mockResolvedValue(rules);
    const dirty = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ExaminationOperatingRules schoolId="school-1" onDirtyChange={dirty}/>
    </QueryClientProvider>);
    fireEvent.change(await screen.findByLabelText("Minimum invigilators per sitting"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("After the sitting is completed"), { target: { value: "automatic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/schools/school-1/assessments/exam-policy/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          expected_revision: 3,
          readiness_minutes_before: 30,
          attendance_close_after_minutes: 60,
          minimum_invigilators: 2,
          require_all_candidate_attendance: true,
          post_completion_marking_mode: "automatic",
        }),
      }),
    ));
    expect(dirty).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole("status")).toHaveTextContent("Examination rules saved.");
  });
});
